// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { describe, expect, test } from "bun:test";

import { alignDictionaryToClasses } from "../src/core/recognition/ctc.js";
import { parseDictionary } from "../src/utils.js";

/**
 * The four ways the same dictionary file can be laid out. Only the first is
 * what the shipped presets serve, but `parseDictionary` passes the file's
 * leading and trailing newlines straight into the array, so all four reach the
 * decode path and must align to the same classes.
 */
const SHAPES = {
  "leading blank + trailing newline (as served)": "\nA\nB\nC\n",
  "leading blank, no trailing newline": "\nA\nB\nC",
  "no leading blank, trailing newline": "A\nB\nC\n",
  "no leading blank, no trailing newline": "A\nB\nC",
} as const;

// A model with a blank class, its glyphs, and the space class the dictionaries
// leave unnamed: 4 real entries -> 5 classes.
const NUM_CLASSES = 5;
const EXPECTED = ["", "A", "B", "C", ""];

describe("alignDictionaryToClasses", () => {
  test("every layout of one dictionary aligns to identical classes", () => {
    for (const [name, source] of Object.entries(SHAPES)) {
      // Class 0 is the blank, so this covers the blank position too.
      expect(alignDictionaryToClasses(parseDictionary(source), NUM_CLASSES), name).toEqual(
        EXPECTED
      );
    }
  });

  test("a dictionary matching the model is returned unchanged", () => {
    // 5 entries for 5 classes: already complete, so it is neither padded nor
    // shifted.
    const exact = ["", "A", "B", "C", " "];
    expect(alignDictionaryToClasses(exact, NUM_CLASSES)).toEqual(exact);
  });

  test("issue #15: a dictionary naming its own blank is left alone", () => {
    // Four entries for four classes. PaddleOCR's CTCLabelDecode builds its
    // character list with a literal `blank` token at index 0, so a dictionary
    // dumped from it is already complete. Prepending another blank would shift
    // every class by one.
    const exact = ["blank", "A", "B", "C"];
    expect(alignDictionaryToClasses(exact, 4)).toEqual(exact);
  });

  test("a complete dictionary is left alone even when the file ends in a newline", () => {
    // The raw length is compared before the trailing newline is trimmed.
    // Comparing after trimming would rebuild this one and move `blank` off
    // class 0, where the decoded text loses its first character.
    const parsed = parseDictionary("blank\nA\nB\n");
    expect(alignDictionaryToClasses(parsed, 4)).toEqual(["blank", "A", "B", ""]);
  });

  test("a dictionary matching the class count is authoritative, whatever entry 0 is", () => {
    // Shaped like the shipped ppocrv5_dict.txt: 18385 entries for 18385
    // classes, opening on U+3000, with a real `""` at index 1 and the space at
    // the end. Nothing about it needs a prepended blank, and one would break
    // all 18385 classes at once.
    // Written as a code point because the literal character is invisible in a
    // diff: U+3000 is the IDEOGRAPHIC SPACE the file actually opens on.
    const ideographicSpace = String.fromCharCode(0x3000);
    const v5 = [ideographicSpace, "", "A", "B", " "];
    expect(alignDictionaryToClasses(v5, v5.length)).toEqual(v5);
  });

  test("only the space class is padded, never a second blank", () => {
    // One short: the unnamed space class. Padded.
    expect(alignDictionaryToClasses(["", "A", "B", "C"], NUM_CLASSES)).toEqual(EXPECTED);
    // Two short is not that shape. Padding a second blank would land it on a
    // glyph class, where the decoder emits an empty character and still records
    // a position and a confidence sample for it.
    const short = ["", "A", "B"];
    expect(alignDictionaryToClasses(short, NUM_CLASSES)).toEqual(short);
  });

  test("a not-yet-loaded dictionary yields just the blank token", () => {
    expect(alignDictionaryToClasses([], NUM_CLASSES)).toEqual([""]);
  });
});
