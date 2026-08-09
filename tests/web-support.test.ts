import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getPlatform, setPlatform } from "ppu-ocv";

/**
 * Unit tests for the web support module structure.
 * These tests verify that the web entry point exports are correctly wired up
 * and that the web services can be imported without pulling in Node-specific deps.
 */

// Importing the web entry (below, dynamically) calls ppu-ocv's process-global
// setPlatform(webPlatform). Save the platform before this file's tests and
// restore it after, so node test files that run later in the same `bun test`
// process aren't left on the web path (createImageBitmap is not defined).
let savedPlatform: ReturnType<typeof getPlatform>;
beforeAll(() => {
  savedPlatform = getPlatform();
});
afterAll(() => {
  setPlatform(savedPlatform);
});

describe("Web module exports", () => {
  test("src/web/index.ts exports PaddleOcrService", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.PaddleOcrService).toBeDefined();
    expect(typeof mod.PaddleOcrService).toBe("function");
  });

  test("src/web/index.ts exports DetectionService", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.DetectionService).toBeDefined();
    expect(typeof mod.DetectionService).toBe("function");
  });

  test("src/web/index.ts exports RecognitionService", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.RecognitionService).toBeDefined();
    expect(typeof mod.RecognitionService).toBe("function");
  });

  test("src/web/index.ts exports shared constants", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.DEFAULT_PADDLE_OPTIONS).toBeDefined();
    expect(mod.DEFAULT_DETECTION_OPTIONS).toBeDefined();
    expect(mod.DEFAULT_RECOGNITION_OPTIONS).toBeDefined();
    expect(mod.DEFAULT_DEBUGGING_OPTIONS).toBeDefined();
  });

  test("DEFAULT_PADDLE_OPTIONS has expected shape", async () => {
    const mod = await import("../src/web/index.js");
    const opts = mod.DEFAULT_PADDLE_OPTIONS;

    expect(opts).toHaveProperty("model");
    expect(opts).toHaveProperty("detection");
    expect(opts).toHaveProperty("recognition");
    expect(opts).toHaveProperty("debugging");
    expect(opts).toHaveProperty("session");
  });
});

describe("Web PaddleOcrService instantiation", () => {
  test("can create PaddleOcrService instance with default options", async () => {
    const { PaddleOcrService } = await import("../src/web/index.js");

    const service = new PaddleOcrService();
    expect(service).toBeDefined();
    expect(service.isInitialized()).toBe(false);
  });

  test("can create PaddleOcrService instance with custom options", async () => {
    const { PaddleOcrService } = await import("../src/web/index.js");

    const service = new PaddleOcrService({
      detection: {
        maxSideLength: 480,
      },
      debugging: {
        verbose: false,
      },
    });
    expect(service).toBeDefined();
    expect(service.isInitialized()).toBe(false);
  });

  test("recognize throws when not initialized", async () => {
    const { PaddleOcrService } = await import("../src/web/index.js");

    const service = new PaddleOcrService();

    expect(service.recognize(new ArrayBuffer(10), { flatten: true })).rejects.toThrow(
      "Initialization is handled proactively"
    );
  });

  test("destroy is safe to call without initialization", async () => {
    const { PaddleOcrService } = await import("../src/web/index.js");

    const service = new PaddleOcrService();
    await service.destroy(); // should not throw
    expect(service.isInitialized()).toBe(false);
  });
});

describe("Web services do not import Node-specific modules", () => {
  test("web detection service file does not import fs, path, or os", async () => {
    const content = await Bun.file("./src/web/detection.service.web.ts").text();
    expect(content).not.toContain('from "fs"');
    expect(content).not.toContain('from "path"');
    expect(content).not.toContain('from "os"');
    expect(content).not.toContain("onnxruntime-node");
  });

  test("web recognition service file does not import fs, path, or os", async () => {
    const content = await Bun.file("./src/web/recognition.service.web.ts").text();
    expect(content).not.toContain('from "fs"');
    expect(content).not.toContain('from "path"');
    expect(content).not.toContain('from "os"');
    expect(content).not.toContain("onnxruntime-node");
  });

  test("web paddle-ocr service file does not import fs, path, or os", async () => {
    const content = await Bun.file("./src/web/paddle-ocr.service.web.ts").text();
    expect(content).not.toContain('from "fs"');
    expect(content).not.toContain('from "path"');
    expect(content).not.toContain('from "os"');
    expect(content).not.toContain("onnxruntime-node");
  });

  test("web services use onnxruntime-web", async () => {
    const det = await Bun.file("./src/web/detection.service.web.ts").text();
    const rec = await Bun.file("./src/web/recognition.service.web.ts").text();
    const ocr = await Bun.file("./src/web/paddle-ocr.service.web.ts").text();

    expect(det).toContain("onnxruntime-web");
    expect(rec).toContain("onnxruntime-web");
    expect(ocr).toContain("onnxruntime-web");
  });

  test("web platform provider uses the browser canvas backend", async () => {
    const platform = await Bun.file("./src/web/platform.web.ts").text();

    expect(platform).toContain('from "ppu-ocv/canvas-web"');
    expect(platform).not.toContain("@napi-rs/canvas");
  });
});

