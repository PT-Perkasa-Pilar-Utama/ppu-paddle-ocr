import * as ort from "onnxruntime-node";
import {
  Canvas,
  CanvasToolkit,
  Contours,
  createCanvas,
  cv,
  ImageProcessor,
} from "ppu-ocv";
import {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
} from "../constants.js";
import type { Box, DebuggingOptions, DetectionOptions } from "../interface.js";
import { DeskewService } from "./deskew.service.js";

/**
 * Result of preprocessing an image for text detection
 */
export interface PreprocessDetectionResult {
  tensor: Float32Array;
  width: number;
  height: number;
  resizeRatio: number;
  originalWidth: number;
  originalHeight: number;
}

/**
 * Service for detecting text regions in images
 */
export class DetectionService {
  private readonly options: DetectionOptions;
  private readonly debugging: DebuggingOptions;
  private readonly session: ort.InferenceSession;

  private static readonly NUM_CHANNELS = 3;
  private lastDetectionCanvas: Canvas | null = null;

  constructor(
    session: ort.InferenceSession,
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {}
  ) {
    this.session = session;

    this.options = {
      ...DEFAULT_DETECTION_OPTIONS,
      ...options,
    };

    this.debugging = {
      ...DEFAULT_DEBUGGING_OPTIONS,
      ...debugging,
    };
  }

  /**
   * Logs a message if verbose debugging is enabled
   */
  private log(message: string): void {
    if (this.debugging.verbose) {
      console.log(`[DetectionService] ${message}`);
    }
  }

