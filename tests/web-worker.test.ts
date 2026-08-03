// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Issue #84: the web build must run inside a Web Worker, where the only canvas
 * is `OffscreenCanvas` - a worker scope exposes neither `document` nor
 * `HTMLCanvasElement`, and touching either one throws a ReferenceError.
 *
 * This suite installs the `web-ocr.test.ts` polyfills minus those two DOM-only
 * globals, so any web-path code that reaches for the DOM fails here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import * as ort from "onnxruntime-web";
import { getPlatform, setPlatform } from "ppu-ocv";

import type { CanvasLike } from "ppu-ocv/web";
import type { CoreCanvas, PlatformProvider } from "../src/core/platform.js";
import type { Box } from "../src/interface.js";
import type { PaddleOcrService } from "../src/web/paddle-ocr.service.web.js";
import type { WebPlatformProvider } from "../src/web/platform.web.js";
import { DEFAULT_MODEL } from "../src/model-catalogue.js";
import { PaddleOcrService as NodePaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { installWebCanvas, uninstallWebCanvas } from "./web-canvas-polyfill.js";

// The web entry is imported dynamically inside beforeAll - never at module load -
// so it cannot flip ppu-ocv's process-global platform before the previous one is
// captured. The web platform is then registered explicitly rather than relying on
// the import side effect, which only fires on the first import in the process.
let WebPaddleOcrService: typeof PaddleOcrService;
let WebPlatform: typeof WebPlatformProvider;
let isWebWorker: () => boolean;
let applyDefaultWasmPaths: () => void;
let savedPlatform: ReturnType<typeof getPlatform>;

// Default-model buffers read from the Node disk cache. Injecting them directly
// keeps initialize() free of network calls.
let detModel: ArrayBuffer;
let recModel: ArrayBuffer;
let dictionary: ArrayBuffer;

const CACHE = join(homedir(), ".cache", "ppu-paddle-ocr");
const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/tilted.png`).arrayBuffer();

beforeAll(async () => {
  await NodePaddleOcrService.downloadModels();
  const cached = (url: string) =>
    Bun.file(join(CACHE, url.slice(url.lastIndexOf("/") + 1))).arrayBuffer();
  [detModel, recModel, dictionary] = await Promise.all([
    cached(DEFAULT_MODEL.detection),
    cached(DEFAULT_MODEL.recognition),
    cached(DEFAULT_MODEL.charactersDictionary),
  ]);

  savedPlatform = getPlatform();
  installWebCanvas({ worker: true });

  const { webPlatform } = await import("ppu-ocv/canvas-web");
  setPlatform(webPlatform);

  ({ PaddleOcrService: WebPaddleOcrService } =
    await import("../src/web/paddle-ocr.service.web.js"));
  ({
    WebPlatformProvider: WebPlatform,
    isWebWorker,
    applyDefaultWasmPaths,
  } = await import("../src/web/platform.web.js"));
}, 120_000);

afterAll(() => {
  if (!savedPlatform) return;
  uninstallWebCanvas();
  setPlatform(savedPlatform);
});

describe("worker scope", () => {
  test("has OffscreenCanvas but no document, HTMLCanvasElement, or window", () => {
    expect(typeof OffscreenCanvas).toBe("function");
    expect(typeof document).toBe("undefined");
    expect(typeof HTMLCanvasElement).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });
});

describe("WebPlatformProvider.createCanvas", () => {
  test("creates a canvas without document.createElement", () => {
    const canvas = new WebPlatform().createCanvas(64, 32);

    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(32);
  });

  test("returns a canvas whose 2D context reads back what it draws", () => {
    const canvas = new WebPlatform().createCanvas(8, 4);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 8, 4);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;

    expect([pixel[0], pixel[1], pixel[2], pixel[3]]).toEqual([255, 255, 255, 255]);
  });

  test("keeps a single context instance across calls, so the warmed attributes stick", () => {
    const canvas = new WebPlatform().createCanvas(4, 4);

    expect(canvas.getContext("2d")).toBe(canvas.getContext("2d"));
  });
});

describe("WebPlatformProvider.isCanvas", () => {
  test("accepts a canvas without evaluating HTMLCanvasElement", () => {
    const platform = new WebPlatform();

    expect(platform.isCanvas(platform.createCanvas(4, 4))).toBe(true);
  });

  test("accepts any host object exposing getContext", () => {
    expect(new WebPlatform().isCanvas({ width: 1, height: 1, getContext: () => null })).toBe(true);
  });

  test.each([
    ["an ArrayBuffer", new ArrayBuffer(8)],
    ["null", null],
    ["undefined", undefined],
    ["a string", "canvas"],
    ["a plain object", {}],
  ])("rejects %s", (_label, value) => {
    expect(new WebPlatform().isCanvas(value)).toBe(false);
  });
});

describe("environment probes", () => {
  const scope = globalThis as { WorkerGlobalScope?: unknown };
  let savedWasmPaths: typeof ort.env.wasm.wasmPaths;

  const enterWorkerScope = () => {
    scope.WorkerGlobalScope = class {};
  };

  afterEach(() => {
    delete scope.WorkerGlobalScope;
    ort.env.wasm.wasmPaths = savedWasmPaths;
  });

  beforeAll(() => {
    savedWasmPaths = ort.env.wasm.wasmPaths;
  });

  test("isWebWorker is false in Node/Bun, where WorkerGlobalScope does not exist", () => {
    expect(isWebWorker()).toBe(false);
  });

  test("isWebWorker is true once WorkerGlobalScope exists", () => {
    enterWorkerScope();

    expect(isWebWorker()).toBe(true);
  });

  test("applyDefaultWasmPaths points a worker at the CDN copy", () => {
    enterWorkerScope();
    ort.env.wasm.wasmPaths = undefined;

    applyDefaultWasmPaths();

    expect(String(ort.env.wasm.wasmPaths)).toContain("onnxruntime-web");
  });

  test("applyDefaultWasmPaths never overrides a path the host app chose", () => {
    enterWorkerScope();
    ort.env.wasm.wasmPaths = "/vendor/ort/";

    applyDefaultWasmPaths();

    expect(ort.env.wasm.wasmPaths).toBe("/vendor/ort/");
  });

  test("applyDefaultWasmPaths leaves Node/Bun alone, where the files are on disk", () => {
    ort.env.wasm.wasmPaths = undefined;

    applyDefaultWasmPaths();

    expect(ort.env.wasm.wasmPaths).toBeUndefined();
  });
});

describe("crop encoding", () => {
  test("encodes through convertToBlob, the only encoder an OffscreenCanvas has", async () => {
    const { cropDetectedBoxes } = await import("../src/core/detection/crop-boxes.js");
    const png = new Uint8Array([137, 80, 78, 71]);
    const offscreen = {
      width: 4,
      height: 4,
      convertToBlob: async () => new Blob([png], { type: "image/png" }),
    };
    const platform = {
      pathSeparator: "/",
      canvas: { getToolkit: () => ({ crop: () => offscreen }) },
    } as unknown as PlatformProvider;
    const boxes: Box[] = [{ x: 0, y: 0, width: 4, height: 4 }];

    const crops = await cropDetectedBoxes(platform, offscreen as unknown as CoreCanvas, boxes, {
      crop: true,
    });

    expect(crops).toHaveLength(1);
    expect(new Uint8Array(crops[0])).toEqual(png);
  });
});

describe("full OCR pipeline in a worker scope", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    service = new WebPaddleOcrService({
      model: { detection: detModel, recognition: recModel, charactersDictionary: dictionary },
      processing: { engine: "canvas-native" },
    });
    await service.initialize();
  }, 120_000);

  afterAll(async () => {
    await service?.destroy();
  });

  test("recognizes an ArrayBuffer", async () => {
    const result = await service.recognize(imageBuffer, { noCache: true });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.lines.length).toBeGreaterThan(0);
  }, 60_000);

  test("recognizes an OffscreenCanvas passed straight in", async () => {
    const canvas = await new WebPlatform().canvas.prepareCanvas(imageBuffer);

    const result = await service.recognize(canvas as unknown as CanvasLike, { noCache: true });

    expect(result.text.length).toBeGreaterThan(0);
  }, 60_000);
});
