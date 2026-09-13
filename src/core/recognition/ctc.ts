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
/** Text decoded from a recognition tensor, with its per-character offsets. */
export type DecodedText = { text: string; confidence: number; positions: number[] };

export function ctcGreedyDecode(
  logits: Float32Array,
  sequenceLength: number,
  numClasses: number,
  charDict: string[],
  spaceRecovery = false
): DecodedText {
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
 * Strips the blank entries a dictionary file's own newlines leave at its edges.
 *
 * Only the end is trimmed: a leading blank line is the CTC blank token in the
 * PaddleOCR dictionary convention, so it is a character slot rather than an
 * artifact. The trailing `""` is the opposite - it exists because the file ends
 * in a newline, and it is not a slot the model has a class for.
 */
function dropTrailingBlanks(entries: string[]): string[] {
  let end = entries.length;
  while (end > 0 && entries[end - 1] === "") end--;
  return entries.slice(0, end);
}

/**
 * Aligns a parsed dictionary with the model's class count.
 *
 * `parseDictionary` splits on newlines, so the file's shape leaks into the
 * array, and sizing the blank slot off the raw entry count therefore depends on
 * whether the file ends in a newline. The same dictionary with and without one
 * is off by one class in opposite directions, and both decode to garbage:
 * measured on the default v6-tiny pair over `assets/receipt.jpg`, an identical
 * file reads 92.9% character accuracy with its trailing newline and 12.9%
 * without, with no error raised either way. Case 4 of that run shifts every
 * glyph by one class (`ALFAMART` -> `BMGBNBSU`).
 *
 * Normalising the newline artifacts first makes the alignment a function of the
 * glyph count alone, so every shape of the same dictionary decodes identically.
 * For a dictionary the model already matches, this returns the input unchanged.
 *
 * @param charactersDictionary - Entries as {@link parseDictionary} produced them.
 * @param numClasses - Class count from the model's output shape.
 */
function computeAlignment(charactersDictionary: string[], numClasses: number): string[] {
  const entries = dropTrailingBlanks(charactersDictionary);
  // The blank token always occupies class 0. A file that opens with a blank
  // line states it explicitly; one that opens on a glyph states it implicitly.
  const glyphs = entries[0] === "" ? entries.slice(1) : entries;
  const aligned = ["", ...glyphs];

  // A CTC dictionary normally stops at its last glyph, leaving the space class
  // unnamed - and, in a file with a trailing newline, letting the `""` that
  // newline produces land on it by accident. Name the remaining classes
  // explicitly, but only the one or two a dictionary plausibly omits: a large
  // shortfall means the wrong dictionary was passed, which the caller reports.
  if (aligned.length < numClasses && numClasses - aligned.length <= 2) {
    while (aligned.length < numClasses) aligned.push("");
  }

  return aligned;
}

/**
 * Cached entry point for {@link computeAlignment}.
 *
 * The decode path calls this once per crop, so recomputing the alignment for
 * every crop - and copying an 18k-entry dictionary each time - cost a measured
 * ~23 ms per image on the 40-stem receipt sample, which the benchmark caught as
 * a systematic shift rather than as noise. A service's dictionary array is
 * stable for the life of the service, so a WeakMap keyed on it makes every call
 * after the first a lookup. Keying on the array also keeps the aligned result
 * from outliving the dictionary that produced it.
 */
const alignmentCache = new WeakMap<string[], Map<number, string[]>>();

export function alignDictionaryToClasses(
  charactersDictionary: string[],
  numClasses: number
): string[] {
  let byClasses = alignmentCache.get(charactersDictionary);
  if (!byClasses) {
    byClasses = new Map();
    alignmentCache.set(charactersDictionary, byClasses);
  }

  const cached = byClasses.get(numClasses);
  if (cached) return cached;

  const aligned = computeAlignment(charactersDictionary, numClasses);
  byClasses.set(numClasses, aligned);
  return aligned;
}

/**
 * Decodes an ONNX output tensor into text using the supplied character dictionary.
 *
 * The dictionary is aligned to the model's class count by
 * {@link alignDictionaryToClasses}, which makes the blank slot a function of the
 * glyph count rather than of the dictionary file's leading and trailing newlines.
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
): DecodedText {
  // SAFETY: the recognition head is declared float32, so ORT's output buffer is
  // a Float32Array; a model at another precision fails session creation first.
  const outputData = outputTensor.data as Float32Array;
  const outputShape = outputTensor.dims;

  const sequenceLength = outputShape[1];
  const numClasses = outputShape[2] ?? numClassesFromShape;

  if (!charactersDictionary) {
    return { text: "", confidence: 0, positions: [] };
  }

  const dict = alignDictionaryToClasses(charactersDictionary, numClasses);

  if (dict.length !== numClasses && verbose) {
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
): DecodedText {
  const dict = alignDictionaryToClasses(charactersDictionary, numClasses);
  return ctcGreedyDecode(rowData, sequenceLength, numClasses, dict, spaceRecovery);
}
