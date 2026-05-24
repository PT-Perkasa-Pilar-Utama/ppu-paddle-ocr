// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession, Tensor } from "onnxruntime-common";
import type { Contours, cv } from "ppu-ocv";
import { DEFAULT_DEBUGGING_OPTIONS, DEFAULT_DETECTION_OPTIONS } from "../constants.js";
import type { Box, DebuggingOptions, DetectionOptions, ProcessingEngine } from "../interface.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";

/**
 * Result of preprocessing an image for text detection.
 *
 * Contains the normalized float tensor, dimensions, and scale factors
 * needed to map detection output back to original image coordinates.
 */
export type PreprocessDetectionResult = {
  /** Normalized float tensor (CHW layout, 3 channels). */
  tensor: Float32Array;
  /** Width of the padded/resized tensor in pixels. */
  width: number;
  /** Height of the padded/resized tensor in pixels. */
  height: number;
  /** Scale factor applied during resize (`resized / original`). */
  resizeRatio: number;
  /** Original image width before preprocessing. */
  originalWidth: number;
  /** Original image height before preprocessing. */
  originalHeight: number;
};

/**
 * Service for detecting text regions in images
 */
export class BaseDetectionService {
  protected readonly options: DetectionOptions;
  protected readonly debugging: DebuggingOptions;
  protected readonly session: InferenceSession;
  protected readonly platform: PlatformProvider;
  protected readonly engine: ProcessingEngine;

  private static readonly NUM_CHANNELS = 3;
  private lastDetectionCanvas: CoreCanvas | null = null;

  constructor(
    platform: PlatformProvider,
    session: InferenceSession,
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
    engine: ProcessingEngine = "opencv"
  ) {
    this.platform = platform;
    this.session = session;

    this.options = { ...DEFAULT_DETECTION_OPTIONS, ...options };
    this.debugging = { ...DEFAULT_DEBUGGING_OPTIONS, ...debugging };

    // Fall back to canvas-native if opencv is requested but imageProcessor is unavailable
    if (engine === "opencv" && !this.platform.imageProcessor) {
      this.engine = "canvas-native";
    } else {
      this.engine = engine;
    }
  }

  /**
   * Logs a message if verbose debugging is enabled
   */
  protected log(message: string): void {
    if (this.debugging.verbose) {
      console.log(`[DetectionService] ${message}`);
    }
  }

