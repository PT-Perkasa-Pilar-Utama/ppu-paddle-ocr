// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { describe, expect, test } from "bun:test";

import { alignDictionaryToClasses } from "../src/core/recognition/ctc.js";

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

const parse = (s: string) => s.split(/\r?\n/);
// A model with a blank class, its glyphs, and the space class the dictionaries
// leave unnamed: 4 real entries -> 5 classes.
const NUM_CLASSES = 5;

describe("alignDictionaryToClasses", () => {
  test("every layout of one dictionary aligns to identical classes", () => {
    const aligned = Object.values(SHAPES).map((s) =>
      alignDictionaryToClasses(parse(s), NUM_CLASSES)
    );
    for (const a of aligned) {
      expect(a).toEqual(["", "A", "B", "C", ""]);
    }
  });

  test("blank token is at class 0 for every layout", () => {
    for (const [name, s] of Object.entries(SHAPES)) {
      expect(alignDictionaryToClasses(parse(s), NUM_CLASSES)[0], name).toBe("");
    }
  });

  test("a dictionary matching the model is returned unchanged", () => {
    // No trailing newline and no omitted space class: already 5 entries, so
    // this is the identity case and must not be padded or shifted.
    const exact = ["", "A", "B", "C", " "];
    expect(alignDictionaryToClasses(exact, NUM_CLASSES)).toEqual(exact);
  });

  test("issue #15: a dictionary one entry short still gains its blank", () => {
    // Four real entries and four classes: the model has no separate space
    // class, so only the blank is prepended.
    expect(alignDictionaryToClasses(["blank", "A", "B", "C"], 4)).toEqual([
      "",
      "blank",
      "A",
      "B",
      "C",
    ]);
  });

  test("the unnamed-space allowance stops at two classes", () => {
    // One short: the unnamed space class. Padded.
    expect(alignDictionaryToClasses(["", "A", "B", "C"], NUM_CLASSES)).toEqual([
      "",
      "A",
      "B",
      "C",
      "",
    ]);
    // Two short: still plausible as blank plus space. Padded.
    expect(alignDictionaryToClasses(["", "A", "B"], NUM_CLASSES)).toEqual(["", "A", "B", "", ""]);
    // Three short is not: padding it would hide a wrong-dictionary mistake,
    // which the caller reports separately.
    const short = ["", "A"];
    expect(alignDictionaryToClasses(short, NUM_CLASSES)).toEqual(short);
  });

  test("a not-yet-loaded dictionary yields just the blank token", () => {
    expect(alignDictionaryToClasses([], NUM_CLASSES)).toEqual([""]);
  });
});
