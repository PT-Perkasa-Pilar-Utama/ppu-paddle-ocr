// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

const KEEP_ALL_CONFIDENCE = 0;
const KEEP_ONLY_CERTAIN_CONFIDENCE = 1;
const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();

beforeAll(async () => {
  await PaddleOcrService.downloadModels();
});

describe("per-call recognition options", () => {
  let service: PaddleOcrService;

  afterEach(async () => {
    await service?.destroy();
  });

  test("confidence overrides the service default on Node", async () => {
    service = new PaddleOcrService();
    await service.initialize();

    const unfiltered = await service.recognize(imageBuffer, {
      minimumConfidence: KEEP_ALL_CONFIDENCE,
      noCache: true,
    });
    const strict = await service.recognize(imageBuffer, {
      minimumConfidence: KEEP_ONLY_CERTAIN_CONFIDENCE,
      noCache: true,
    });

    expect(unfiltered.lines.length).toBeGreaterThan(0);
    expect(strict.lines).toHaveLength(0);
    expect(strict.text).toBeEmpty();
  }, 30000);
});