  /**
   * Main method to run text detection on an image
   * @param image ArrayBuffer of the image or platform-specific Canvas
   */
  async run(image: ArrayBuffer | CoreCanvas): Promise<Box[]> {
    this.log("Starting text detection process");

    try {
      let canvasToProcess: CoreCanvas;
      if (this.platform.isCanvas(image)) {
        canvasToProcess = image;
      } else if (this.engine === "opencv" && this.platform.imageProcessor) {
        canvasToProcess = await this.platform.imageProcessor.prepareCanvas(image);
      } else {
        canvasToProcess = await this.platform.canvas.prepareCanvas(image);
      }

      const input = await this.preprocessDetection(canvasToProcess);
      const detection = await this.runInference(input.tensor, input.width, input.height);

      if (!detection) {
        console.error("Text detection failed (output tensor is null)");
        return [];
      }

      const detectedBoxes = this.postprocessDetection(detection, input);

      if (this.debugging.debug && this.debugging.debugFolder && this.lastDetectionCanvas) {
        await this.debugDetectionCanvas(this.lastDetectionCanvas, input.width, input.height);
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
   * Preprocess an image for text detection
   */
  private async preprocessDetection(canvas: CoreCanvas): Promise<PreprocessDetectionResult> {
    const { width: originalWidth, height: originalHeight } = canvas;

    const {
      width: resizeW,
      height: resizeH,
      ratio: resizeRatio,
    } = this.calculateResizeDimensions(originalWidth, originalHeight);

    const width = Math.ceil(resizeW / 32) * 32;
    const height = Math.ceil(resizeH / 32) * 32;

    // Canvas `drawImage` handles scaling and placement into the padded
    // target in a single call, which avoids the intermediate OpenCV
    // resize + Mat ↔ Canvas round trip for detection preprocessing.
    const paddedCanvas = this.platform.createCanvas(width, height);
    const paddedCtx = paddedCanvas.getContext("2d");
    paddedCtx.drawImage(canvas, 0, 0, originalWidth, originalHeight, 0, 0, resizeW, resizeH);

    const tensor = this.imageToTensor(paddedCanvas, width, height);

    this.log(
      `Detection preprocessed: original(${originalWidth}x${originalHeight}), ` +
        `model_input(${width}x${height}), resize_ratio: ${resizeRatio.toFixed(
          4
        )}, engine: ${this.engine}`
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
  private calculateResizeDimensions(originalWidth: number, originalHeight: number) {
    const MAX_SIDE_LEN = this.options.maxSideLength ?? 640;

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
   * Convert an image to a normalized tensor for model input.
   * Hot loop; assumes well-formed inputs to avoid per-pixel null coalescing.
   */
  private imageToTensor(canvas: CoreCanvas, width: number, height: number): Float32Array {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, width, height);
    const rgbaData = imageData.data;

    const channelSize = height * width;
    const tensor = new Float32Array(BaseDetectionService.NUM_CHANNELS * channelSize);
    const mean = this.options.mean ?? [0.485, 0.456, 0.406];
    const stdDeviation = this.options.stdDeviation ?? [0.229, 0.224, 0.225];
    const meanR = mean[0] ?? 0.485;
    const meanG = mean[1] ?? 0.456;
    const meanB = mean[2] ?? 0.406;
    const stdR = stdDeviation[0] ?? 0.229;
    const stdG = stdDeviation[1] ?? 0.224;
    const stdB = stdDeviation[2] ?? 0.225;
    // Pre-multiply the normalization constants so the per-pixel path is:
    //   v = pixel * scale - shift
    // saving a divide and a subtract on each of the 3 channels per pixel.
    const scaleR = 1.0 / (255.0 * stdR);
    const scaleG = 1.0 / (255.0 * stdG);
    const scaleB = 1.0 / (255.0 * stdB);
    const shiftR = meanR / stdR;
    const shiftG = meanG / stdG;
    const shiftB = meanB / stdB;
    const gOffset = channelSize;
    const bOffset = channelSize * 2;

    for (let i = 0, rgbaIdx = 0; i < channelSize; i++, rgbaIdx += 4) {
      const r = rgbaData[rgbaIdx];
      const g = rgbaData[rgbaIdx + 1];
      const b = rgbaData[rgbaIdx + 2];
      tensor[i] = r * scaleR - shiftR;
      tensor[gOffset + i] = g * scaleG - shiftG;
      tensor[bOffset + i] = b * scaleB - shiftB;
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
    let inputTensor: Tensor | undefined;
    try {
      this.log("Running detection inference...");

      inputTensor = new this.platform.ort.Tensor("float32", tensor, [1, 3, height, width]);

      const feeds = { x: inputTensor };
      const results = await this.session.run(feeds);
      const outputTensor = results[this.session.outputNames[0] || "sigmoid_0.tmp_0"];

      this.log("Detection inference complete!");

      if (!outputTensor) {
        console.error(
          `Output tensor ${this.session.outputNames[0]} not found in detection results`
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
  private tensorToCanvas(tensor: Float32Array, width: number, height: number): CoreCanvas {
    const canvas = this.platform.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const totalPixels = width * height;

    for (let i = 0; i < totalPixels; i++) {
      const probability = tensor[i] || 0;
      const grayValue = Math.round(probability * 255);
      const pixelIdx = i * 4;
      data[pixelIdx] = grayValue;
      data[pixelIdx + 1] = grayValue;
      data[pixelIdx + 2] = grayValue;
      data[pixelIdx + 3] = 255;
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
    minBoxAreaOnPadded: number = this.options.minimumAreaThreshold ?? 50,
    paddingVertical: number = this.options.paddingVertical || 0.4,
    paddingHorizontal: number = this.options.paddingHorizontal || 0.6
  ): Box[] {
    this.log("Post-processing detection results...");

    const { width, height, resizeRatio, originalWidth, originalHeight } = input;
    const canvas = this.tensorToCanvas(detection, width, height);
    this.lastDetectionCanvas = canvas;

    if (this.engine === "opencv" && this.platform.imageProcessor) {
      return this.postprocessWithOpenCV(
        canvas,
        width,
        height,
        resizeRatio,
        originalWidth,
        originalHeight,
        minBoxAreaOnPadded,
        paddingVertical,
        paddingHorizontal
      );
    }

    return this.postprocessWithCanvasNative(
      canvas,
      resizeRatio,
      originalWidth,
      originalHeight,
      minBoxAreaOnPadded,
      paddingVertical,
      paddingHorizontal
    );
  }

  /**
   * Post-process detection using OpenCV contours (v4-compatible, more accurate)
   */
  private postprocessWithOpenCV(
    canvas: CoreCanvas,
    width: number,
    height: number,
    resizeRatio: number,
    originalWidth: number,
    originalHeight: number,
    minBoxAreaOnPadded: number,
    paddingVertical: number,
    paddingHorizontal: number
  ): Box[] {
    const ip = this.platform.imageProcessor as NonNullable<typeof this.platform.imageProcessor>;
    const processor = new ip.ImageProcessor(canvas);
    try {
      processor.grayscale().convert({ rtype: ip.cv.CV_8UC1 });

      const contours = new ip.Contours(processor.toMat(), {
        mode: ip.cv.RETR_LIST,
        method: ip.cv.CHAIN_APPROX_SIMPLE,
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

      this.log(`Found ${boxes.length} potential text boxes (opencv)`);
      return boxes;
    } finally {
      processor.destroy();
    }
  }

  /**
   * Extract boxes from OpenCV contours
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

    contours.iterate((contour: cv.Mat) => {
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
   * Post-process detection using canvas-native region detection
   */
  private postprocessWithCanvasNative(
    canvas: CoreCanvas,
    resizeRatio: number,
    originalWidth: number,
    originalHeight: number,
    minBoxAreaOnPadded: number,
    paddingVertical: number,
    paddingHorizontal: number
  ): Box[] {
    // Use native canvas operations (no OpenCV needed)
    const processor = this.platform.canvas
      .createProcessor(canvas)
      .grayscale()
      .threshold({ thresh: 127 });

    // Use native region detection instead of OpenCV contours
    const regions = processor.findRegions({
      foreground: "light",
      minArea: minBoxAreaOnPadded,
      thresh: 0, // Use 0 for resized binary images (matches OpenCV behavior)
      padding: {
        vertical: paddingVertical,
        horizontal: paddingHorizontal,
      },
      scale: 1 / resizeRatio, // Map coordinates back to original image space
    });

    const boxes = this.extractBoxesFromRegions(regions, originalWidth, originalHeight);

    this.log(`Found ${boxes.length} potential text boxes (canvas-native)`);
    return boxes;
  }

  /**
   * Extract boxes from detected regions (native canvas implementation)
   */
  private extractBoxesFromRegions(
    regions: Array<{
      bbox: { x0: number; y0: number; x1: number; y1: number };
      area: number;
    }>,
    originalWidth: number,
    originalHeight: number
  ): Box[] {
    const boxes: Box[] = [];

    for (const region of regions) {
      const { bbox } = region;

      // Convert from exclusive x1/y1 to width/height format
      const box: Box = {
        x: Math.max(0, bbox.x0),
        y: Math.max(0, bbox.y0),
        width: bbox.x1 - bbox.x0,
        height: bbox.y1 - bbox.y0,
      };

      // Ensure box is within original image bounds
      if (box.x + box.width > originalWidth) {
        box.width = originalWidth - box.x;
      }
      if (box.y + box.height > originalHeight) {
        box.height = originalHeight - box.y;
      }

      // Filter out very small boxes
      if (box.width > 5 && box.height > 5) {
        boxes.push(box);
      }
    }

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

    const rightEdge = Math.min(maxWidth, rect.x + rect.width + horizontalPadding);
    const bottomEdge = Math.min(maxHeight, rect.y + rect.height + verticalPadding);
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
    canvas: CoreCanvas,
    _width: number,
    _height: number
  ): Promise<void> {
    const dir = this.debugging.debugFolder ?? "";
    await this.platform.saveDebugImage(canvas, "detection-debug", dir);

    this.log(`Probability map visualized and saved to: ${dir}`);
  }

  /**
   * Debug the bounding boxes by drawing a rectangle onto the original image
   */
  private async debugDetectedBoxes(image: ArrayBuffer | CoreCanvas, boxes: Box[]) {
    const canvas = this.platform.isCanvas(image)
      ? image
      : await this.platform.canvas.prepareCanvas(image);

    const ctx = canvas.getContext("2d");

    for (const box of boxes) {
      const { x, y, width, height } = box;
      this.platform.canvas.getToolkit().drawLine({
        ctx,
        x,
        y,
        width,
        height,
      });
    }

    const dir = this.debugging.debugFolder ?? "";
    await this.platform.saveDebugImage(canvas, "boxes-debug", dir);

    this.log(`Boxes visualized and saved to: ${dir}`);
  }
}
