// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { describe, expect, test } from "bun:test";
import { Canvas } from "ppu-ocv";
import { CanvasToolkit } from "ppu-ocv/canvas";

import type { CanvasOps, CoreCanvas } from "../src/core/platform.js";
import { groupBoxesIntoLines, mergeLineCrop } from "../src/core/recognition/line-grouping.js";

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

  test("keeps normal same-height boxes at their summed scaled width", () => {
    const source = createCanvas(1000, 100);
    const lineBoxes = [
      { box: { x: 0, y: 0, width: 200, height: 40 }, index: 0 },
      { box: { x: 250, y: 0, width: 300, height: 40 }, index: 1 },
    ];

    const { mergedCanvas } = mergeLineCrop(source, lineBoxes, createCanvas, canvasOps);
    expect(mergedCanvas.width).toBe(500);
    expect(mergedCanvas.height).toBe(40);
  });
});
