import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Canvas } from "ppu-ocv";
import { ImageProcessor } from "ppu-ocv";

import { globalImageCache, ImageCache } from "../src/core/image-cache.js";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

type Detection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Recognition = {
  text: string;
  confidence: number;
  box: Detection;
};

const baseRecognition: Recognition[] = [
  {
    text: "ok",
    confidence: 0.99,
    box: {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    },
  },
];

function createServiceWithMocks() {
  const service = new PaddleOcrService();
  const calls = {
    detector: 0,
    recognitor: 0,
  };

  Object.assign(service, {
    detectionSession: { release: async () => {} },
    recognitionSession: { release: async () => {} },
    detector: {
      run: async () => {
        calls.detector += 1;
        return [{ x: 0, y: 0, width: 10, height: 10 }] as Detection[];
      },
    },
    recognitor: {
      run: async () => {
        calls.recognitor += 1;
        return baseRecognition;
      },
    },
  });

  return { service, calls };
}

describe("PaddleOcrService canvas compatibility", () => {
  // Save the real initRuntime so afterAll can put it back. The previous
  // restore called defineProperty without a `value`, which (per spec) keeps
  // the current value - i.e. the no-op stub leaked to every test file that
  // ran after this one, OpenCV never initialized, and all opencv-engine OCR
  // silently returned empty results (the 25-fail CI runs on PR 60).
  const realInitRuntime = ImageProcessor.initRuntime;

  beforeAll(() => {
    Object.defineProperty(ImageProcessor, "initRuntime", {
      value: async () => {},
      configurable: true,
      writable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(ImageProcessor, "initRuntime", {
      value: realInitRuntime,
      configurable: true,
      writable: true,
    });
  });

  beforeEach(() => {
    globalImageCache.clear();
  });

  test("should accept canvas package canvas object", async () => {
    const canvasPkg = await import("canvas").catch(() => null);

    if (!canvasPkg) {
      console.warn("Skipping: canvas package is not available");
      return;
    }

    const { service, calls } = createServiceWithMocks();
    const canvas = canvasPkg.createCanvas(8, 8);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 8, 8);

    const result = await service.recognize(canvas as unknown as Canvas, { noCache: true });

    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0);
    expect(calls.detector).toBe(1);
    expect(calls.recognitor).toBe(1);
    await service.destroy();
  });

  test("should accept @napi-rs/canvas canvas object", async () => {
    const napiCanvasPkg = await import("@napi-rs/canvas").catch(() => null);

    if (!napiCanvasPkg) {
      console.warn("Skipping: @napi-rs/canvas package is not available");
      return;
    }

    const { service, calls } = createServiceWithMocks();
    const canvas = napiCanvasPkg.createCanvas(8, 8);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 8, 8);

    const result = await service.recognize(canvas as unknown as Canvas, { noCache: true });

    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0);
    expect(calls.detector).toBe(1);
    expect(calls.recognitor).toBe(1);
    await service.destroy();
  });

  test("should cache consistently for toBuffer() with non-zero byteOffset", async () => {
    const { service, calls } = createServiceWithMocks();

    const canvasLikeA = {
      width: 1,
      height: 1,
      toBuffer: () => {
        const parent = Buffer.from([11, 22, 1, 2, 3, 4, 99]);
        return parent.subarray(2, 6);
      },
    };

    const canvasLikeB = {
      width: 1,
      height: 1,
      toBuffer: () => {
        const parent = Buffer.from([55, 1, 2, 3, 4, 66, 77]);
        return parent.subarray(1, 5);
      },
    };

    const first = await service.recognize(canvasLikeA as unknown as Canvas);
    const second = await service.recognize(canvasLikeB as unknown as Canvas);

    expect(first.text).not.toBeEmpty();
    expect(second.text).toBe(first.text);
    expect(second.confidence).toBe(first.confidence);
    expect(calls.detector).toBe(1);
    expect(calls.recognitor).toBe(1);
    await service.destroy();
  });

  test("should bypass cache when noCache is true", async () => {
    const { service, calls } = createServiceWithMocks();

    const canvasLike = {
      width: 1,
      height: 1,
      toBuffer: () => Buffer.from([1, 2, 3, 4]),
    };

    await service.recognize(canvasLike as unknown as Canvas, { noCache: true });
    await service.recognize(canvasLike as unknown as Canvas, { noCache: true });

    expect(calls.detector).toBe(2);
    expect(calls.recognitor).toBe(2);
    await service.destroy();
  });

  test("should bypass cache when custom dictionary is provided", async () => {
    const { service, calls } = createServiceWithMocks();
    const dictionary = Buffer.from("a\nb\nc").buffer;

    const canvasLike = {
      width: 1,
      height: 1,
      toBuffer: () => Buffer.from([9, 8, 7, 6]),
    };

    await service.recognize(canvasLike as unknown as Canvas, { dictionary });
    await service.recognize(canvasLike as unknown as Canvas, { dictionary });

    expect(calls.detector).toBe(2);
    expect(calls.recognitor).toBe(2);
    await service.destroy();
  });

  test("should use getImageData fallback and cache by sliced pixel buffer", async () => {
    const { service, calls } = createServiceWithMocks();

    const makeCanvasLike = (prefix: number) => ({
      width: 1,
      height: 1,
      getContext: () => ({
        getImageData: () => {
          const parent = new Uint8ClampedArray([prefix, 10, 20, 30, 40, 200]);
          const data = parent.subarray(1, 5);
          return { data };
        },
      }),
    });

    const first = await service.recognize(makeCanvasLike(111) as unknown as Canvas);
    const second = await service.recognize(makeCanvasLike(222) as unknown as Canvas);

    expect(first.text).not.toBeEmpty();
    expect(second.text).toBe(first.text);
    expect(calls.detector).toBe(1);
    expect(calls.recognitor).toBe(1);
    await service.destroy();
  });

  test("should generate distinct cache keys for different buffers sharing identical headers", () => {
    const bufA = new Uint8Array(8192);
    const bufB = new Uint8Array(8192);
    bufA.fill(1, 0, 1024);
    bufB.fill(1, 0, 1024);
    bufA[5000] = 42;
    bufB[5000] = 99;

    const keyA = ImageCache.generateKey(bufA.buffer);
    const keyB = ImageCache.generateKey(bufB.buffer);
    expect(keyA).not.toBe(keyB);
  });
});
