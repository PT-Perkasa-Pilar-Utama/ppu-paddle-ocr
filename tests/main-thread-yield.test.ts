// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { beforeAll, describe, expect, test } from "bun:test";

import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { levenshteinDistance } from "../src/utils.js";

// A value nothing else in the runtime schedules, so counting timers with
// exactly this delay isolates the yields our code inserts.
const YIELD_MS = 7;

const groundTruth = (
  await Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`).text()
).trim();

function accuracy(text: string): number {
  const dist = levenshteinDistance(text.trim(), groundTruth);
  return ((groundTruth.length - dist) / groundTruth.length) * 100;
}

describe("recognition.mainThreadYieldMs", () => {
  beforeAll(async () => {
    await PaddleOcrService.downloadModels();
  }, 30000);

  test("yields once per recognition inference and leaves results intact", async () => {
    const service = new PaddleOcrService({
      // recBatchSize 1 pins the original one-yield-per-inference contract;
      // with batching (default 6) the yield fires once per batch instead.
      recognition: { charactersDictionary: [], mainThreadYieldMs: YIELD_MS, recBatchSize: 1 },
    });
    await service.initialize();

    const original = globalThis.setTimeout;
    let yieldCount = 0;
    globalThis.setTimeout = ((
      handler: Parameters<typeof setTimeout>[0],
      ms?: number,
      ...rest: unknown[]
    ) => {
      if (ms === YIELD_MS) yieldCount++;
      return original(handler, ms, ...(rest as []));
    }) as typeof setTimeout;

    try {
      const image = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
      const result = await service.recognize(image, { noCache: true });

      // per-line runs one inference per merged line, and every returned line
      // implies at least one inference - so the yield must have fired at
      // least that many times. If the option were not wired through to
      // runInference, yieldCount would be 0.
      expect(result.lines.length).toBeGreaterThan(0);
      expect(yieldCount).toBeGreaterThanOrEqual(result.lines.length);

      // Yielding must not change what gets recognized.
      expect(accuracy(result.text)).toBeGreaterThan(90);
    } finally {
      globalThis.setTimeout = original;
      await service.destroy();
    }
  }, 30000);
});
