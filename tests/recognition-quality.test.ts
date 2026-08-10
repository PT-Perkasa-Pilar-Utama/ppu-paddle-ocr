// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { beforeAll, describe, expect, test } from "bun:test";
import { createCanvas } from "canvas";

import type { RecognitionContext } from "../src/core/recognition/strategies.js";
import { ctcGreedyDecode } from "../src/core/recognition/ctc.js";
import { rotateTallCropIfNeeded } from "../src/core/recognition/strategies.js";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { levenshteinDistance } from "../src/utils.js";

const groundTruth = (
  await Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`).text()
).trim();

function accuracy(text: string): number {
  const dist = levenshteinDistance(text.trim(), groundTruth);
  return ((groundTruth.length - dist) / groundTruth.length) * 100;
}

describe("batched recognition", () => {
  beforeAll(async () => {
    await PaddleOcrService.downloadModels();
  }, 30000);

  test("batched (default) and sequential (recBatchSize 1) both clear the accuracy floor", async () => {
    const image = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();

    const batched = new PaddleOcrService({
      recognition: { charactersDictionary: [], recBatchSize: 6 },
    });
    await batched.initialize();
    const batchedResult = await batched.recognize(image, { noCache: true });
    await batched.destroy();

    const sequential = new PaddleOcrService({
      recognition: { charactersDictionary: [], recBatchSize: 1 },
    });
    await sequential.initialize();
    const sequentialResult = await sequential.recognize(image, { noCache: true });
    await sequential.destroy();

    // Edge-replicate padding and valid-sequence decode keep batched output
    // at parity; assert the floor on both paths rather than byte equality.
    expect(accuracy(batchedResult.text)).toBeGreaterThan(95);
    expect(accuracy(sequentialResult.text)).toBeGreaterThan(95);
  }, 60000);
});

describe("rotateTallCropIfNeeded", () => {
  const ctxFor = (rotate: boolean) =>
    ({
      options: { charactersDictionary: [], rotateVerticalCrops: rotate },
      platform: { createCanvas: (w: number, h: number) => createCanvas(w, h) },
    }) as unknown as RecognitionContext;

  test("rotates a tall crop 90 degrees counter-clockwise", () => {
    // 10x30 crop with a red marker at the top-left corner. CCW rotation maps
    // (x, y) -> (y, W-1-x), so (0, 0) must land at (0, 9).
    const crop = createCanvas(10, 30);
    const c = crop.getContext("2d");
    c.fillStyle = "#00ff00";
    c.fillRect(0, 0, 10, 30);
    c.fillStyle = "#ff0000";
    c.fillRect(0, 0, 1, 1);

    const rotated = rotateTallCropIfNeeded(crop as never, ctxFor(true));
    expect(rotated.width).toBe(30);
    expect(rotated.height).toBe(10);
    const px = rotated.getContext("2d").getImageData(0, 9, 1, 1).data;
    expect(px[0]).toBeGreaterThan(200); // red channel
    expect(px[1]).toBeLessThan(60); // green channel
  });

  test("leaves wide crops and disabled configs untouched", () => {
    const wide = createCanvas(30, 10);
    expect(rotateTallCropIfNeeded(wide as never, ctxFor(true))).toBe(wide as never);

    const tall = createCanvas(10, 30);
    expect(rotateTallCropIfNeeded(tall as never, ctxFor(false))).toBe(tall as never);
  });
});

describe("spaceRecovery CTC decode", () => {
  // numClasses 4: [blank, "h", "i", " "] - space last, PaddleOCR convention.
  const dict = ["", "h", "i", " "];
  // t0: "h" clear winner; t1: "i" wins but space is a strong runner-up.
  const logits = new Float32Array([
    /* t0 */ 0.05, 0.9, 0.049, 0.0005, /* t1 */ 0.05, 0.05, 0.6, 0.3,
  ]);

  test("recovers the dropped space when enabled, not when disabled", () => {
    const off = ctcGreedyDecode(logits, 2, 4, dict, false);
    const on = ctcGreedyDecode(logits, 2, 4, dict, true);
    expect(off.text).toBe("hi");
    expect(on.text).toBe("h i");
  });
});