  /**
   * Main method to run text detection on an image
   * @param image ArrayBuffer of the image or Canvas
   */
  async run(image: ArrayBuffer | Canvas): Promise<Box[]> {
    this.log("Starting text detection process");

    try {
      let canvasToProcess =
        image instanceof Canvas
          ? image
          : await ImageProcessor.prepareCanvas(image);

      if (this.options.autoDeskew) {
        this.log(
          "Auto-deskew enabled. Performing initial pass for angle detection."
        );
        const angle = await this.calculateSkewAngle(canvasToProcess);

        this.log(
          `Detected skew angle: ${angle.toFixed(
            2
          )}°. Rotating image at ${-angle.toFixed(2)}° (to ${
            -angle > 1 ? "right" : "left"
          })...`
        );

        const processor = new ImageProcessor(canvasToProcess);
        try {
          const rotatedCanvas = processor.rotate({ angle }).toCanvas();
          canvasToProcess = rotatedCanvas;
        } finally {
          processor.destroy();
        }

        if (this.debugging.debug) {
          await CanvasToolkit.getInstance().saveImage({
            canvas: canvasToProcess,
            filename: "deskewed-image-debug",
            path: this.debugging.debugFolder!,
          });
        }
      }

      const input = await this.preprocessDetection(canvasToProcess);
      const detection = await this.runInference(
        input.tensor,
        input.width,
        input.height
      );

      if (!detection) {
        console.error("Text detection failed (output tensor is null)");
        return [];
      }

      const detectedBoxes = this.postprocessDetection(detection, input);

      if (this.debugging.debug) {
        await this.debugDetectionCanvas(
          this.lastDetectionCanvas!,
          input.width,
          input.height
        );
        await this.debugDetectedBoxes(canvasToProcess, detectedBoxes);
      }

      this.log(`Detected ${detectedBoxes.length} text boxes in image`);

      return detectedBoxes;
    } catch (error) {
      console.error(
        "Error during text detection:",
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Atomic method to run image deskewing
   * @param image ArrayBuffer of the image or Canvas
   */
  async deskew(image: ArrayBuffer | Canvas): Promise<Canvas> {
    this.log("Starting image deskewing process");

    let canvasToProcess =
      image instanceof Canvas
        ? image
        : await ImageProcessor.prepareCanvas(image);

    this.log("Performing initial pass for angle detection.");
    const angle = await this.calculateSkewAngle(canvasToProcess);

    this.log(
      `Detected skew angle: ${angle.toFixed(
        2
      )}°. Rotating image at ${-angle.toFixed(2)}° (to ${
        -angle > 1 ? "right" : "left"
      })...`
    );

    const processor = new ImageProcessor(canvasToProcess);
    try {
      const rotatedCanvas = processor.rotate({ angle }).toCanvas();
      canvasToProcess = rotatedCanvas;
    } finally {
      processor.destroy();
    }

    if (this.debugging.debug) {
      await CanvasToolkit.getInstance().saveImage({
        canvas: canvasToProcess,
        filename: "deskewed-image-debug",
        path: this.debugging.debugFolder!,
      });
    }

    return canvasToProcess;
  }

  /**
   * Runs a lightweight detection pass to determine the average text skew angle.
   * Uses multiple methods to robustly calculate skew from all detected text regions.
   * @param canvas The input canvas.
   * @returns The calculated skew angle in degrees.
   */
  private async calculateSkewAngle(canvas: Canvas): Promise<number> {
    const input = await this.preprocessDetection(canvas);
    const detection = await this.runInference(
      input.tensor,
      input.width,
      input.height
    );

    if (!detection) {
      this.log("Skew calculation failed: no detection output from model.");
      return 0;
    }

    const { width, height } = input;
    const probabilityMapCanvas = this.tensorToCanvas(detection, width, height);

    if (this.debugging.debug) {
      await CanvasToolkit.getInstance().saveImage({
        canvas: probabilityMapCanvas,
        filename: "deskew-probability-map-debug.png",
        path: this.debugging.debugFolder!,
      });
    }

    const deskewService = new DeskewService(this.options, this.debugging);

    const result = await deskewService.calculateSkewAngle(probabilityMapCanvas);
    return result;
  }

  /**
   * Preprocess an image for text detection
   */
  private async preprocessDetection(
    canvas: Canvas
  ): Promise<PreprocessDetectionResult> {
    const { width: originalWidth, height: originalHeight } = canvas;

    const {
      width: resizeW,
      height: resizeH,
      ratio: resizeRatio,
    } = this.calculateResizeDimensions(originalWidth, originalHeight);

    const processor = new ImageProcessor(canvas);
    let resizedCanvas: Canvas;
    try {
      resizedCanvas = processor
        .resize({ width: resizeW, height: resizeH })
        .toCanvas();
    } finally {
      processor.destroy();
    }

    const width = Math.ceil(resizeW / 32) * 32;
    const height = Math.ceil(resizeH / 32) * 32;

    const paddedCanvas = this.createPaddedCanvas(
      resizedCanvas,
      resizeW,
      resizeH,
      width,
      height
    );

    const tensor = this.imageToTensor(paddedCanvas, width, height);

    this.log(
      `Detection preprocessed: original(${originalWidth}x${originalHeight}), ` +
        `model_input(${width}x${height}), resize_ratio: ${resizeRatio.toFixed(
          4
        )}`
    );

    return {
      tensor,
      width,
      height,
      resizeRatio,
      originalWidth,
      originalHeight,
    };
  }

  /**
   * Calculate dimensions for resizing the image
   */
  private calculateResizeDimensions(
    originalWidth: number,
    originalHeight: number
  ) {
    const MAX_SIDE_LEN = this.options.maxSideLength!;

    let resizeW = originalWidth;
    let resizeH = originalHeight;
    let ratio = 1.0;

    if (Math.max(resizeH, resizeW) > MAX_SIDE_LEN) {
      ratio = MAX_SIDE_LEN / (resizeH > resizeW ? resizeH : resizeW);
      resizeW = Math.round(resizeW * ratio);
      resizeH = Math.round(resizeH * ratio);
    }

    return { width: resizeW, height: resizeH, ratio };
  }

  /**
   * Create a padded canvas from the resized image
   */
  private createPaddedCanvas(
    resizedCanvas: Canvas,
    resizeW: number,
    resizeH: number,
    targetWidth: number,
    targetHeight: number
  ): Canvas {
    const paddedCanvas = createCanvas(targetWidth, targetHeight);
    const paddedCtx = paddedCanvas.getContext("2d");
    paddedCtx.drawImage(resizedCanvas, 0, 0, resizeW, resizeH);
    return paddedCanvas;
  }

  /**
   * Convert an image to a normalized tensor for model input
   */
  private imageToTensor(
    canvas: Canvas,
    width: number,
    height: number
  ): Float32Array {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, width, height);
    const rgbaData = imageData.data;

    const tensor = new Float32Array(
      DetectionService.NUM_CHANNELS * height * width
    );
    const { mean, stdDeviation } = this.options;

    for (let h = 0; h < height; h++) {
      for (let w = 0; w < width; w++) {
        const rgbaIdx = (h * width + w) * 4;
        const tensorBaseIdx = h * width + w;

        // Normalize RGB values
        for (let c = 0; c < DetectionService.NUM_CHANNELS; c++) {
          const pixelValue = rgbaData[rgbaIdx + c]! / 255.0;
          const normalizedValue = (pixelValue - mean![c]) / stdDeviation![c];
          tensor[c * height * width + tensorBaseIdx] = normalizedValue;
        }
      }
    }

    return tensor;
  }

  /**
   * Run the detection model inference
   */
  private async runInference(
    tensor: Float32Array,
    width: number,
    height: number
  ): Promise<Float32Array | null> {
    let inputTensor: ort.Tensor | undefined;
    try {
      this.log("Running detection inference...");

      inputTensor = new ort.Tensor("float32", tensor, [1, 3, height, width]);

      const feeds = { x: inputTensor };
      const results = await this.session.run(feeds);
      const outputTensor =
        results[this.session.outputNames[0] || "sigmoid_0.tmp_0"];

      this.log("Detection inference complete!");

      if (!outputTensor) {
        console.error(
          `Output tensor ${this.session.outputNames[0]}  not found in detection results`
        );
        return null;
      }

      return outputTensor.data as Float32Array;
    } catch (error) {
      console.error(
        "Error during model inference:",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      inputTensor?.dispose();
    }
  }

  /**
   * Convert a tensor to a canvas for visualization and processing
   */
  private tensorToCanvas(
    tensor: Float32Array,
    width: number,
    height: number
  ): Canvas {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const mapIndex = y * width + x;
        const probability = tensor[mapIndex] || 0;
        const grayValue = Math.round(probability * 255);

        const pixelIdx = (y * width + x) * 4;
        data[pixelIdx] = grayValue; // R
        data[pixelIdx + 1] = grayValue; // G
        data[pixelIdx + 2] = grayValue; // B
        data[pixelIdx + 3] = 255; // A
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Process detection results to extract bounding boxes
   */
  private postprocessDetection(
    detection: Float32Array,
    input: PreprocessDetectionResult,
    minBoxAreaOnPadded: number = this.options.minimumAreaThreshold || 20,
    paddingVertical: number = this.options.paddingVertical || 0.4,
    paddingHorizontal: number = this.options.paddingHorizontal || 0.6
  ): Box[] {
    this.log("Post-processing detection results...");

    const { width, height, resizeRatio, originalWidth, originalHeight } = input;
    const canvas = this.tensorToCanvas(detection, width, height);
    this.lastDetectionCanvas = canvas;

    const processor = new ImageProcessor(canvas);
    try {
      processor.grayscale().convert({ rtype: cv.CV_8UC1 });

      const contours = new Contours(processor.toMat(), {
        mode: cv.RETR_LIST,
        method: cv.CHAIN_APPROX_SIMPLE,
      });

      const boxes = this.extractBoxesFromContours(
        contours,
        width,
        height,
        resizeRatio,
        originalWidth,
        originalHeight,
        minBoxAreaOnPadded,
        paddingVertical,
        paddingHorizontal
      );

      contours.destroy();

      this.log(`Found ${boxes.length} potential text boxes`);
      return boxes;
    } finally {
      processor.destroy();
    }
  }

  /**
   * Extract boxes from contours
   */
  private extractBoxesFromContours(
    contours: Contours,
    width: number,
    height: number,
    resizeRatio: number,
    originalWidth: number,
    originalHeight: number,
    minBoxArea: number,
    paddingVertical: number,
    paddingHorizontal: number
  ): Box[] {
    const boxes: Box[] = [];

    contours.iterate((contour) => {
      const rect = contours.getRect(contour);

      if (rect.width * rect.height <= minBoxArea) {
        return;
      }

      const paddedRect = this.applyPaddingToRect(
        rect,
        width,
        height,
        paddingVertical,
        paddingHorizontal
      );

      const finalBox = this.convertToOriginalCoordinates(
        paddedRect,
        resizeRatio,
        originalWidth,
        originalHeight
      );

      if (finalBox.width > 5 && finalBox.height > 5) {
        boxes.push(finalBox);
      }
    });

    return boxes;
  }

  /**
   * Apply padding to a rectangle
   */
  private applyPaddingToRect(
    rect: { x: number; y: number; width: number; height: number },
    maxWidth: number,
    maxHeight: number,
    paddingVertical: number,
    paddingHorizontal: number
  ) {
    const verticalPadding = Math.round(rect.height * paddingVertical);
    const horizontalPadding = Math.round(rect.height * paddingHorizontal);

    let x = rect.x - horizontalPadding;
    let y = rect.y - verticalPadding;
    let width = rect.width + 2 * horizontalPadding;
    let height = rect.height + 2 * verticalPadding;

    x = Math.max(0, x);
    y = Math.max(0, y);

    const rightEdge = Math.min(
      maxWidth,
      rect.x + rect.width + horizontalPadding
    );
    const bottomEdge = Math.min(
      maxHeight,
      rect.y + rect.height + verticalPadding
    );
    width = rightEdge - x;
    height = bottomEdge - y;

    return { x, y, width, height };
  }

  /**
   * Convert coordinates from resized image back to original image
   */
  private convertToOriginalCoordinates(
    rect: { x: number; y: number; width: number; height: number },
    resizeRatio: number,
    originalWidth: number,
    originalHeight: number
  ): Box {
    const scaledX = rect.x / resizeRatio;
    const scaledY = rect.y / resizeRatio;
    const scaledWidth = rect.width / resizeRatio;
    const scaledHeight = rect.height / resizeRatio;

    const x = Math.max(0, Math.round(scaledX));
    const y = Math.max(0, Math.round(scaledY));
    const width = Math.min(originalWidth - x, Math.round(scaledWidth));
    const height = Math.min(originalHeight - y, Math.round(scaledHeight));

    return { x, y, width, height };
  }

  /**
   * Debug the detection canvas in binary image format (thresholded)
   */
  private async debugDetectionCanvas(
    canvas: Canvas,
    width: number,
    height: number
  ): Promise<void> {
    const dir = this.debugging.debugFolder!;
    await CanvasToolkit.getInstance().saveImage({
      canvas,
      filename: "detection-debug",
      path: dir,
    });

    this.log(`Probability map visualized and saved to: ${dir}`);
  }

  /**
   * Debug the bounding boxes by drawinga rectangle onto the original image
   */
  private async debugDetectedBoxes(image: ArrayBuffer | Canvas, boxes: Box[]) {
    const canvas =
      image instanceof Canvas
        ? image
        : await ImageProcessor.prepareCanvas(image);

    const ctx = canvas.getContext("2d");

    const toolkit = CanvasToolkit.getInstance();

    for (const box of boxes) {
      const { x, y, width, height } = box;
      toolkit.drawLine({
        ctx,
        x,
        y,
        width,
        height,
      });
    }

    const dir = this.debugging.debugFolder!;
    await CanvasToolkit.getInstance().saveImage({
      canvas,
      filename: "boxes-debug",
      path: dir,
    });

    this.log(`Boxes visualized and saved to: ${dir}`);
  }
}
