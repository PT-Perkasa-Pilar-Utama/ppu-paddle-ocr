// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { describe, expect, test } from "bun:test";
import { Canvas } from "ppu-ocv";
import { CanvasToolkit } from "ppu-ocv/canvas";

import type { CanvasOps, CoreCanvas } from "../src/core/platform.js";
import {
  groupBoxesIntoLines,
  mergeLineCrop,
  splitBatchTextByWidths,
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
