// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { Tensor } from "onnxruntime-common";

/** CTC blank token index. */
export const BLANK_INDEX = 0;

/** Unknown token marker used in PaddleOCR dictionaries. */
export const UNK_TOKEN = "<unk>";

/** Minimum crop width (pixels) fed to the recognition model. */
export const MIN_CROP_WIDTH = 8;

/**
 * Consecutive characters separated by more than this multiple of the median
 * glyph pitch get a space injected between them.
 */
const SPACE_GAP_FACTOR = 2.5;

/**
 * Inserts spaces into wide gaps between decoded characters, in place.
 *
 * CTC recognition models under-emit spaces; a horizontal gap much wider than
 * the typical glyph pitch is whitespace the model read through (columnar
 * receipts, tab-aligned forms). The injected space's position is the gap's
 * midpoint, keeping `chars` and `positions` index-aligned.
 */
export function injectGapSpaces(chars: string[], positions: number[]): void {
  if (chars.length < 4) return;

  const deltas: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    deltas.push((positions[i] ?? 0) - (positions[i - 1] ?? 0));
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return;

  for (let i = chars.length - 1; i >= 1; i--) {
    const prev = positions[i - 1] ?? 0;
    const curr = positions[i] ?? 0;
    // Identical neighbors are excluded: CTC must emit a blank between
    // repeated characters, so their gap is structurally inflated ("44").
    if (
      curr - prev > median * SPACE_GAP_FACTOR &&
      chars[i] !== " " &&
      chars[i - 1] !== " " &&
      chars[i] !== chars[i - 1]
    ) {
      chars.splice(i, 0, " ");
      positions.splice(i, 0, (prev + curr) / 2);
    }
  }
}

/**
 * Performs greedy CTC decoding over raw model logits.
 *
 * Hot loop: argmax and character handling are inlined, and per-character
 * confidence is accumulated as a running sum instead of a backing array.
 *
 * `positions` holds, per emitted character, the fraction (0..1) of the input
 * width where its timestep fired; CTC peaks near the glyph's center, so this
 * locates each character in the crop for position-based text splitting.
 * Wide gaps between characters become spaces (see {@link injectGapSpaces}).
 */
export function ctcGreedyDecode(
  logits: Float32Array,
  sequenceLength: number,
  numClasses: number,
  charDict: string[]
): { text: string; confidence: number; positions: number[] } {
  const dictLen = charDict.length;
  const lastDictIndex = dictLen - 1;

  const emitted: string[] = [];
  let lastCharIndex = -1;
  let confidenceSum = 0;
  let confidenceCount = 0;
  const positions: number[] = [];

  for (let t = 0; t < sequenceLength; t++) {
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

    if (maxIndex === BLANK_INDEX || maxIndex === lastCharIndex) {
      lastCharIndex = maxIndex;
      continue;
    }

    // Out-of-bounds indices are skipped silently; a dictionary/model size
    // mismatch is reported once by decodeResults() rather than per timestep.
    if (maxIndex >= 0 && maxIndex < dictLen) {
      const char = charDict[maxIndex] ?? "";
      if (maxIndex === lastDictIndex) {
        if (char !== UNK_TOKEN) {
          emitted.push(" ");
          confidenceSum += maxProb;
          confidenceCount++;
          positions.push((t + 0.5) / sequenceLength);
        }
      } else {
        emitted.push(char);
        confidenceSum += maxProb;
        confidenceCount++;
        positions.push((t + 0.5) / sequenceLength);
      }
    }

    lastCharIndex = maxIndex;
  }

  injectGapSpaces(emitted, positions);

  const confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
  return { text: emitted.join(""), confidence, positions };
}

/**
 * Decodes an ONNX output tensor into text using the supplied character dictionary.
 *
 * Prepends a blank slot when the dict is one entry shorter than the model's class count
 * (issue #15 compatibility).
 *
 * When `verbose` is set, a dictionary/model size mismatch is reported once (such a
 * mismatch produces garbage output, so it usually signals the wrong dictionary).
 */
export function decodeResults(
  outputTensor: Tensor,
  charactersDictionary: string[],
  numClassesFromShape: number,
  verbose = false
): { text: string; confidence: number; positions: number[] } {
  const outputData = outputTensor.data as Float32Array;
  const outputShape = outputTensor.dims;

  const sequenceLength = outputShape[1];
  const numClasses = outputShape[2] ?? numClassesFromShape;

  if (!charactersDictionary) {
    return { text: "", confidence: 0, positions: [] };
  }

  let dict = charactersDictionary;
  if (charactersDictionary.length === numClasses - 1) {
    dict = ["", ...charactersDictionary];
  } else if (numClasses !== charactersDictionary.length && verbose) {
    console.warn(
      `Warning: Model output classes (${numClasses}) does not match dictionary length (${charactersDictionary.length}).\n Consider using our model & dictionary catalogue at https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models.`
    );
  }

  return ctcGreedyDecode(outputData, sequenceLength, numClasses, dict);
}
