// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { PaddleOcrService as WebPaddleOcrService } from "../src/web/paddle-ocr.service.web.js";
import { installWebCanvas, uninstallWebCanvas } from "./web-canvas-polyfill.js";

const imgFile = Bun.file(`${import.meta.dir}/../assets/receipt.jpg`);
const imageBuffer = await imgFile.arrayBuffer();

describe("web OCR service (onnxruntime-web under the polyfilled runtime)", () => {
  let service: WebPaddleOcrService;

  // Canvas globals exist only for the duration of this suite so the node OCR
  // tests (run in the same process) never take ppu-ocv's browser path.
  beforeAll(() => installWebCanvas());
  afterAll(() => uninstallWebCanvas());

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
  }, 60000);

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

  // The web suite runs in its own process, so the opencv engine here does not
  // collide with the node OCR tests' OpenCV state.
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