describe("Shared modules are reused in web path", () => {
  test("web index re-exports shared interface types", async () => {
    const content = await Bun.file("./src/web/index.ts").text();
    expect(content).toContain("../interface.js");
    expect(content).toContain("../constants.js");
  });

  test("core base service uses shared image-cache", async () => {
    const content = await Bun.file("./src/core/base-paddle-ocr.service.ts").text();
    expect(content).toContain("image-cache");
  });

  test("constants exports match between main and web", async () => {
    const mainMod = await import("../src/constants.js");
    const webMod = await import("../src/web/index.js");

    expect(webMod.DEFAULT_PADDLE_OPTIONS).toEqual(mainMod.DEFAULT_PADDLE_OPTIONS);
    expect(webMod.DEFAULT_DETECTION_OPTIONS).toEqual(mainMod.DEFAULT_DETECTION_OPTIONS);
    expect(webMod.DEFAULT_RECOGNITION_OPTIONS).toEqual(mainMod.DEFAULT_RECOGNITION_OPTIONS);
    expect(webMod.DEFAULT_DEBUGGING_OPTIONS).toEqual(mainMod.DEFAULT_DEBUGGING_OPTIONS);
  });
});

describe("WebGPU execution-provider detection", () => {
  test("isWebGpuAvailable is exported", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.isWebGpuAvailable).toBeDefined();
    expect(typeof mod.isWebGpuAvailable).toBe("function");
  });

  test("getDefaultWebExecutionProviders is exported", async () => {
    const mod = await import("../src/web/index.js");
    expect(mod.getDefaultWebExecutionProviders).toBeDefined();
    expect(typeof mod.getDefaultWebExecutionProviders).toBe("function");
  });

  test("isWebGpuAvailable returns false in Node/Bun (no navigator.gpu)", async () => {
    const { isWebGpuAvailable } = await import("../src/web/index.js");
    const result = await isWebGpuAvailable();
    expect(result).toBe(false);
  });

  test("getDefaultWebExecutionProviders falls back to ['wasm'] in Node/Bun", async () => {
    const { getDefaultWebExecutionProviders } = await import("../src/web/index.js");
    const providers = await getDefaultWebExecutionProviders();
    expect(providers).toEqual(["wasm"]);
  });

  test("isWebGpuAvailable detects WebGPU when navigator.gpu is present", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    const mockAdapter = { features: new Set() };
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => mockAdapter,
      },
    };

    try {
      const { isWebGpuAvailable } = await import("../src/web/index.js");
      const result = await isWebGpuAvailable();
      expect(result).toBe(true);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });

  test("isWebGpuAvailable returns false when requestAdapter rejects", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => {
          throw new Error("nope");
        },
      },
    };

    try {
      const { isWebGpuAvailable } = await import("../src/web/index.js");
      const result = await isWebGpuAvailable();
      expect(result).toBe(false);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });

  test("isWebGpuAvailable returns false when requestAdapter returns null (e.g., no hardware)", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => null,
      },
    };

    try {
      const { isWebGpuAvailable } = await import("../src/web/index.js");
      const result = await isWebGpuAvailable();
      expect(result).toBe(false);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });

  test("getDefaultWebExecutionProviders prefers WebGPU first when available", async () => {
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = {
      gpu: {
        requestAdapter: async () => ({ features: new Set() }),
      },
    };

    try {
      const { getDefaultWebExecutionProviders } = await import("../src/web/index.js");
      const providers = await getDefaultWebExecutionProviders();
      expect(providers).toEqual(["webgpu", "wasm"]);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
    }
  });
});

describe("mainThreadYieldMs web default", () => {
  test("main thread gets the 10ms default, workers and servers stay disabled", async () => {
    const { withMainThreadYieldDefault } = await import("../src/web/recognition.service.web.js");
    const { DEFAULT_WEB_MAIN_THREAD_YIELD_MS } = await import("../src/constants.js");

    expect(withMainThreadYieldDefault({}, true).mainThreadYieldMs).toBe(
      DEFAULT_WEB_MAIN_THREAD_YIELD_MS
    );
    // Off the main thread the options pass through untouched, so the shared
    // default (0, disabled) applies.
    expect(withMainThreadYieldDefault({}, false).mainThreadYieldMs).toBeUndefined();
    // Bun has no `window`, so the auto-detect resolves to "not main thread".
    expect(withMainThreadYieldDefault({}).mainThreadYieldMs).toBeUndefined();
  });

  test("an explicit caller value wins, including an explicit 0", async () => {
    const { withMainThreadYieldDefault } = await import("../src/web/recognition.service.web.js");

    expect(withMainThreadYieldDefault({ mainThreadYieldMs: 0 }, true).mainThreadYieldMs).toBe(0);
    expect(withMainThreadYieldDefault({ mainThreadYieldMs: 32 }, true).mainThreadYieldMs).toBe(32);
  });
});
