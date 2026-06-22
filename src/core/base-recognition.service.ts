// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession, Tensor } from "onnxruntime-common";
import { DEFAULT_DEBUGGING_OPTIONS, DEFAULT_RECOGNITION_OPTIONS } from "../constants.js";
import type {
  Box,
  DebuggingOptions,
  ProcessingEngine,
  RecognitionOptions,
  RecognitionStrategy,
} from "../interface.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";
import type { RecognitionContext } from "./recognition/strategies.js";
import {
  runCrossLineStrategy,
  runLineStrategy,
  runPerBoxStrategy,
} from "./recognition/strategies.js";

/**
 * A single recognized text item with its bounding box and confidence.
 */
export type RecognitionResult = {
  /** The recognized text string. */
  text: string;
  /** Bounding box of the text region in the original image coordinates. */
  box: Box;
  /** Recognition confidence score (0–1). */
  confidence: number;
};

/**
 * Service for detecting and recognizing text in images
 */
export class BaseRecognitionService {
  protected readonly options: RecognitionOptions;
  protected readonly debugging: DebuggingOptions;
  protected readonly session: InferenceSession;
  protected readonly platform: PlatformProvider;
  protected readonly engine: ProcessingEngine;

  constructor(
    platform: PlatformProvider,
    session: InferenceSession,
    options: Partial<RecognitionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
    engine: ProcessingEngine = "opencv"
  ) {
    this.platform = platform;
    this.session = session;

    this.options = {
      ...DEFAULT_RECOGNITION_OPTIONS,
      ...options,
    };

    this.debugging = {
      ...DEFAULT_DEBUGGING_OPTIONS,
      ...debugging,
    };

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
      console.log(`[RecognitionService] ${message}`);
    }
  }

  /**
   * Main method to run text recognition on an image with detected regions
   * @param image The original image buffer or image in Canvas
   * @param detection Array of bounding boxes from text detection
   * @param charactersDictionary Optional custom character dictionary
   * @returns Array of recognition results with text and bounding box, sorted in reading order
   */
  async run(
    image: ArrayBuffer | CoreCanvas,
    detection: Box[],
    charactersDictionary?: string[],
    strategy: RecognitionStrategy = "per-line"
  ): Promise<RecognitionResult[]> {
    this.log("Starting text recognition process");

    try {
      let sourceCanvasForCrop: CoreCanvas;
      if (this.platform.isCanvas(image)) {
        sourceCanvasForCrop = image;
      } else if (this.engine === "opencv" && this.platform.imageProcessor) {
        sourceCanvasForCrop = await this.platform.imageProcessor.prepareCanvas(image);
      } else {
        sourceCanvasForCrop = await this.platform.canvas.prepareCanvas(image);
      }

      const validBoxes = this.filterValidBoxes(detection);

      if (validBoxes.length === 0) {
        return [];
      }

      const ctx = this.buildContext();

      switch (strategy) {
        case "cross-line":
          return runCrossLineStrategy(sourceCanvasForCrop, validBoxes, ctx, charactersDictionary);
        case "per-line":
          return runLineStrategy(sourceCanvasForCrop, validBoxes, ctx, charactersDictionary);
        case "per-box":
        default:
          return runPerBoxStrategy(
            sourceCanvasForCrop,
            validBoxes,
            ctx,
            (canvas, box, index, total, debugPath, dict) =>
              this.processBox(canvas, box, index, total, debugPath, dict),
            charactersDictionary
          );
      }
    } catch (error) {
      console.error(
        "Error during text recognition:",
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Builds the strategy context from this service's state.
   */
  private buildContext(): RecognitionContext {
    return {
      platform: this.platform,
      options: this.options,
      debugging: this.debugging,
      engine: this.engine,
      runInference: (t) => this.runInference(t),
    };
  }

  /**
   * Filter out invalid boxes
   */
  private filterValidBoxes(boxes: Box[]): Array<{ box: Box; index: number }> {
    return boxes
      .map((box, index) => ({ box, index }))
      .filter(({ box, index }) => this.isValidBox(box, index));
  }

  /**
   * Process a single text box (used by per-box strategy for debug output)
   */
  private async processBox(
    sourceCanvas: CoreCanvas,
    box: Box,
    index: number,
    totalBoxes: number,
    debugPath: string,
    charactersDictionary?: string[]
  ): Promise<RecognitionResult | null> {
    const start = Date.now();

    try {
      const cropCanvas = this.platform.canvas.getToolkit().crop({
        bbox: { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height },
        canvas: sourceCanvas,
      });

      const ctx = this.buildContext();
      const { text: recognizedText, confidence } = await this.recognizeTextViaContext(
        cropCanvas,
        ctx,
        charactersDictionary
      );

      if (this.debugging.debug && debugPath) {
        await this.platform.saveDebugImage(
          cropCanvas,
          `crop_${String(index).padStart(3, "0")}.png`,
          debugPath
        );
        const processingTime = Date.now() - start;
        this.log(
          `Box ${index + 1}/${totalBoxes}: [x:${box.x}, y:${box.y}, w:${box.width}, h:${box.height}]` +
            `\n\t → "${recognizedText}" (processed in ${processingTime}ms)\n`
        );
      }

      return { text: recognizedText, box, confidence };
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(`Error processing box ${index + 1}: ${err.message}`, err.stack);
      return null;
    }
  }

  private async recognizeTextViaContext(
    cropCanvas: CoreCanvas,
    ctx: RecognitionContext,
    charactersDictionary?: string[]
  ): Promise<{ text: string; confidence: number }> {
    const { preprocessImage } = await import("./recognition/image-tensor.js");
    const { decodeResults } = await import("./recognition/ctc.js");

    const targetHeight = ctx.options.imageHeight ?? 48;
    const imageProcessor = ctx.engine === "opencv" ? ctx.platform.imageProcessor : undefined;

    const { imageTensor, tensorWidth, tensorHeight } = await preprocessImage(
      cropCanvas,
      targetHeight,
      imageProcessor,
      ctx.platform.canvas.createProcessor.bind(ctx.platform.canvas)
    );

    let inputTensor: Tensor | undefined;
    try {
      inputTensor = new ctx.platform.ort.Tensor("float32", imageTensor, [
        1,
        3,
        tensorHeight,
        tensorWidth,
      ]);
      const result = await ctx.runInference(inputTensor);
      const dict = charactersDictionary ?? ctx.options.charactersDictionary ?? [];
      return decodeResults(result, dict, tensorWidth, this.debugging.verbose);
    } finally {
      inputTensor?.dispose();
    }
  }

  /**
   * Validates if a bounding box has valid dimensions
   */
  private isValidBox(box: Box, index: number): boolean {
    if (box.width <= 0 || box.height <= 0) {
      console.warn(`Skipping invalid box ${index + 1}: w=${box.width}, h=${box.height}`);
      return false;
    }
    return true;
  }

  /**
   * Runs the ONNX inference session with the prepared tensor
   */
  private async runInference(inputTensor: Tensor): Promise<Tensor> {
    const feeds = { x: inputTensor };
    const results = await this.session.run(feeds);

    const outputNodeName = Object.keys(results)[0];
    const outputTensor = outputNodeName ? results[outputNodeName] : undefined;

    if (!outputTensor) {
      throw new Error(
        `Recognition output tensor '${outputNodeName}' not found. Available keys: ${Object.keys(
          results
        )}`
      );
    }

    return outputTensor;
  }
}
