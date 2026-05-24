// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession, Tensor } from "onnxruntime-common";
import type { CanvasProcessor } from "ppu-ocv/canvas";
import { DEFAULT_DEBUGGING_OPTIONS, DEFAULT_RECOGNITION_OPTIONS } from "../constants.js";
import type {
  Box,
  DebuggingOptions,
  ProcessingEngine,
  RecognitionOptions,
  RecognitionStrategy,
} from "../interface.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";

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

  private static readonly BLANK_INDEX = 0;
  private static readonly UNK_TOKEN = "<unk>";
  private static readonly MIN_CROP_WIDTH = 8;

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

      switch (strategy) {
        case "cross-line":
          return this.runCrossLineStrategy(sourceCanvasForCrop, validBoxes, charactersDictionary);
        case "per-line":
          return this.runLineStrategy(sourceCanvasForCrop, validBoxes, charactersDictionary);
        case "per-box":
        default:
          return this.runPerBoxStrategy(sourceCanvasForCrop, validBoxes, charactersDictionary);
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
   * Per-box strategy: recognize each box individually (most accurate, n inferences).
   */
  private async runPerBoxStrategy(
    sourceCanvas: CoreCanvas,
    validBoxes: Array<{ box: Box; index: number }>,
    charactersDictionary?: string[]
  ): Promise<RecognitionResult[]> {
    const cropsDebugPath = this.debugging.debugFolder
      ? `${this.debugging.debugFolder}${this.platform.pathSeparator}crops`
      : "";
    if (this.debugging.debug && cropsDebugPath) {
      const toolkit = this.platform.canvas.getToolkit();
      if ("clearOutput" in toolkit && typeof toolkit.clearOutput === "function") {
        toolkit.clearOutput(cropsDebugPath);
      }
    }

    const results: RecognitionResult[] = [];
    for (const { box, index } of validBoxes) {
      const result = await this.processBox(
        sourceCanvas,
        box,
        index,
        validBoxes.length,
        cropsDebugPath,
        charactersDictionary
      );
      if (result !== null) {
        results.push(result);
      }
    }

    return this.sortResultsByReadingOrder(results);
  }

  /**
   * Per-line strategy: group boxes into lines, merge same-line boxes,
   * and recognize per line (fewer inferences, good accuracy).
   */
  private async runLineStrategy(
    sourceCanvas: CoreCanvas,
    validBoxes: Array<{ box: Box; index: number }>,
    charactersDictionary?: string[]
  ): Promise<RecognitionResult[]> {
    const lines = this.groupBoxesIntoLines(validBoxes);
    const results: RecognitionResult[] = [];

    for (const lineBoxes of lines) {
      if (lineBoxes.length === 1) {
        const lineBox = lineBoxes[0];
        if (!lineBox) continue;
        const { box } = lineBox;
        const cropCanvas = this.cropRegion(sourceCanvas, box);
        const { text, confidence } = await this.recognizeText(cropCanvas, charactersDictionary);
        results.push({ text, box, confidence });
      } else {
        const { mergedCanvas } = this.mergeLineCrop(sourceCanvas, lineBoxes);
        const { text: lineText, confidence: lineConf } = await this.recognizeText(
          mergedCanvas,
          charactersDictionary
        );

        const totalWidth = lineBoxes.reduce((sum, b) => sum + b.box.width, 0);
        const words = lineText
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0);

        if (words.length === 0 || lineBoxes.length === 0) {
          for (const { box } of lineBoxes) {
            results.push({ text: lineText, box, confidence: lineConf });
          }
        } else if (words.length >= lineBoxes.length) {
          let wordIdx = 0;
          for (let i = 0; i < lineBoxes.length; i++) {
            const lb = lineBoxes[i];
            if (!lb) continue;
            const proportion = lb.box.width / totalWidth;
            const wordsForBox = Math.max(1, Math.round(words.length * proportion));
            const end = Math.min(wordIdx + wordsForBox, words.length);
            results.push({
              text: words.slice(wordIdx, end).join(" "),
              box: lb.box,
              confidence: lineConf,
            });
            wordIdx = end;
          }
          if (wordIdx < words.length) {
            const lastResult = results[results.length - 1];
            if (lastResult) lastResult.text += ` ${words.slice(wordIdx).join(" ")}`;
          }
        } else {
          for (const { box } of lineBoxes.slice(0, words.length)) {
            results.push({
              text: words.shift() ?? "",
              box,
              confidence: lineConf,
            });
          }
          for (const { box } of lineBoxes.slice(words.length)) {
            results.push({ text: "", box, confidence: lineConf });
          }
        }
      }
    }

    return this.sortResultsByReadingOrder(results);
  }

  /**
   * Cross-line strategy: pack line crops into uniform-width batches
   * across lines to minimize inference count while balancing accuracy.
   * Uses first-fit-decreasing bin packing to combine short lines
   * with other lines into batches of similar total width.
   * Within each batch, all crops are stretched to the same height so
   * character sizes are uniform across the stitched canvas.
   */
  private async runCrossLineStrategy(
    sourceCanvas: CoreCanvas,
    validBoxes: Array<{ box: Box; index: number }>,
    charactersDictionary?: string[]
  ): Promise<RecognitionResult[]> {
    const lines = this.groupBoxesIntoLines(validBoxes);
    const targetHeight = this.options.imageHeight ?? 48;
    const SEPARATOR_GAP = 20;

    const lineCrops: Array<{
      canvas: CoreCanvas;
      boxes: Array<{ box: Box; index: number }>;
    }> = [];

    for (const lineBoxes of lines) {
      if (lineBoxes.length === 1) {
        const firstLineBox = lineBoxes[0];
        if (!firstLineBox) continue;
        const canvas = this.cropRegion(sourceCanvas, firstLineBox.box);
        lineCrops.push({ canvas, boxes: lineBoxes });
      } else {
        const { mergedCanvas } = this.mergeLineCrop(sourceCanvas, lineBoxes);
        lineCrops.push({ canvas: mergedCanvas, boxes: lineBoxes });
      }
    }

    const resized = lineCrops.map(({ canvas, boxes }, i) => {
      const ar = canvas.width / canvas.height;
      const resizedWidth = Math.max(
        BaseRecognitionService.MIN_CROP_WIDTH,
        Math.round(targetHeight * ar)
      );
      return { canvas, boxes, resizedWidth, originalHeight: canvas.height, index: i };
    });

    const maxWidth = Math.max(...resized.map((r) => r.resizedWidth));
    const widthFactor = this.options.crossLineWidthFactor ?? 1.5;
    const batchTargetWidth = Math.round(maxWidth * widthFactor);

    const sortedDesc = [...resized].sort((a, b) => b.resizedWidth - a.resizedWidth);

    const batches: Array<Array<(typeof resized)[number]>> = [];
    const batchWidths: number[] = [];

    for (const item of sortedDesc) {
      let placed = false;
      for (let b = 0; b < batches.length; b++) {
        const currentBatch = batches[b];
        const currentBatchWidth = batchWidths[b];
        if (currentBatch === undefined || currentBatchWidth === undefined) continue;
        const gapAllowance = SEPARATOR_GAP * currentBatch.length;
        if (currentBatchWidth + gapAllowance + item.resizedWidth <= batchTargetWidth) {
          currentBatch.push(item);
          batchWidths[b] = currentBatchWidth + item.resizedWidth;
          placed = true;
          break;
        }
      }
      if (!placed) {
        batches.push([item]);
        batchWidths.push(item.resizedWidth);
      }
    }

    const results: RecognitionResult[] = [];

    for (const batch of batches) {
      const batchSorted = [...batch].sort((a, b) => a.index - b.index);
      const maxOriginalHeight = Math.max(...batchSorted.map((item) => item.originalHeight));

      const stretchedWidths = batchSorted.map((item) => {
        if (item.originalHeight >= maxOriginalHeight) return item.resizedWidth;
        const heightScale = maxOriginalHeight / item.originalHeight;
        return Math.max(
          BaseRecognitionService.MIN_CROP_WIDTH,
          Math.round(item.resizedWidth * heightScale)
        );
      });

      const totalCropWidth = stretchedWidths.reduce((sum, w) => sum + w, 0);
      const totalWidth = totalCropWidth + SEPARATOR_GAP * (batchSorted.length - 1);
      const batchCanvas = this.platform.createCanvas(totalWidth, targetHeight);
      const ctx = batchCanvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, totalWidth, targetHeight);

      let offsetX = 0;
      for (let i = 0; i < batchSorted.length; i++) {
        const item = batchSorted[i];
        const drawWidth = stretchedWidths[i];
        if (item === undefined || drawWidth === undefined) continue;
        ctx.drawImage(
          item.canvas,
          0,
          0,
          item.canvas.width,
          item.canvas.height,
          offsetX,
          0,
          drawWidth,
          targetHeight
        );
        offsetX += drawWidth;
        if (i < batchSorted.length - 1) {
          offsetX += SEPARATOR_GAP;
        }
      }

      const { text: batchText, confidence: batchConf } = await this.recognizeText(
        batchCanvas,
        charactersDictionary
      );

      const lineTexts = this.splitBatchTextByWidths(batchText, stretchedWidths);

      for (let i = 0; i < batchSorted.length; i++) {
        const item = batchSorted[i];
        if (!item) continue;
        const lineText = lineTexts[i] ?? "";

        if (item.boxes.length === 1) {
          const firstBox = item.boxes[0];
          results.push({
            text: lineText.trim(),
            box: firstBox?.box ?? { x: 0, y: 0, width: 0, height: 0 },
            confidence: batchConf,
          });
        } else {
          const words = lineText
            .trim()
            .split(/\s+/)
            .filter((w) => w.length > 0);
          const totalBoxWidth = item.boxes.reduce((sum, b) => sum + b.box.width, 0);
          let wordIdx = 0;
          for (const { box } of item.boxes) {
            if (wordIdx >= words.length) {
              results.push({ text: "", box, confidence: batchConf });
            } else {
              const proportion = box.width / totalBoxWidth;
              const wordsForBox = Math.max(1, Math.round(words.length * proportion));
              const end = Math.min(wordIdx + wordsForBox, words.length);
              results.push({
                text: words.slice(wordIdx, end).join(" "),
                box,
                confidence: batchConf,
              });
              wordIdx = end;
            }
          }
        }
      }
    }

    return this.sortResultsByReadingOrder(results);
  }

  /**
   * Split recognized text proportionally across stitched line crops
   * based on their pixel widths. The model produces text left-to-right,
   * so we assign characters proportionally to each crop's width.
   */
  private splitBatchTextByWidths(text: string, cropWidths: number[]): string[] {
    if (cropWidths.length === 1) {
      return [text];
    }

    const totalWidth = cropWidths.reduce((a, b) => a + b, 0);
    const chars = [...text];
    const charWidth = chars.length > 0 ? totalWidth / chars.length : 0;

    const result: string[] = [];
    let charIdx = 0;

    for (let i = 0; i < cropWidths.length; i++) {
      const proportionalChars =
        i < cropWidths.length - 1
          ? Math.round((cropWidths[i] ?? 0) / charWidth)
          : chars.length - charIdx;

      const end = Math.min(charIdx + proportionalChars, chars.length);
      result.push(chars.slice(charIdx, end).join(""));
      charIdx = end;
    }

    return result;
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
   * Process all valid boxes in parallel using Promise.all
   */
  private async processBoxesInParallel(
    sourceCanvas: CoreCanvas,
    boxData: Array<{ box: Box; index: number }>,
    charactersDictionary?: string[]
  ): Promise<RecognitionResult[]> {
    const cropsDebugPath = this.debugging.debugFolder
      ? `${this.debugging.debugFolder}${this.platform.pathSeparator}crops`
      : "";
    if (this.debugging.debug && cropsDebugPath) {
      const toolkit = this.platform.canvas.getToolkit();
      // clearOutput is only available in Node environment
      if ("clearOutput" in toolkit && typeof toolkit.clearOutput === "function") {
        toolkit.clearOutput(cropsDebugPath);
      }
    }

    const results: RecognitionResult[] = [];
    for (const { box, index } of boxData) {
      const result = await this.processBox(
        sourceCanvas,
        box,
        index,
        boxData.length,
        cropsDebugPath,
        charactersDictionary
      );
      if (result !== null) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Group boxes into lines based on vertical proximity,
   * then merge each line's boxes into a single recognition call.
   */
  private groupBoxesIntoLines(
    boxes: Array<{ box: Box; index: number }>
  ): Array<Array<{ box: Box; index: number }>> {
    if (boxes.length === 0) return [];

    const sorted = [...boxes].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

    const lines: Array<Array<{ box: Box; index: number }>> = [];
    const firstSorted = sorted[0];
    if (!firstSorted) return [];
    let currentLine = [firstSorted];
    let avgHeight = firstSorted.box.height;

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const previous = sorted[i - 1];
      if (!current || !previous) continue;
      const verticalGap = Math.abs(current.box.y - previous.box.y);
      const threshold = avgHeight * 0.5;

      if (verticalGap <= threshold) {
        currentLine.push(current);
        avgHeight =
          currentLine.reduce((sum, item) => sum + item.box.height, 0) / currentLine.length;
      } else {
        currentLine.sort((a, b) => a.box.x - b.box.x);
        lines.push(currentLine);
        currentLine = [current];
        avgHeight = current.box.height;
      }
    }

    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.box.x - b.box.x);
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Merge multiple boxes on the same line by cropping each box
   * individually and stitching them side by side into a single canvas.
   * All crops are stretched to the same height so character sizes are
   * uniform across the merged line.
   */
  private mergeLineCrop(
    sourceCanvas: CoreCanvas,
    lineBoxes: Array<{ box: Box; index: number }>
  ): { mergedCanvas: CoreCanvas; mergedBox: Box } {
    const minX = Math.min(...lineBoxes.map((b) => b.box.x));
    const minY = Math.min(...lineBoxes.map((b) => b.box.y));
    const maxRight = Math.max(...lineBoxes.map((b) => b.box.x + b.box.width));
    const maxBottom = Math.max(...lineBoxes.map((b) => b.box.y + b.box.height));

    const mergedBox: Box = {
      x: minX,
      y: minY,
      width: maxRight - minX,
      height: maxBottom - minY,
    };

    const commonHeight = maxBottom - minY;
    const commonWidth = lineBoxes.reduce(
      (sum, b) => sum + Math.round(b.box.width * (commonHeight / b.box.height)),
      0
    );

    const mergedCanvas = this.platform.createCanvas(commonWidth, commonHeight);
    const ctx = mergedCanvas.getContext("2d");

    let offsetX = 0;
    for (const { box } of lineBoxes) {
      const cropped = this.platform.canvas.getToolkit().crop({
        bbox: {
          x0: box.x,
          y0: box.y,
          x1: box.x + box.width,
          y1: box.y + box.height,
        },
        canvas: sourceCanvas,
      });
      const scaleX = commonHeight / box.height;
      const stretchedWidth = Math.round(box.width * scaleX);
      ctx.drawImage(cropped, 0, 0, box.width, box.height, offsetX, 0, stretchedWidth, commonHeight);
      offsetX += stretchedWidth;
    }

    return { mergedCanvas, mergedBox };
  }

  /**
   * Process a single text box
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
      const cropCanvas = this.cropRegion(sourceCanvas, box);
      const { text: recognizedText, confidence } = await this.recognizeText(
        cropCanvas,
        charactersDictionary
      );

      if (this.debugging.debug && debugPath) {
        await this.saveDebugCrop(cropCanvas, index, debugPath);
        this.logProcessingDetails(box, index, totalBoxes, recognizedText, start);
      }

      return { text: recognizedText, box, confidence };
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(`Error processing box ${index + 1}: ${err.message}`, err.stack);
      return null;
    }
  }

  /**
   * Sort recognition results by reading order (top to bottom, left to right)
   */
  private sortResultsByReadingOrder(results: RecognitionResult[]): RecognitionResult[] {
    return [...results].sort((a, b) => {
      const boxA = a.box;
      const boxB = b.box;

      // If boxes are roughly on the same line (within 1/4 of their combined heights)
      if (Math.abs(boxA.y - boxB.y) < (boxA.height + boxB.height) / 4) {
        return boxA.x - boxB.x; // Sort left to right
      }
      return boxA.y - boxB.y; // Otherwise sort top to bottom
    });
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
   * Crops a region from the source canvas based on bounding box
   */
  private cropRegion(sourceCanvas: CoreCanvas, box: Box): CoreCanvas {
    return this.platform.canvas.getToolkit().crop({
      bbox: {
        x0: box.x,
        y0: box.y,
        x1: box.x + box.width,
        y1: box.y + box.height,
      },
      canvas: sourceCanvas,
    });
  }

  /**
   * Saves a debug image of the cropped region
   */
  private async saveDebugCrop(
    cropCanvas: CoreCanvas,
    index: number,
    outputPath: string
  ): Promise<void> {
    await this.platform.saveDebugImage(
      cropCanvas,
      `crop_${String(index).padStart(3, "0")}.png`,
      outputPath
    );
  }

  /**
   * Logs details about the processing of a text region
   */
  private logProcessingDetails(
    box: Box,
    index: number,
    totalBoxes: number,
    text: string,
    startTime: number
  ): void {
    const processingTime = Date.now() - startTime;
    this.log(
      `Box ${index + 1}/${totalBoxes}: [x:${box.x}, y:${box.y}, w:${box.width}, h:${box.height}]` +
        `\n\t → "${text}" (processed in ${processingTime}ms)\n`
    );
  }

  /**
   * Recognizes text in a cropped canvas region
   */
  private async recognizeText(
    cropCanvas: CoreCanvas,
    charactersDictionary?: string[]
  ): Promise<{ text: string; confidence: number }> {
    const { imageTensor, tensorWidth, tensorHeight } = await this.preprocessImage(cropCanvas);

    let inputTensor: Tensor | undefined;
    try {
      inputTensor = new this.platform.ort.Tensor("float32", imageTensor, [
        1,
        3,
        tensorHeight,
        tensorWidth,
      ]);

      const results = await this.runInference(inputTensor);
      return this.decodeResults(results, charactersDictionary);
    } finally {
      inputTensor?.dispose();
    }
  }

  /**
   * Preprocesses a cropped image for the recognition model
   */
  private async preprocessImage(cropCanvas: CoreCanvas): Promise<{
    imageTensor: Float32Array;
    tensorWidth: number;
    tensorHeight: number;
  }> {
    const targetHeight = this.options.imageHeight ?? 48;

    const originalWidth = cropCanvas.width;
    const originalHeight = cropCanvas.height;

    if (originalHeight === 0 || originalWidth === 0) {
      throw new Error(`Crop dimensions are zero: ${originalWidth}x${originalHeight}`);
    }

    const aspectRatio = originalWidth / originalHeight;
    const resizedWidth = Math.max(
      BaseRecognitionService.MIN_CROP_WIDTH,
      Math.round(targetHeight * aspectRatio)
    );

    if (this.engine === "opencv" && this.platform.imageProcessor) {
      // OpenCV-based resize
      const imgProcessor = new this.platform.imageProcessor.ImageProcessor(cropCanvas);
      try {
        imgProcessor.resize({
          width: resizedWidth,
          height: targetHeight,
        });

        const imageTensor = this.createImageTensorFromCanvas(
          imgProcessor.toCanvas(),
          resizedWidth,
          targetHeight
        );

        return {
          imageTensor,
          tensorWidth: resizedWidth,
          tensorHeight: targetHeight,
        };
      } finally {
        imgProcessor.destroy();
      }
    } else {
      // Canvas-native resize
      const processor = this.platform.canvas.createProcessor(cropCanvas).resize({
        width: resizedWidth,
        height: targetHeight,
      });

      const imageTensor = this.createImageTensor(processor, resizedWidth, targetHeight);

      return {
        imageTensor,
        tensorWidth: resizedWidth,
        tensorHeight: targetHeight,
      };
    }
  }

  /**
   * Creates a normalized image tensor from a CanvasProcessor
   */
  private createImageTensor(
    processor: CanvasProcessor,
    width: number,
    height: number
  ): Float32Array {
    const canvas = processor.toCanvas();
    return this.createImageTensorFromCanvas(canvas, width, height);
  }

  /**
   * Creates a normalized image tensor from a canvas (shared by both engines).
   *
   * The model expects three identical channels (grayscale replicated to RGB).
   * We fill channel 0 once, then use `Float32Array.copyWithin` to memcpy
   * the block into channels 1 and 2 in a single operation.
   */
  private createImageTensorFromCanvas(
    canvas: CoreCanvas,
    width: number,
    height: number
  ): Float32Array {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixelData = imageData.data;

    const channelSize = height * width;
    const imageTensor = new Float32Array(3 * channelSize);

    // Fill channel 0 with normalized R (input is grayscale so R==G==B).
    // Normalization: pixel / 127.5 - 1.0 => [-1, 1].
    const INV_127_5 = 1 / 127.5;
    for (let i = 0, p = 0; i < channelSize; i++, p += 4) {
      imageTensor[i] = (pixelData[p] ?? 0) * INV_127_5 - 1.0;
    }

    // Replicate channel 0 into channels 1 and 2 via a block memcpy.
    imageTensor.copyWithin(channelSize, 0, channelSize);
    imageTensor.copyWithin(channelSize * 2, 0, channelSize);

    return imageTensor;
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

  /**
   * Decodes the results from the model output tensor
   */
  private decodeResults(
    outputTensor: Tensor,
    charactersDictionary?: string[]
  ): {
    text: string;
    confidence: number;
  } {
    const outputData = outputTensor.data as Float32Array;
    const outputShape = outputTensor.dims;

    const sequenceLength = outputShape[1];
    const numClasses = outputShape[2];

    const rawDict = charactersDictionary || this.options.charactersDictionary;

    if (!rawDict) {
      return { text: "", confidence: 0 };
    }

    // PaddleOCR class 0 is the CTC blank. If the dict omits that slot, prepend it (issue #15).
    let dict = rawDict;
    if (rawDict.length === numClasses - 1) {
      dict = ["", ...rawDict];
    } else if (numClasses !== rawDict.length) {
      console.warn(
        `Warning: Model output classes (${numClasses}) does not match dictionary length (${rawDict.length}).\n Consider using our model & dictionary catalogue at https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models.`
      );
    }

    return this.ctcGreedyDecode(outputData, sequenceLength, numClasses, dict);
  }

  /**
   * Performs greedy decoding on CTC model output logits.
   *
   * Hot loop: argmax and character handling are inlined, and per-character
   * confidence is accumulated as a running sum instead of a backing array.
   */
  private ctcGreedyDecode(
    logits: Float32Array,
    sequenceLength: number,
    numClasses: number,
    charDict: string[]
  ): { text: string; confidence: number } {
    const dictLen = charDict.length;
    const lastDictIndex = dictLen - 1;
    const BLANK = BaseRecognitionService.BLANK_INDEX;
    const UNK = BaseRecognitionService.UNK_TOKEN;

    let decodedText = "";
    let lastCharIndex = -1;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (let t = 0; t < sequenceLength; t++) {
      // Inline argmax over the `numClasses` logits at timestep `t`.
      const base = t * numClasses;
      let maxProb = logits[base] ?? -Infinity;
      let maxIndex = 0;
      for (let c = 1; c < numClasses; c++) {
        const prob = logits[base + c] ?? -Infinity;
        if (prob > maxProb) {
          maxProb = prob;
          maxIndex = c;
        }
      }

      if (maxIndex === BLANK || maxIndex === lastCharIndex) {
        lastCharIndex = maxIndex;
        continue;
      }

      if (maxIndex >= 0 && maxIndex < dictLen) {
        const char = charDict[maxIndex] ?? "";
        if (maxIndex === lastDictIndex) {
          // The last dictionary entry is either the unknown-token marker
          // (skip) or the trailing blank/space (emit a space).
          if (char !== UNK) {
            decodedText += " ";
            confidenceSum += maxProb;
            confidenceCount++;
          }
        } else {
          decodedText += char;
          confidenceSum += maxProb;
          confidenceCount++;
        }
      } else {
        console.warn(
          `Decoded index ${maxIndex} out of bounds for charDict (length ${dictLen}) at t=${t}`
        );
      }

      lastCharIndex = maxIndex;
    }

    const confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
    return { text: decodedText, confidence };
  }
}
