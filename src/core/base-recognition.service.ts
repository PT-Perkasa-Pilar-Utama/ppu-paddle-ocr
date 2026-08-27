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
  RecognizeOptions,
} from "../interface.js";
import { calculateResizeDimensions } from "./detection/box-geometry.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";
import { supportsDynamicBatch } from "./recognition/batched.js";
import type { RecognitionContext } from "./recognition/strategies.js";
import {
  runCrossLineStrategy,
  runLineStrategy,
  runPerBoxStrategy,
} from "./recognition/strategies.js";

/**
 * A single recognized text item with its bounding box and confidence.
 */
/** A crop source canvas and the scale applied to reach it. */
export type CropSource = { canvas: CoreCanvas; ratio: number };

export type RecognitionResult = {
  /** The recognized text string. */
  text: string;
  /** Bounding box of the text region in the original image coordinates. */
  box: Box;
  /** Recognition confidence score (0-1). */
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
    strategy: RecognitionStrategy = "per-line",
    perCallOptions?: RecognizeOptions
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

      const { canvas: cropCanvas, ratio: cropRatio } = this.buildCropCanvas(sourceCanvasForCrop);
      const cropBoxes =
        cropRatio === 1
          ? validBoxes
          : validBoxes.map((v) => ({ ...v, box: scaleBox(v.box, cropRatio) }));

      const ctx = this.buildContext(perCallOptions);

      let results: RecognitionResult[];
      switch (strategy) {
        case "cross-line":
          results = await runCrossLineStrategy(cropCanvas, cropBoxes, ctx, charactersDictionary);
          break;
        case "per-line":
          results = await runLineStrategy(cropCanvas, cropBoxes, ctx, charactersDictionary);
          break;
        case "per-box":
        default:
          results = await runPerBoxStrategy(
            cropCanvas,
            cropBoxes,
            ctx,
            (canvas, box, index, total, debugPath, dict) =>
              this.processBox(canvas, box, index, total, debugPath, dict),
            charactersDictionary
          );
      }

      if (cropRatio !== 1) {
        results = results.map((r) => ({ ...r, box: scaleBox(r.box, 1 / cropRatio) }));
      }

      const minimumConfidence =
        perCallOptions?.minimumConfidence ?? this.options.minimumConfidence ?? 0.5;
      return minimumConfidence > 0
        ? results.filter((r) => {
            const bar = /[\p{L}\p{N}]/u.test(r.text)
              ? minimumConfidence
              : Math.min(1, minimumConfidence + 0.3);
            return r.confidence >= bar;
          })
        : results;
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
  private buildContext(perCallOptions?: RecognizeOptions): RecognitionContext {
    const effectiveOptions: RecognitionOptions = {
      ...this.options,
      ...(perCallOptions?.spaceRecovery !== undefined
        ? { spaceRecovery: perCallOptions.spaceRecovery }
        : {}),
      ...(perCallOptions?.rotateVerticalCrops !== undefined
        ? { rotateVerticalCrops: perCallOptions.rotateVerticalCrops }
        : {}),
      ...(perCallOptions?.recBatchSize !== undefined
        ? { recBatchSize: perCallOptions.recBatchSize }
        : {}),
    };

    return {
      platform: this.platform,
      // Fixed-batch model exports cannot take stacked tensors; clamp to the
      // sequential path rather than failing at session.run.
      options: supportsDynamicBatch(this.session)
        ? effectiveOptions
        : { ...effectiveOptions, recBatchSize: 1 },
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
   * Downsizes the crop source when it's larger than `options.maxCropSourceSideLength`
   * (default 2000, independent of and deliberately above detection's own
   * "auto" cap - max 1920, see `resolveMaxSideLength`) - e.g. a 4961x7016
   * full-resolution scan mixed into an otherwise phone-photo-sized dataset
   * costs seconds per image in decode + repeated per-line crops, unrelated
   * to detection or recognition compute itself. The default keeps ordinary
   * photos (up to ~2000px) untouched with today's crop fidelity; callers
   * can raise it for full-resolution crops on larger sources, or lower it to
   * trade accuracy for speed. Returns the source unchanged (ratio 1) when
   * it's already within the cap.
   */
  private buildCropCanvas(source: CoreCanvas): CropSource {
    const { width, height } = source;
    const maxCropSourceSideLength = this.options.maxCropSourceSideLength ?? 2000;
    const {
      width: resizeW,
      height: resizeH,
      ratio,
    } = calculateResizeDimensions(width, height, maxCropSourceSideLength);

    if (ratio === 1) {
      return { canvas: source, ratio: 1 };
    }

    const resized = this.platform.createCanvas(resizeW, resizeH);
    resized.getContext("2d").drawImage(source, 0, 0, width, height, 0, 0, resizeW, resizeH);
    return { canvas: resized, ratio };
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
      return decodeResults(
        result,
        dict,
        tensorWidth,
        this.debugging.verbose,
        ctx.options.spaceRecovery ?? false
      );
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
    // A macrotask boundary before each inference lets a browser main thread
    // paint and handle input between WASM blocks; plain `await`s only queue
    // microtasks, which the renderer cannot interleave with.
    const yieldMs = this.options.mainThreadYieldMs ?? 0;
    if (yieldMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, yieldMs));
    }

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

/**
 * Scales a box's coordinates and dimensions by `ratio`, rounding to whole pixels.
 *
 * Width/height clamp to a 1px floor: an aggressive `maxCropSourceSideLength`
 * on a very large source (e.g. 300 on a 10000px scan, ratio 0.03) can round a
 * thin box to zero, and a zero-size crop throws inside the strategy - which
 * `run()`'s catch-all would turn into an empty result for the whole image.
 */
function scaleBox(box: Box, ratio: number): Box {
  return {
    x: Math.round(box.x * ratio),
    y: Math.round(box.y * ratio),
    width: Math.max(1, Math.round(box.width * ratio)),
    height: Math.max(1, Math.round(box.height * ratio)),
  };
}
