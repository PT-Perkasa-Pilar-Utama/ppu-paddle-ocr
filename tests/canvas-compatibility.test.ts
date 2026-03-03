import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ImageProcessor } from "ppu-ocv";

import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { globalImageCache } from "../src/processor/image-cache.js";

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

  (service as any).detectionSession = {
    release: async () => {},
  };
  (service as any).recognitionSession = {
    release: async () => {},
  };

  (service as any).detector = {
    run: async () => {
      calls.detector += 1;
      return [
        {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ] as Detection[];
    },
  };

  (service as any).recognitor = {
    run: async () => {
      calls.recognitor += 1;
      return baseRecognition;
    },
  };

  return { service, calls };
}

const originalInitRuntime = ImageProcessor.initRuntime;

describe("PaddleOcrService canvas compatibility", () => {
  beforeAll(() => {
    Object.defineProperty(ImageProcessor, "initRuntime", {
      value: async () => {},
      configurable: true,
      writable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(ImageProcessor, "initRuntime", {
      value: originalInitRuntime,
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

    const result = await service.recognize(canvas as any, { noCache: true });

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

    const result = await service.recognize(canvas as any, { noCache: true });

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

    const first = await service.recognize(canvasLikeA as any);
    const second = await service.recognize(canvasLikeB as any);

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

    await service.recognize(canvasLike as any, { noCache: true });
    await service.recognize(canvasLike as any, { noCache: true });

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

    await service.recognize(canvasLike as any, { dictionary });
    await service.recognize(canvasLike as any, { dictionary });

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

    const first = await service.recognize(makeCanvasLike(111) as any);
    const second = await service.recognize(makeCanvasLike(222) as any);

    expect(first.text).not.toBeEmpty();
    expect(second.text).toBe(first.text);
    expect(calls.detector).toBe(1);
    expect(calls.recognitor).toBe(1);
    await service.destroy();
  });

  test("should throw if service is not initialized", async () => {
    const service = new PaddleOcrService();

    await expect(
      service.recognize(new ArrayBuffer(4), { noCache: true })
    ).rejects.toThrow("PaddleOcrService is not initialized");
  });
});
