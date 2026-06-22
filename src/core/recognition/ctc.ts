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
 * Performs greedy CTC decoding over raw model logits.
 *
 * Hot loop: argmax and character handling are inlined, and per-character
 * confidence is accumulated as a running sum instead of a backing array.
 */
export function ctcGreedyDecode(
  logits: Float32Array,
  sequenceLength: number,
  numClasses: number,
  charDict: string[]
): { text: string; confidence: number } {
  const dictLen = charDict.length;
  const lastDictIndex = dictLen - 1;

  let decodedText = "";
  let lastCharIndex = -1;
  let confidenceSum = 0;
  let confidenceCount = 0;

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
          decodedText += " ";
          confidenceSum += maxProb;
          confidenceCount++;
        }
      } else {
        decodedText += char;
        confidenceSum += maxProb;
        confidenceCount++;
      }
    }

    lastCharIndex = maxIndex;
  }

  const confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
  return { text: decodedText, confidence };
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
): { text: string; confidence: number } {
  const outputData = outputTensor.data as Float32Array;
  const outputShape = outputTensor.dims;

  const sequenceLength = outputShape[1];
  const numClasses = outputShape[2] ?? numClassesFromShape;

  if (!charactersDictionary) {
    return { text: "", confidence: 0 };
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
