// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { Box } from "../../interface.js";
import type { RecognitionResult } from "../base-recognition.service.js";
import type { CanvasOps, CoreCanvas } from "../platform.js";

/**
 * Groups detected boxes into lines based on vertical proximity.
 *
 * Boxes within 50% of the average line height are placed on the same line,
 * then each line is sorted left-to-right.
 */
export function groupBoxesIntoLines(
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
      avgHeight = currentLine.reduce((sum, item) => sum + item.box.height, 0) / currentLine.length;
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
 * Merges multiple same-line boxes into a single stitched canvas.
 *
 * All crops are stretched to a common height so character sizes are uniform.
 */
export function mergeLineCrop(
  sourceCanvas: CoreCanvas,
  lineBoxes: Array<{ box: Box; index: number }>,
  createCanvas: (width: number, height: number) => CoreCanvas,
  canvasOps: CanvasOps
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

  const mergedCanvas = createCanvas(commonWidth, commonHeight);
  const ctx = mergedCanvas.getContext("2d");

  let offsetX = 0;
  for (const { box } of lineBoxes) {
    const cropped = canvasOps.getToolkit().crop({
      bbox: { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height },
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
 * Splits recognized text proportionally across stitched line crops by pixel width.
 *
 * Characters are assigned proportionally to each crop's share of total width.
 */
export function splitBatchTextByWidths(text: string, cropWidths: number[]): string[] {
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
 * Packs sized items into width-bounded batches (first-fit-decreasing).
 *
 * A batch accepts an item while its running width plus a per-item separator gap
 * stays within `targetWidth`; otherwise a new batch is opened.
 */
export function packIntoBatches<T>(
  items: T[],
  widthOf: (item: T) => number,
  targetWidth: number,
  separatorGap: number
): T[][] {
  const sorted = [...items].sort((a, b) => widthOf(b) - widthOf(a));
  const batches: T[][] = [];
  const widths: number[] = [];

  for (const item of sorted) {
    let placed = false;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const width = widths[b];
      if (batch === undefined || width === undefined) continue;
      const gap = separatorGap * batch.length;
      if (width + gap + widthOf(item) <= targetWidth) {
        batch.push(item);
        widths[b] = width + widthOf(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      batches.push([item]);
      widths.push(widthOf(item));
    }
  }

  return batches;
}

/**
 * Distributes one recognized line's text across its source boxes.
 *
 * A single box takes the whole text; multiple boxes split the words by each
 * box's share of the total width.
 */
export function distributeLineText(
  boxes: Array<{ box: Box; index: number }>,
  lineText: string,
  confidence: number
): RecognitionResult[] {
  if (boxes.length === 1) {
    const first = boxes[0];
    return [
      { text: lineText.trim(), box: first?.box ?? { x: 0, y: 0, width: 0, height: 0 }, confidence },
    ];
  }

  const words = lineText
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const totalBoxWidth = boxes.reduce((sum, b) => sum + b.box.width, 0);

  const results: RecognitionResult[] = [];
  let wordIdx = 0;
  for (const { box } of boxes) {
    if (wordIdx >= words.length) {
      results.push({ text: "", box, confidence });
      continue;
    }
    const proportion = box.width / totalBoxWidth;
    const wordsForBox = Math.max(1, Math.round(words.length * proportion));
    const end = Math.min(wordIdx + wordsForBox, words.length);
    results.push({ text: words.slice(wordIdx, end).join(" "), box, confidence });
    wordIdx = end;
  }

  return results;
}
