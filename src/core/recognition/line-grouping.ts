// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { Box } from "../../interface.js";
import type { FlattenedPaddleOcrResult, PaddleOcrResult } from "../base-paddle-ocr.service.js";
import type { RecognitionResult } from "../base-recognition.service.js";
import type { CanvasOps, CoreCanvas } from "../platform.js";

/**
 * Shapes recognition results into the flat {@link FlattenedPaddleOcrResult}:
 * space-joined text and the mean confidence across all items.
 */
export function flattenResults(results: RecognitionResult[]): FlattenedPaddleOcrResult {
  if (results.length === 0) {
    return { text: "", results: [], confidence: 0 };
  }

  const text = results.map((r) => r.text).join(" ");
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

  return {
    text,
    results,
    confidence: avgConfidence,
  };
}

/**
 * Shapes recognition results into the grouped {@link PaddleOcrResult}:
 * items within half the running average height of the current line's y are
 * kept on that line, each line is sorted left-to-right, and lines are joined
 * with newlines.
 */
export function groupResultsByLine(results: RecognitionResult[]): PaddleOcrResult {
  if (results.length === 0) {
    return { text: "", lines: [], confidence: 0 };
  }

  const lines: RecognitionResult[][] = [];
  let currentLine: RecognitionResult[] = [];
  const firstResult = results[0];
  if (!firstResult) return { text: "", lines: [], confidence: 0 };
  let currentY = firstResult.box.y;
  let avgHeight = firstResult.box.height;

  for (const result of results) {
    const { box } = result;

    if (Math.abs(box.y - currentY) < avgHeight / 2) {
      currentLine.push(result);
      avgHeight = (avgHeight * (currentLine.length - 1) + box.height) / currentLine.length;
    } else {
      currentLine.sort((a, b) => a.box.x - b.box.x);
      lines.push(currentLine);
      currentLine = [result];
      currentY = box.y;
      avgHeight = box.height;
    }
  }

  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.box.x - b.box.x);
    lines.push(currentLine);
  }

  const fullText = lines.map((line) => line.map((r) => r.text).join(" ")).join("\n");

  const totalConfidence = lines.reduce(
    (sum, line) => sum + line.reduce((s, r) => s + r.confidence, 0),
    0
  );
  const totalItems = lines.reduce((sum, line) => sum + line.length, 0);

  return {
    text: fullText,
    lines,
    confidence: totalItems > 0 ? totalConfidence / totalItems : 0,
  };
}

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
  let currentLineHeightSum = firstSorted.box.height;
  let avgHeight = firstSorted.box.height;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];
    if (!current || !previous) continue;
    const verticalGap = Math.abs(current.box.y - previous.box.y);
    const threshold = avgHeight * 0.5;

    if (verticalGap <= threshold) {
      currentLine.push(current);
      currentLineHeightSum += current.box.height;
      avgHeight = currentLineHeightSum / currentLine.length;
    } else {
      currentLine.sort((a, b) => a.box.x - b.box.x);
      lines.push(currentLine);
      currentLine = [current];
      currentLineHeightSum = current.box.height;
      avgHeight = current.box.height;
    }
  }

  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.box.x - b.box.x);
    lines.push(currentLine);
  }

  return lines;
}

/** Max factor a box may be stretched horizontally when normalized to the line height. */
const MAX_BOX_STRETCH = 4;
/** Max width of a merged line canvas; safe on every skia/browser surface. */
const MAX_MERGED_WIDTH = 16384;

/**
 * Merges multiple same-line boxes into a single stitched canvas.
 *
 * All crops are stretched to a common height so character sizes are uniform.
 * Degenerate boxes (far shorter than the line) have their stretch clamped so
 * the merged width stays bounded. A white gap is drawn between crops so the
 * recognizer sees a word boundary at each box seam; `cropWidths` gives each
 * box's share of the stitched width (its crop plus the trailing gap) for
 * mapping recognized text back to its source box.
 */
export function mergeLineCrop(
  sourceCanvas: CoreCanvas,
  lineBoxes: Array<{ box: Box; index: number }>,
  createCanvas: (width: number, height: number) => CoreCanvas,
  canvasOps: CanvasOps
): { mergedCanvas: CoreCanvas; mergedBox: Box; cropWidths: number[] } {
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
  // ~0.4 of the line height approximates a space glyph at that text size.
  let gap = Math.max(1, Math.round(commonHeight * 0.4));
  // Thin boxes (underlines, table rules) grouped into a line would be
  // stretched by commonHeight/height, multiplying their width; clamp the
  // per-box stretch and the total so the merged canvas stays within
  // platform surface limits.
  let widths = lineBoxes.map(({ box }) =>
    Math.max(1, Math.round(box.width * Math.min(commonHeight / box.height, MAX_BOX_STRETCH)))
  );
  const totalWidth = widths.reduce((sum, w) => sum + w, 0) + gap * (lineBoxes.length - 1);
  if (totalWidth > MAX_MERGED_WIDTH) {
    const shrink = MAX_MERGED_WIDTH / totalWidth;
    widths = widths.map((w) => Math.max(1, Math.round(w * shrink)));
    gap = Math.max(1, Math.floor(gap * shrink));
  }
  const commonWidth = widths.reduce((sum, w) => sum + w, 0) + gap * (lineBoxes.length - 1);

  const mergedCanvas = createCanvas(commonWidth, commonHeight);
  const ctx = mergedCanvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, commonWidth, commonHeight);

  let offsetX = 0;
  const cropWidths: number[] = [];
  for (let i = 0; i < lineBoxes.length; i++) {
    const entry = lineBoxes[i];
    const stretchedWidth = widths[i];
    if (!entry || stretchedWidth === undefined) continue;
    const { box } = entry;
    const cropped = canvasOps.getToolkit().crop({
      bbox: { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height },
      canvas: sourceCanvas,
    });
    ctx.drawImage(cropped, 0, 0, box.width, box.height, offsetX, 0, stretchedWidth, commonHeight);
    const trailingGap = i < lineBoxes.length - 1 ? gap : 0;
    cropWidths.push(stretchedWidth + trailingGap);
    offsetX += stretchedWidth + trailingGap;
  }

  return { mergedCanvas, mergedBox, cropWidths };
}

/** How far (in characters) a width-proportional cut may move to land on a space. */
const CUT_SNAP_RANGE = 4;

/**
 * Splits recognized text proportionally across stitched line crops by pixel width.
 *
 * Characters are assigned proportionally to each crop's share of total width.
 * Each cut snaps to the nearest whitespace within {@link CUT_SNAP_RANGE} so
 * proportional drift does not slice through a word; the space itself is
 * dropped from both sides of the cut.
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
    if (i === cropWidths.length - 1) {
      result.push(chars.slice(charIdx).join(""));
      break;
    }

    const ideal = Math.min(charIdx + Math.round((cropWidths[i] ?? 0) / charWidth), chars.length);
    let cut = ideal;
    let skipSpace = false;
    for (let d = 0; d <= CUT_SNAP_RANGE && !skipSpace; d++) {
      for (const cand of [ideal - d, ideal + d]) {
        const ch = chars[cand];
        if (cand > charIdx && cand < chars.length && ch !== undefined && /\s/.test(ch)) {
          cut = cand;
          skipSpace = true;
          break;
        }
      }
    }

    result.push(chars.slice(charIdx, cut).join(""));
    charIdx = skipSpace ? cut + 1 : cut;
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
