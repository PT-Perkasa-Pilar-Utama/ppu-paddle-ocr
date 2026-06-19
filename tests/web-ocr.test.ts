// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { getPlatform, setPlatform } from "ppu-ocv";

import type { PaddleOcrService } from "../src/web/paddle-ocr.service.web.js";
import { installWebCanvas, uninstallWebCanvas } from "./web-canvas-polyfill.js";

// The web entry is imported dynamically inside beforeAll — NOT at module load —
// so it doesn't call ppu-ocv's process-global setPlatform(webPlatform) before
// the node test suites run in the same `bun test` process. The active platform
// is saved before and restored after this suite.
let WebPaddleOcrService: typeof PaddleOcrService;
let savedPlatform: ReturnType<typeof getPlatform>;

const imgFile = Bun.file(`${import.meta.dir}/../assets/receipt.jpg`);
const imageBuffer = await imgFile.arrayBuffer();

describe("web OCR service (onnxruntime-web under the polyfilled runtime)", () => {
  let service: PaddleOcrService;

  // Switch to the web platform + browser canvas globals only for this suite,
  // then restore the previous (node) platform so node OCR tests sharing the
  // process aren't left on the web path.
  beforeAll(async () => {
    savedPlatform = getPlatform();
    installWebCanvas();
    ({ PaddleOcrService: WebPaddleOcrService } =
      await import("../src/web/paddle-ocr.service.web.js"));
  }, 120000); // v6 models may be fetched fresh on first web-path init
  afterAll(() => {
    uninstallWebCanvas();
    setPlatform(savedPlatform);
  });

  afterEach(async () => {
    if (service) await service.destroy();
  });

  // Use the canvas-native engine throughout: it avoids the @techstark/opencv-js
  // `cv` singleton, which would otherwise collide with the node OCR tests'
  // OpenCV state when both run in one process.
  test("initializes and recognizes with the canvas-native engine", async () => {
    service = new WebPaddleOcrService({ processing: { engine: "canvas-native" } });
    await service.initialize();
    expect(service.isInitialized()).toBe(true);

    const result = await service.recognize(imageBuffer);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.lines.length).toBeGreaterThan(0);
  }, 180000);

  test("honors recognition strategies and flatten on the web path", async () => {
    service = new WebPaddleOcrService({ processing: { engine: "canvas-native" } });
    await service.initialize();

    for (const strategy of ["per-box", "per-line", "cross-line"] as const) {
      const r = await service.recognize(imageBuffer, { strategy, noCache: true });
      expect(r.text.length).toBeGreaterThan(0);
    }

    const flat = await service.recognize(imageBuffer, { flatten: true, noCache: true });
    expect(flat.results).toBeArray();
    expect(flat.results.length).toBeGreaterThan(0);
  }, 90000);

  test("batchRecognize and streaming work on the web path", async () => {
    service = new WebPaddleOcrService({ processing: { engine: "canvas-native" } });
    await service.initialize();

    const results = await service.batchRecognize([imageBuffer, imageBuffer], { noCache: true });
    expect(results.length).toBe(2);

    const streamed: number[] = [];
    for await (const r of service.batchRecognizeStream([imageBuffer], { noCache: true })) {
      expect(r.status).toBe("fulfilled");
      if (r.status === "fulfilled") streamed.push(r.value.text.length);
    }
    expect(streamed.length).toBe(1);
  }, 90000);

  // The opencv engine sets the web OpenCV as the global `cv`; ppu-ocv's
  // structural Mat check (3.2.0+) keeps node OCR tests working in the same
  // process, and afterAll restores the node platform.
  test("recognizes with the opencv engine", async () => {
    service = new WebPaddleOcrService({ processing: { engine: "opencv" } });
    await service.initialize();
    const result = await service.recognize(imageBuffer);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.8);
  }, 60000);

  test("swaps the detection model and rejects an empty dictionary", async () => {
    service = new WebPaddleOcrService({ processing: { engine: "canvas-native" } });
    await service.initialize();

    const det = await Bun.file(
      `${import.meta.dir}/../models/PP-OCRv5_mobile_det_infer.onnx`
    ).arrayBuffer();
    await service.changeDetectionModel(det); // v5 detection, matches default

    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text.length).toBeGreaterThan(0);

    await expect(service.changeTextDictionary("")).rejects.toBeDefined();
  }, 60000);

  test("recognize before initialize throws", async () => {
    const fresh = new WebPaddleOcrService();
    await expect(fresh.recognize(imageBuffer)).rejects.toBeDefined();
  });
});
