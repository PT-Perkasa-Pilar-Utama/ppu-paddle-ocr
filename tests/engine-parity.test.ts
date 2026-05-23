import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import type { ProcessingEngine } from "../src/interface.js";

const imgFile = Bun.file(`${import.meta.dir}/../assets/receipt.jpg`);
const imageBuffer = await imgFile.arrayBuffer();

// Exercise the library's default models (v5).
beforeAll(async () => {
  await PaddleOcrService.downloadModels();
});

/**
 * Regression test suite for engine parity (opencv vs canvas-native).
 *
 * These tests ensure that both processing engines produce equivalent OCR
 * results on the same input image. Any significant divergence between the
 * two engines indicates a regression.
 *
 * @see https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues/8
 */
describe("Processing engine parity (opencv vs canvas-native)", () => {
  let opencvService: PaddleOcrService;
  let canvasService: PaddleOcrService;

  beforeEach(async () => {
    opencvService = new PaddleOcrService({
      processing: { engine: "opencv" },
    });
    canvasService = new PaddleOcrService({
      processing: { engine: "canvas-native" },
    });

    await opencvService.initialize();
    await canvasService.initialize();
  });

  afterEach(async () => {
    await opencvService.destroy();
    await canvasService.destroy();
  });

  test("both engines should detect text in the image", async () => {
    const opencvResult = await opencvService.recognize(imageBuffer, {
      noCache: true,
    });
    const canvasResult = await canvasService.recognize(imageBuffer, {
      noCache: true,
    });

    expect(opencvResult.text).not.toBeEmpty();
    expect(canvasResult.text).not.toBeEmpty();
    expect(opencvResult.confidence).toBeGreaterThan(0.5);
    expect(canvasResult.confidence).toBeGreaterThan(0.5);
  });

  test("both engines should detect a similar number of text regions", async () => {
    const opencvResult = await opencvService.recognize(imageBuffer, {
      noCache: true,
    });
    const canvasResult = await canvasService.recognize(imageBuffer, {
      noCache: true,
    });

    const opencvCount = opencvResult.lines.flat().length;
    const canvasCount = canvasResult.lines.flat().length;

    // Allow some tolerance — canvas-native may detect slightly different
    // region boundaries due to different contour-finding algorithms,
    // but they should be in the same ballpark.
    const tolerance = Math.max(3, Math.ceil(opencvCount * 0.25));
    expect(Math.abs(opencvCount - canvasCount)).toBeLessThanOrEqual(tolerance);
  });

  test("opencv engine should produce bounding boxes with reasonable widths (no 8px narrowing regression)", async () => {
    const opencvResult = await opencvService.recognize(imageBuffer, {
      noCache: true,
      flatten: true,
    });

    for (const item of opencvResult.results) {
      // All detected boxes should have width > 8px (the 8px regression
      // would cause boxes to be suspiciously narrow)
      expect(item.box.width).toBeGreaterThan(8);
      expect(item.box.height).toBeGreaterThan(0);
      expect(item.box.x).toBeGreaterThanOrEqual(0);
      expect(item.box.y).toBeGreaterThanOrEqual(0);
    }
  });

  test("canvas-native engine should produce bounding boxes with reasonable widths", async () => {
    const canvasResult = await canvasService.recognize(imageBuffer, {
      noCache: true,
      flatten: true,
    });

    for (const item of canvasResult.results) {
      expect(item.box.width).toBeGreaterThan(8);
      expect(item.box.height).toBeGreaterThan(0);
      expect(item.box.x).toBeGreaterThanOrEqual(0);
      expect(item.box.y).toBeGreaterThanOrEqual(0);
    }
  });

  test("bounding box widths should not differ significantly between engines", async () => {
    const opencvResult = await opencvService.recognize(imageBuffer, {
      noCache: true,
      flatten: true,
    });
    const canvasResult = await canvasService.recognize(imageBuffer, {
      noCache: true,
      flatten: true,
    });

    // Compare average box widths across engines.
    // A large difference may indicate a regression in region detection.
    if (opencvResult.results.length > 0 && canvasResult.results.length > 0) {
      const avgOpencvWidth =
        opencvResult.results.reduce((sum, r) => sum + r.box.width, 0) / opencvResult.results.length;
      const avgCanvasWidth =
        canvasResult.results.reduce((sum, r) => sum + r.box.width, 0) / canvasResult.results.length;

      // Allow up to 20% difference in average box widths
      const widthRatio =
        Math.min(avgOpencvWidth, avgCanvasWidth) / Math.max(avgOpencvWidth, avgCanvasWidth);
      expect(widthRatio).toBeGreaterThan(0.8);
    }
  });
});

describe("Processing engine selection", () => {
  test("default engine should be opencv", async () => {
    const service = new PaddleOcrService();
    await service.initialize();

    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.8);

    await service.destroy();
  });

  test("canvas-native engine should work when explicitly selected", async () => {
    const service = new PaddleOcrService({
      processing: { engine: "canvas-native" },
    });
    await service.initialize();

    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.5);

    await service.destroy();
  });

  test("opencv engine should work when explicitly selected", async () => {
    const service = new PaddleOcrService({
      processing: { engine: "opencv" },
    });
    await service.initialize();

    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.8);

    await service.destroy();
  });

  test("both engines should produce deterministic results across runs", async () => {
    for (const engine of ["opencv", "canvas-native"] as ProcessingEngine[]) {
      const service = new PaddleOcrService({
        processing: { engine },
      });
      await service.initialize();

      const result1 = await service.recognize(imageBuffer, { noCache: true });
      const result2 = await service.recognize(imageBuffer, { noCache: true });

      expect(result1.text).toBe(result2.text);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.lines.length).toBe(result2.lines.length);

      await service.destroy();
    }
  });
});
