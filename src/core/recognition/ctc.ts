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
 * Space-injection thresholds are dynamic per crop, expressed in the crop's
 * own CTC quantization unit: positions land on a timestep grid, so gaps come
 * in integer multiples of one quantum (estimated as the smallest positive
 * gap). A gap is a space when it exceeds the median gap by K quanta. This
 * adapts to each model automatically - a coarse-grid model (tiny) reads a
 * real space as a 2-quantum excess, while on a fine-grid model (small) a
 * 2-quantum excess is normal glyph variation and its real spaces are
 * already emitted by the model; any fixed multiple of the median tuned on
 * one grid injects false spaces on the other. Same-class pairs
 * (letter-letter, digit-digit) demand a larger excess than cross-class
 * transitions: a false space splits "Email Address" or "12:05", while a
 * letter/digit/punctuation boundary ("Page 1of 3", "Tgl.17") is a real
 * space more often.
 */
const GAP_QUANTA_CROSS_CLASS = 1.5;
const GAP_QUANTA_SAME_CLASS = 2.5;

function charClass(char: string): number {
  if (/\p{L}/u.test(char)) return 0;
  if (/\p{N}/u.test(char)) return 1;
  return 2;
}

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

  const quantum = sorted.find((d) => d > 0) ?? 0;
  if (quantum <= 0) return;

  for (let i = chars.length - 1; i >= 1; i--) {
    const prev = positions[i - 1] ?? 0;
    const curr = positions[i] ?? 0;
    const k =
      charClass(chars[i] ?? "") === charClass(chars[i - 1] ?? "")
        ? GAP_QUANTA_SAME_CLASS
        : GAP_QUANTA_CROSS_CLASS;
    // Identical neighbors are excluded: CTC must emit a blank between
    // repeated characters, so their gap is structurally inflated ("44").
    if (
      curr - prev > median + k * quantum &&
      chars[i] !== " " &&
      chars[i - 1] !== " " &&
      chars[i] !== chars[i - 1]
    ) {
      chars.splice(i, 0, " ");
      positions.splice(i, 0, (prev + curr) / 2);
    }
  }
}

/** Offset between fullwidth forms (U+FF01-FF5E) and their ASCII equivalents. */
const FULLWIDTH_OFFSET = 0xfee0;

/** Matches CJK ideographs, kana, and hangul - text where fullwidth forms are correct. */
const CJK_PATTERN = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

/**
 * Cleans up decoded characters in place, keeping `positions` index-aligned:
 *
 * - Collapses runs of spaces to one (the model can emit a space at a wide
 *   gap that {@link injectGapSpaces} also widened, or fire two space
 *   timesteps across a column gap).
 * - Maps fullwidth forms (U+FF01-FF5E, ideographic space) to ASCII when the
 *   text contains no CJK: the multilingual recognizer picks the fullwidth
 *   colon (U+FF1A) or parenthesis (U+FF08) on Latin-only receipts where the
 *   halfwidth form is always the correct reading. Text with any CJK is left
 *   untouched - fullwidth is proper typography there.
 */
export function refineDecodedChars(chars: string[], positions: number[]): void {
  for (let i = chars.length - 1; i >= 1; i--) {
    if (chars[i] === " " && chars[i - 1] === " ") {
      chars.splice(i, 1);
      positions.splice(i, 1);
    }
  }

  if (CJK_PATTERN.test(chars.join(""))) return;
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i]?.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      chars[i] = String.fromCodePoint(code - FULLWIDTH_OFFSET);
    } else if (code === 0x3000) {
      chars[i] = " ";
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
  charDict: string[],
  spaceRecovery = false
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
    // In-bounds by construction (t < sequenceLength, c < numClasses), so the
    // typed-array reads below can never be undefined; keeping the argmax free
    // of per-element nullish checks keeps this hot loop monomorphic.
    let maxProb = logits[base];
    let maxIndex = 0;
    for (let c = 1; c < numClasses; c++) {
      const prob = logits[base + c];
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
      // Recognition models drop inter-word spaces: at a word boundary the
      // space class often scores just under the next letter. When enabled,
      // a strong space runner-up emits the space the argmax swallowed.
      // ponytail: fixed 0.001 threshold (eSearch-OCR's field value) - make it
      // an option if a corpus needs tuning.
      if (
        spaceRecovery &&
        maxIndex !== lastDictIndex &&
        (logits[base + lastDictIndex] ?? 0) > 0.001 &&
        emitted[emitted.length - 1] !== " "
      ) {
        emitted.push(" ");
        positions.push((t + 0.5) / sequenceLength);
      }
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
  refineDecodedChars(emitted, positions);

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
  verbose = false,
  spaceRecovery = false
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

  return ctcGreedyDecode(outputData, sequenceLength, numClasses, dict, spaceRecovery);
}

/**
 * Decodes one row of a batched recognition output (`[N, seq, classes]`),
 * applying the same dictionary padding rules as {@link decodeResults}.
 */
export function decodeLogitsRow(
  rowData: Float32Array,
  sequenceLength: number,
  numClasses: number,
  charactersDictionary: string[],
  spaceRecovery = false
): { text: string; confidence: number; positions: number[] } {
  let dict = charactersDictionary;
  if (charactersDictionary.length === numClasses - 1) {
    dict = ["", ...charactersDictionary];
  }
  return ctcGreedyDecode(rowData, sequenceLength, numClasses, dict, spaceRecovery);
}
