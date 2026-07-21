// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { Tensor } from "onnxruntime-common";
import type { Box, DebuggingOptions, RecognitionOptions } from "../../interface.js";
import type { CanvasOps, CoreCanvas, PlatformProvider } from "../platform.js";
import { decodeResults } from "./ctc.js";
import { MIN_CROP_WIDTH } from "./ctc.js";
import { preprocessImage } from "./image-tensor.js";
import {
  groupBoxesIntoLines,
  mergeLineCrop,
  packIntoBatches,
  splitBatchTextByWidths,
} from "./line-grouping.js";
import type { RecognitionResult } from "../base-recognition.service.js";

/** Minimal context passed from `BaseRecognitionService` into strategy helpers. */
export type RecognitionContext = {
  platform: PlatformProvider;
  options: RecognitionOptions;
  debugging: DebuggingOptions;
  engine: "opencv" | "canvas-native";
  runInference: (inputTensor: Tensor) => Promise<Tensor>;
};

function cropRegion(sourceCanvas: CoreCanvas, box: Box, canvasOps: CanvasOps): CoreCanvas {
  return canvasOps.getToolkit().crop({
    bbox: { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height },
    canvas: sourceCanvas,
  });
}

async function recognizeText(
  cropCanvas: CoreCanvas,
  ctx: RecognitionContext,
  charactersDictionary?: string[]
): Promise<{ text: string; confidence: number }> {
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
    return decodeResults(result, dict, tensorWidth, ctx.debugging.verbose);
  } finally {
    inputTensor?.dispose();
  }
}

function sortByReadingOrder(results: RecognitionResult[]): RecognitionResult[] {
  return [...results].sort((a, b) => {
    if (Math.abs(a.box.y - b.box.y) < (a.box.height + b.box.height) / 4) {
      return a.box.x - b.box.x;
    }
    return a.box.y - b.box.y;
  });
}

/**
 * Per-box strategy: recognize each detected box individually.
 */
