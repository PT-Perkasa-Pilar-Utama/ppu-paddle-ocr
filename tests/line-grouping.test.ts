// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { describe, expect, test } from "bun:test";
import { Canvas } from "ppu-ocv";
import { CanvasToolkit } from "ppu-ocv/canvas";

import type { CanvasOps, CoreCanvas } from "../src/core/platform.js";
import { injectGapSpaces, refineDecodedChars } from "../src/core/recognition/ctc.js";
import {
  groupBoxesIntoLines,
  mergeLineCrop,
  splitBatchTextByWidths,
  splitTextByPositions,
} from "../src/core/recognition/line-grouping.js";

const createCanvas = (width: number, height: number) =>
  new Canvas(width, height) as unknown as CoreCanvas;

const canvasOps = {
  getToolkit: () => CanvasToolkit.getInstance(),
} as unknown as CanvasOps;

describe("mergeLineCrop", () => {
  test("clamps degenerate thin boxes so merged width stays bounded (issue #72)", () => {
    const source = createCanvas(3000, 100);
    // A 40px-tall text box grouped with a wide 1px underline: unclamped, the
    // underline would be stretched 40x (2000px -> 80000px) and overflow the
    // surface limit.
    const lineBoxes = [
      { box: { x: 0, y: 10, width: 100, height: 40 }, index: 0 },
      { box: { x: 120, y: 30, width: 2000, height: 1 }, index: 1 },
    ];

    const lines = groupBoxesIntoLines(lineBoxes);
    expect(lines).toHaveLength(1);

    const { mergedCanvas, mergedBox } = mergeLineCrop(source, lineBoxes, createCanvas, canvasOps);
    expect(mergedCanvas.width).toBeLessThanOrEqual(16384);
    expect(mergedCanvas.height).toBe(40);
    expect(mergedBox).toEqual({ x: 0, y: 10, width: 2120, height: 40 });
  });

  test("stitches normal same-height boxes with a separator gap and reports cropWidths", () => {
    const source = createCanvas(1000, 100);
    const lineBoxes = [
      { box: { x: 0, y: 0, width: 200, height: 40 }, index: 0 },
      { box: { x: 250, y: 0, width: 300, height: 40 }, index: 1 },
    ];

    const { mergedCanvas, cropWidths } = mergeLineCrop(source, lineBoxes, createCanvas, canvasOps);
    const gap = Math.round(40 * 0.4);
    expect(mergedCanvas.width).toBe(500 + gap);
    expect(mergedCanvas.height).toBe(40);
    expect(cropWidths).toEqual([200 + gap, 300]);
    expect(cropWidths.reduce((a, b) => a + b, 0)).toBe(mergedCanvas.width);
  });
});

describe("splitBatchTextByWidths", () => {
  test("snaps the proportional cut to a nearby space instead of slicing a word", () => {
    // Ideal cut for [100, 100] lands mid-"World"; the space at index 5 is
    // within snap range, so the split lands there and drops the space.
    expect(splitBatchTextByWidths("Hello World", [100, 100])).toEqual(["Hello", "World"]);
    expect(splitBatchTextByWidths("Photos Albums", [90, 110])).toEqual(["Photos", "Albums"]);
  });

  test("falls back to a hard proportional cut when no space is near", () => {
    expect(splitBatchTextByWidths("abcdefghij", [50, 50])).toEqual(["abcde", "fghij"]);
  });

  test("assigns everything to a single crop", () => {
    expect(splitBatchTextByWidths("all of it", [123])).toEqual(["all of it"]);
  });
});

describe("splitTextByPositions", () => {
  test("assigns characters by their decoded position, not by proportion", () => {
    // Four chars, three crowding the left segment: a proportional split
    // would hand two chars to each segment; positions say otherwise.
    expect(splitTextByPositions("AAAB", [0.1, 0.2, 0.3, 0.9], [50, 50])).toEqual(["AAA", "B"]);
    // The "Total Item144,900" failure shape: digits belonging to the right
    // box even though the character count is left-heavy.
    expect(
      splitTextByPositions(
        "TotalItem44,900",
        [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.75, 0.8, 0.85, 0.9, 0.93, 0.96],
        [350, 150]
      )
    ).toEqual(["TotalItem", "44,900"]);
  });

  test("falls back to the width-proportional split when positions misalign", () => {
    expect(splitTextByPositions("abcdefghij", [0.5], [50, 50])).toEqual(["abcde", "fghij"]);
  });
});

describe("injectGapSpaces", () => {
  test("injects a space into a gap far wider than the glyph pitch", () => {
    const chars = ["I", "t", "e", "m", "1"];
    const positions = [0.1, 0.15, 0.2, 0.25, 0.6];
    injectGapSpaces(chars, positions);
    expect(chars.join("")).toBe("Item 1");
    expect(positions).toHaveLength(6);
    expect(positions[4]).toBeCloseTo((0.25 + 0.6) / 2);
  });

  test("leaves uniform-pitch text and existing spaces alone", () => {
    const chars = ["a", "b", " ", "c", "d"];
    const positions = [0.1, 0.2, 0.3, 0.4, 0.5];
    injectGapSpaces(chars, positions);
    expect(chars.join("")).toBe("ab cd");
  });

  test("does not double a space the model already emitted at a wide gap", () => {
    const chars = ["a", "b", " ", "c", "d"];
    const positions = [0.1, 0.15, 0.4, 0.7, 0.75];
    injectGapSpaces(chars, positions);
    expect(chars.join("")).toBe("ab cd");
  });

  test("skips very short texts", () => {
    const chars = ["a", "b"];
    const positions = [0.1, 0.9];
    injectGapSpaces(chars, positions);
    expect(chars.join("")).toBe("ab");
  });
});

describe("injectGapSpaces repeated characters", () => {
  test("never splits identical neighbors (CTC blank inflates their gap)", () => {
    const chars = ["1", "5", ":", "4", "4"];
    const positions = [0.1, 0.15, 0.2, 0.25, 0.5];
    injectGapSpaces(chars, positions);
    expect(chars.join("")).toBe("15:44");
  });
});

describe("refineDecodedChars", () => {
  test("maps fullwidth punctuation to ASCII on Latin-only text", () => {
    const chars = ["N", "P", "W", "P", "\uFF1A", "0", "1"];
    const positions = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    refineDecodedChars(chars, positions);
    expect(chars.join("")).toBe("NPWP:01");
    expect(positions.length).toBe(chars.length);
  });

  test("leaves fullwidth forms untouched when the text contains CJK", () => {
    const chars = ["\u4E2D", "\uFF1A", "1"];
    const positions = [0.2, 0.5, 0.8];
    refineDecodedChars(chars, positions);
    expect(chars.join("")).toBe("\u4E2D\uFF1A1");
  });

  test("collapses doubled spaces and keeps positions aligned", () => {
    const chars = ["A", " ", " ", "B"];
    const positions = [0.1, 0.4, 0.5, 0.9];
    refineDecodedChars(chars, positions);
    expect(chars.join("")).toBe("A B");
    expect(positions).toEqual([0.1, 0.4, 0.9]);
  });
});
