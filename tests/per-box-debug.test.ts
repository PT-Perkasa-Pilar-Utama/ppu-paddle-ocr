// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
const debugFolder = `${import.meta.dir}/../out-test-debug-per-box`;
const SEQUENTIAL_BATCH_SIZE = 1;

beforeAll(async () => {
  await PaddleOcrService.downloadModels();
});

afterAll(() => {
  if (existsSync(debugFolder)) rmSync(debugFolder, { recursive: true, force: true });
});

describe("per-box strategy in debug mode", () => {
  test("saves one crop per box and matches the sequential production output", async () => {
    // Debug mode recognizes boxes one at a time so it can save each crop with
    // its timing. Padding inside a multi-crop batch can shift a CTC decode, so
    // the reference is the production path at batch size 1, the same batch
    // composition the debug path sees.
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const plain = new PaddleOcrService();
      await plain.initialize();
      const reference = await plain.recognize(imageBuffer, {
        noCache: true,
        strategy: "per-box",
        recBatchSize: SEQUENTIAL_BATCH_SIZE,
      });
      await plain.destroy();

      const service = new PaddleOcrService({ debugging: { debug: true, debugFolder } });
      await service.initialize();
      const debugged = await service.recognize(imageBuffer, { noCache: true, strategy: "per-box" });
      await service.destroy();

      expect(debugged.text).toBe(reference.text);

      const crops = readdirSync(join(debugFolder, "crops")).filter((f) =>
        /^crop_\d{3}\.png$/.test(f)
      );
      // One crop per detected box; the confidence filter only trims results.
      expect(crops.length).toBeGreaterThanOrEqual(debugged.lines.flat().length);
      expect(crops.length).toBeGreaterThan(0);
    } finally {
      logSpy.mockRestore();
    }
  }, 60000);
});
