// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession, Tensor } from "onnxruntime-common";
import { DEFAULT_DEBUGGING_OPTIONS, DEFAULT_DETECTION_OPTIONS } from "../constants.js";
import type { Box, DebuggingOptions, DetectionOptions, ProcessingEngine } from "../interface.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";
import {
  calculateResizeDimensions,
  extractBoxesFromContours,
  extractBoxesFromRegions,
} from "./detection/box-geometry.js";
import { imageToTensor, tensorToCanvas } from "./detection/image-tensor.js";

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

    const maxSideLength = this.options.maxSideLength ?? 640;
    const {
      width: resizeW,
      height: resizeH,
      ratio: resizeRatio,
    } = calculateResizeDimensions(originalWidth, originalHeight, maxSideLength);

    const width = Math.ceil(resizeW / 32) * 32;
    const height = Math.ceil(resizeH / 32) * 32;

    const paddedCanvas = this.platform.createCanvas(width, height);
    const paddedCtx = paddedCanvas.getContext("2d");
    paddedCtx.drawImage(canvas, 0, 0, originalWidth, originalHeight, 0, 0, resizeW, resizeH);

    const mean = this.options.mean ?? [0.485, 0.456, 0.406];
    const stdDeviation = this.options.stdDeviation ?? [0.229, 0.224, 0.225];
    const tensor = imageToTensor(paddedCanvas, width, height, mean, stdDeviation);

    this.log(
      `Detection preprocessed: original(${originalWidth}x${originalHeight}), ` +
        `model_input(${width}x${height}), resize_ratio: ${resizeRatio.toFixed(
          4
        )}, engine: ${this.engine}`
    );

    return { tensor, width, height, resizeRatio, originalWidth, originalHeight };
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
    const canvas = tensorToCanvas(
      detection,
      width,
      height,
      this.platform.createCanvas.bind(this.platform)
    );
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

      const boxes = extractBoxesFromContours(
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
    const processor = this.platform.canvas
      .createProcessor(canvas)
      .grayscale()
      .threshold({ thresh: 127 });

    const regions = processor.findRegions({
      foreground: "light",
      minArea: minBoxAreaOnPadded,
      thresh: 0,
      padding: {
        vertical: paddingVertical,
        horizontal: paddingHorizontal,
      },
      scale: 1 / resizeRatio,
    });

    const boxes = extractBoxesFromRegions(regions, originalWidth, originalHeight);

    this.log(`Found ${boxes.length} potential text boxes (canvas-native)`);
    return boxes;
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
  private async debugDetectedBoxes(image: ArrayBuffer | CoreCanvas, boxes: Box[]): Promise<void> {
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