export async function runPerBoxStrategy(
  sourceCanvas: CoreCanvas,
  validBoxes: Array<{ box: Box; index: number }>,
  ctx: RecognitionContext,
  processBox: (
    canvas: CoreCanvas,
    box: Box,
    index: number,
    total: number,
    debugPath: string,
    dict?: string[]
  ) => Promise<RecognitionResult | null>,
  charactersDictionary?: string[]
): Promise<RecognitionResult[]> {
  const cropsDebugPath = ctx.debugging.debugFolder
    ? `${ctx.debugging.debugFolder}${ctx.platform.pathSeparator}crops`
    : "";
  if (ctx.debugging.debug && cropsDebugPath) {
    const toolkit = ctx.platform.canvas.getToolkit();
    if ("clearOutput" in toolkit && typeof toolkit.clearOutput === "function") {
      (toolkit as { clearOutput: (p: string) => void }).clearOutput(cropsDebugPath);
    }
  }

  const results: RecognitionResult[] = [];
  for (const { box, index } of validBoxes) {
    const result = await processBox(
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
  return sortByReadingOrder(results);
}

/**
 * Per-line strategy: merge same-line boxes and recognize per line.
 */
export async function runLineStrategy(
  sourceCanvas: CoreCanvas,
  validBoxes: Array<{ box: Box; index: number }>,
  ctx: RecognitionContext,
  charactersDictionary?: string[]
): Promise<RecognitionResult[]> {
  const lines = groupBoxesIntoLines(validBoxes);
  const results: RecognitionResult[] = [];

  for (const lineBoxes of lines) {
    if (lineBoxes.length === 1) {
      const lineBox = lineBoxes[0];
      if (!lineBox) continue;
      const { box } = lineBox;
      const cropCanvas = cropRegion(sourceCanvas, box, ctx.platform.canvas);
      const { text, confidence } = await recognizeText(cropCanvas, ctx, charactersDictionary);
      results.push({ text, box, confidence });
    } else {
      const { mergedCanvas, cropWidths } = mergeLineCrop(
        sourceCanvas,
        lineBoxes,
        ctx.platform.createCanvas.bind(ctx.platform),
        ctx.platform.canvas
      );
      const { text: lineText, confidence: lineConf } = await recognizeText(
        mergedCanvas,
        ctx,
        charactersDictionary
      );
      const pieces = splitBatchTextByWidths(lineText, cropWidths);
      for (let i = 0; i < lineBoxes.length; i++) {
        const lb = lineBoxes[i];
        if (!lb) continue;
        results.push({ text: (pieces[i] ?? "").trim(), box: lb.box, confidence: lineConf });
      }
    }
  }

  return sortByReadingOrder(results);
}

/**
 * Cross-line strategy: bin-pack line crops by width to minimize inference count.
 */
export async function runCrossLineStrategy(
  sourceCanvas: CoreCanvas,
  validBoxes: Array<{ box: Box; index: number }>,
  ctx: RecognitionContext,
  charactersDictionary?: string[]
): Promise<RecognitionResult[]> {
  const lines = groupBoxesIntoLines(validBoxes);
  const targetHeight = ctx.options.imageHeight ?? 48;
  const SEPARATOR_GAP = 20;

  const lineCrops: Array<{
    canvas: CoreCanvas;
    boxes: Array<{ box: Box; index: number }>;
    cropWidths: number[];
  }> = [];
  for (const lineBoxes of lines) {
    if (lineBoxes.length === 1) {
      const first = lineBoxes[0];
      if (!first) continue;
      const canvas = cropRegion(sourceCanvas, first.box, ctx.platform.canvas);
      lineCrops.push({ canvas, boxes: lineBoxes, cropWidths: [canvas.width] });
    } else {
      const { mergedCanvas, cropWidths } = mergeLineCrop(
        sourceCanvas,
        lineBoxes,
        ctx.platform.createCanvas.bind(ctx.platform),
        ctx.platform.canvas
      );
      lineCrops.push({ canvas: mergedCanvas, boxes: lineBoxes, cropWidths });
    }
  }

  const resized = lineCrops.map(({ canvas, boxes, cropWidths }, i) => {
    const ar = canvas.width / canvas.height;
    const resizedWidth = Math.max(MIN_CROP_WIDTH, Math.round(targetHeight * ar));
    return { canvas, boxes, cropWidths, resizedWidth, originalHeight: canvas.height, index: i };
  });

  const maxWidth = Math.max(...resized.map((r) => r.resizedWidth));
  const widthFactor = ctx.options.crossLineWidthFactor ?? 1.5;
  const batchTargetWidth = Math.round(maxWidth * widthFactor);

  const batches = packIntoBatches(
    resized,
    (item) => item.resizedWidth,
    batchTargetWidth,
    SEPARATOR_GAP
  );

  const results: RecognitionResult[] = [];
  for (const batch of batches) {
    const batchSorted = [...batch].sort((a, b) => a.index - b.index);
    const maxOriginalHeight = Math.max(...batchSorted.map((item) => item.originalHeight));
    const stretchedWidths = batchSorted.map((item) => {
      if (item.originalHeight >= maxOriginalHeight) return item.resizedWidth;
      const heightScale = maxOriginalHeight / item.originalHeight;
      return Math.max(MIN_CROP_WIDTH, Math.round(item.resizedWidth * heightScale));
    });

    const totalCropWidth = stretchedWidths.reduce((sum, w) => sum + w, 0);
    const totalWidth = totalCropWidth + SEPARATOR_GAP * (batchSorted.length - 1);
    const batchCanvas = ctx.platform.createCanvas(totalWidth, targetHeight);
    const bctx = batchCanvas.getContext("2d");
    bctx.fillStyle = "white";
    bctx.fillRect(0, 0, totalWidth, targetHeight);

    let offsetX = 0;
    for (let i = 0; i < batchSorted.length; i++) {
      const item = batchSorted[i];
      const drawWidth = stretchedWidths[i];
      if (item === undefined || drawWidth === undefined) continue;
      bctx.drawImage(
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
      if (i < batchSorted.length - 1) offsetX += SEPARATOR_GAP;
    }

    const { text: batchText, confidence: batchConf } = await recognizeText(
      batchCanvas,
      ctx,
      charactersDictionary
    );
    const lineTexts = splitBatchTextByWidths(batchText, stretchedWidths);

    for (let i = 0; i < batchSorted.length; i++) {
      const item = batchSorted[i];
      if (!item) continue;
      const lineText = lineTexts[i] ?? "";
      const firstBox = item.boxes[0];
      if (item.boxes.length === 1 && firstBox) {
        results.push({ text: lineText.trim(), box: firstBox.box, confidence: batchConf });
        continue;
      }
      const pieces = splitBatchTextByWidths(lineText, item.cropWidths);
      for (let j = 0; j < item.boxes.length; j++) {
        const lb = item.boxes[j];
        if (!lb) continue;
        results.push({ text: (pieces[j] ?? "").trim(), box: lb.box, confidence: batchConf });
      }
    }
  }

  return sortByReadingOrder(results);
}
