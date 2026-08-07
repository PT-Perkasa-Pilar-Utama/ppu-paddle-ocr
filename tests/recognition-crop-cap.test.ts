// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { beforeAll, describe, expect, test } from "bun:test";
import { loadImage } from "canvas";

import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { levenshteinDistance } from "../src/utils.js";

// Recreates the shape of the real-world case that motivated the crop cap:
// a source image far larger than any normal photo (detection's own "auto"
// cap tops out at 1920px). Upscaling the known-good receipt fixture 8x
// (to ~5760x10240) exercises `buildCropCanvas`'s downsize + box-rescale
// path without needing to commit a multi-megabyte fixture image.
const UPSCALE = 8;

const groundTruth = (
  await Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`).text()
).trim();

function accuracy(text: string): number {
  const dist = levenshteinDistance(text.trim(), groundTruth);
  return ((groundTruth.length - dist) / groundTruth.length) * 100;
}

describe("recognition crop cap on oversized sources", () => {
  let bigImageBuffer: ArrayBuffer;

  beforeAll(async () => {
    await PaddleOcrService.downloadModels();

    const { createCanvas } = await import("canvas");
    const image = await loadImage(`${import.meta.dir}/../assets/receipt.jpg`);
    const bigCanvas = createCanvas(image.width * UPSCALE, image.height * UPSCALE);
    bigCanvas.getContext("2d").drawImage(image, 0, 0, bigCanvas.width, bigCanvas.height);
    bigImageBuffer = bigCanvas.toBuffer("image/png").buffer as ArrayBuffer;
  }, 30000);

  test("still recognizes correctly-cropped text on a far-oversized source", async () => {
    const service = new PaddleOcrService();
    await service.initialize();

    const result = await service.recognize(bigImageBuffer, { noCache: true });

    // If the crop-cap's box rescale were wrong direction/magnitude, crops
    // would come from the wrong region of the oversized canvas and
    // recognized text would be garbage - this is the failure this test
    // exists to catch, not just "it doesn't throw".
    expect(accuracy(result.text)).toBeGreaterThan(90);

    await service.destroy();
  }, 30000);
});
