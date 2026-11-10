// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getPlatform, setPlatform } from "ppu-ocv";

import { DEFAULT_MODEL, UNWARPING_MODEL_URL } from "../src/model-catalogue.js";
import { cachePathFor } from "../src/processor/model-cache.js";
import { PaddleOcrService as NodePaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import type { PaddleOcrService } from "../src/web/paddle-ocr.service.web.js";
import type { ReceiptFixture } from "./unwarping-fixture.js";
import { loadReceiptFixture } from "./unwarping-fixture.js";
import { installWebCanvas, uninstallWebCanvas } from "./web-canvas-polyfill.js";

/**
 * The unwarping stage on the web runtime: onnxruntime-web (WASM) runs the grid
 * model and the browser canvas path feeds and draws the pixels. The Node suite
 * covers the logic; this one proves the same code holds on the web build.
 *
 * Setup follows web-ocr.test.ts: the web entry is imported inside beforeAll and
 * the node platform is restored afterwards, because both share one process.
 */
describe("unwarping on the web runtime", () => {
  let service: PaddleOcrService;
  let photo: ReceiptFixture;
  let savedPlatform: ReturnType<typeof getPlatform>;

  beforeAll(async () => {
    await NodePaddleOcrService.downloadModels({ unwarping: true });
    const cached = (url: string) => Bun.file(cachePathFor(url)).arrayBuffer();
    const [detection, recognition, charactersDictionary, unwarping] = await Promise.all([
      cached(DEFAULT_MODEL.detection),
      cached(DEFAULT_MODEL.recognition),
      cached(DEFAULT_MODEL.charactersDictionary),
      cached(UNWARPING_MODEL_URL),
    ]);
    photo = await loadReceiptFixture();

    savedPlatform = getPlatform();
    installWebCanvas();
    const webModule = await import("../src/web/index.js");
    service = new webModule.PaddleOcrService({
      model: { detection, recognition, charactersDictionary, unwarping },
      unwarping: { enabled: true },
      session: { executionProviders: ["wasm"] },
    });
    await service.initialize();
  }, 120_000);

  afterAll(async () => {
    if (service) await service.destroy();
    if (!savedPlatform) return;
    uninstallWebCanvas();
    setPlatform(savedPlatform);
  });

  test("flattens a curled receipt and reads it", async () => {
    const stage = await service.unwarp(photo.curled);
    const result = await service.recognize(photo.curled, { noCache: true });

    expect(stage.status).toBe("unwarped");
    expect(photo.accuracy(result.text)).toBeGreaterThan(85);
  }, 120_000);
});
