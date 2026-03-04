import { describe, expect, test } from "bun:test";

/**
 * Unit tests for the web support module structure.
 * These tests verify that the web entry point exports are correctly wired up
 * and that the web services can be imported without pulling in Node-specific deps.
 */

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
        autoDeskew: false,
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

    expect(
      service.recognize(new ArrayBuffer(10)),
    ).rejects.toThrow("not initialized");
  });

  test("deskewImage throws when not initialized", async () => {
    const { PaddleOcrService } = await import("../src/web/index.js");

    const service = new PaddleOcrService();

    expect(
      service.deskewImage(new ArrayBuffer(10)),
    ).rejects.toThrow("not initialized");
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
    const content = await Bun.file(
      "./src/web/detection.service.web.ts",
    ).text();
    expect(content).not.toContain('from "fs"');
    expect(content).not.toContain('from "path"');
    expect(content).not.toContain('from "os"');
    expect(content).not.toContain("onnxruntime-node");
  });

  test("web recognition service file does not import fs, path, or os", async () => {
    const content = await Bun.file(
      "./src/web/recognition.service.web.ts",
    ).text();
    expect(content).not.toContain('from "fs"');
    expect(content).not.toContain('from "path"');
    expect(content).not.toContain('from "os"');
    expect(content).not.toContain("onnxruntime-node");
  });

  test("web paddle-ocr service file does not import fs, path, or os", async () => {
    const content = await Bun.file(
      "./src/web/paddle-ocr.service.web.ts",
    ).text();
    expect(content).not.toContain('from "fs"');
    expect(content).not.toContain('from "path"');
    expect(content).not.toContain('from "os"');
    expect(content).not.toContain("onnxruntime-node");
  });

  test("web services use onnxruntime-web", async () => {
    const det = await Bun.file(
      "./src/web/detection.service.web.ts",
    ).text();
    const rec = await Bun.file(
      "./src/web/recognition.service.web.ts",
    ).text();
    const ocr = await Bun.file(
      "./src/web/paddle-ocr.service.web.ts",
    ).text();

    expect(det).toContain("onnxruntime-web");
    expect(rec).toContain("onnxruntime-web");
    expect(ocr).toContain("onnxruntime-web");
  });

  test("web services use ppu-ocv/web", async () => {
    const det = await Bun.file(
      "./src/web/detection.service.web.ts",
    ).text();
    const rec = await Bun.file(
      "./src/web/recognition.service.web.ts",
    ).text();
    const ocr = await Bun.file(
      "./src/web/paddle-ocr.service.web.ts",
    ).text();

    expect(det).toContain("ppu-ocv/web");
    expect(rec).toContain("ppu-ocv/web");
    expect(ocr).toContain("ppu-ocv/web");
  });
});

describe("Shared modules are reused in web path", () => {
  test("web index re-exports shared interface types", async () => {
    const content = await Bun.file("./src/web/index.ts").text();
    expect(content).toContain("../interface.js");
    expect(content).toContain("../constants.js");
  });

  test("web paddle-ocr service uses shared image-cache", async () => {
    const content = await Bun.file(
      "./src/web/paddle-ocr.service.web.ts",
    ).text();
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
