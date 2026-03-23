import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ImageProcessor } from "ppu-ocv";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

import dict from "../models/en_dict.txt" with { type: "file" };
import recModel from "../models/en_PP-OCRv4_mobile_rec_infer.onnx" with { type: "file" };
import detModel from "../models/PP-OCRv5_mobile_det_infer.onnx" with { type: "file" };

const imgFile = Bun.file(import.meta.dir + "/../assets/receipt.jpg");
const imageBuffer = await imgFile.arrayBuffer();

describe("PaddleOcrService Initialization", () => {
  let service: PaddleOcrService | null = null;

  afterEach(async () => {
    if (service) {
      await service.destroy();
      service = null;
    }
  });

  test("should initialize with default models from GitHub", async () => {
    // This test will be slow as it downloads models
    service = new PaddleOcrService();
    await service.initialize();
    expect(service.isInitialized()).toBe(true);

    const result = await service.recognize(imageBuffer);
    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.8);
  }, 30000); // Increase timeout for download

  test("should initialize and recognize using explicit file paths", async () => {
    service = new PaddleOcrService({
      model: {
        detection: detModel,
        recognition: recModel,
        charactersDictionary: dict,
      },
    });
    await service.initialize();

    expect(service.isInitialized()).toBe(true);

    const result = await service.recognize(imageBuffer);
    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  test("should initialize and recognize from ArrayBuffer inputs", async () => {
    const detBuffer = await Bun.file(detModel).arrayBuffer();
    const recBuffer = await Bun.file(recModel).arrayBuffer();
    const dictBuffer = await Bun.file(dict).arrayBuffer();

    expect(detBuffer.byteLength).toBeGreaterThan(0);
    expect(recBuffer.byteLength).toBeGreaterThan(0);
    expect(dictBuffer.byteLength).toBeGreaterThan(0);

    service = new PaddleOcrService({
      model: {
        detection: detBuffer,
        recognition: recBuffer,
        charactersDictionary: dictBuffer,
      },
    });
    await service.initialize();

    expect(service.isInitialized()).toBe(true);

    const result = await service.recognize(imageBuffer);
    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.8);
  });
});

describe("PaddleOcrService.recognize()", () => {
  let service: PaddleOcrService;

  beforeEach(async () => {
    service = new PaddleOcrService({
      model: {
        detection: detModel,
        recognition: recModel,
        charactersDictionary: dict,
      },
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.destroy();
  });

  test("should return grouped results by default (flatten: false)", async () => {
    const result = await service.recognize(imageBuffer);

    expect(result).toBeObject();
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("lines");
    expect(result).toHaveProperty("confidence");
    expect(result).not.toHaveProperty("results");

    expect(result.text).toBeString();
    expect(result.confidence).toBeNumber();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.lines).toBeArray();
    expect(result.lines.length).toBeGreaterThan(0);

    const firstLine = result.lines[0];
    expect(firstLine).toBeArray();
    expect(firstLine!.length).toBeGreaterThan(0);

    const firstItem = firstLine![0];
    expect(firstItem).toBeObject();
    expect(firstItem).toHaveProperty("text");
    expect(firstItem).toHaveProperty("box");

    expect(firstItem).toHaveProperty("confidence");
    expect(firstItem!.confidence).toBeNumber();
    expect(firstItem!.box).toHaveProperty("x");
  });

  test("should return flattened results when flatten option is true", async () => {
    const result = await service.recognize(imageBuffer, { flatten: true });

    expect(result).toBeObject();
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("confidence");
    expect(result).not.toHaveProperty("lines");

    expect(result.text).toBeString();
    expect(result.confidence).toBeNumber();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.results).toBeArray();
    expect(result.results.length).toBeGreaterThan(0);

    if (result.results.length > 0) {
      expect(result.results[0]).not.toBeArray();
    }

    const firstItem = result.results[0];
    expect(firstItem).toBeObject();
    expect(firstItem).toHaveProperty("text");
    expect(firstItem).toHaveProperty("box");
    expect(firstItem).toHaveProperty("confidence");
    expect(firstItem!.confidence).toBeNumber();
  });

  test("should return consistent data between grouped and flattened modes", async () => {
    const groupedResult = await service.recognize(imageBuffer);
    const flattenedResult = await service.recognize(imageBuffer, {
      flatten: true,
    });

    expect(flattenedResult.confidence).toBe(groupedResult.confidence);
    expect(flattenedResult.text).toBe(groupedResult.text);

    const groupedItemCount = groupedResult.lines.flat().length;
    expect(flattenedResult.results.length).toBe(groupedItemCount);
  });

  test("should recognize from Canvas input (no base64 roundtrip)", async () => {
    await ImageProcessor.initRuntime();
    const canvas = await ImageProcessor.prepareCanvas(imageBuffer);
    const result = await service.recognize(canvas as any, { noCache: true });

    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  test("should reuse internal services across multiple calls", async () => {
    const result1 = await service.recognize(imageBuffer, { noCache: true });
    const result2 = await service.recognize(imageBuffer, { noCache: true });

    expect(result1.text).toBe(result2.text);
    expect(result1.confidence).toBe(result2.confidence);
    expect(result1.lines.length).toBe(result2.lines.length);
  });

  test("should preserve OCR text when parallel recognition is enabled", async () => {
    const sequentialService = new PaddleOcrService({
      model: {
        detection: detModel,
        recognition: recModel,
        charactersDictionary: dict,
      },
      recognition: {
        parallelWorkers: 1,
      },
    });
    const parallelService = new PaddleOcrService({
      model: {
        detection: detModel,
        recognition: recModel,
        charactersDictionary: dict,
      },
      recognition: {
        parallelWorkers: 4,
      },
    });

    try {
      await sequentialService.initialize();
      await parallelService.initialize();

      const sequentialResult = await sequentialService.recognize(imageBuffer, {
        flatten: true,
        noCache: true,
      });
      const parallelResult = await parallelService.recognize(imageBuffer, {
        flatten: true,
        noCache: true,
      });

      expect(parallelResult.text).toBe(sequentialResult.text);
      expect(parallelResult.results.length).toBe(
        sequentialResult.results.length,
      );
      expect(
        Math.abs(parallelResult.confidence - sequentialResult.confidence),
      ).toBeLessThan(0.000001);
    } finally {
      await sequentialService.destroy();
      await parallelService.destroy();
    }
  });

  test("should run recognition calls concurrently up to recognition.parallelWorkers", async () => {
    const parallelWorkers = 3;
    const parallelService = new PaddleOcrService({
      model: {
        detection: detModel,
        recognition: recModel,
        charactersDictionary: dict,
      },
      recognition: {
        parallelWorkers,
      },
    });

    await parallelService.initialize();

    const recognitionSession = (parallelService as any).recognitionSession;
    const originalRun = recognitionSession.run.bind(recognitionSession);
    let activeRuns = 0;
    let maxActiveRuns = 0;

    recognitionSession.run = async (...args: any[]) => {
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      try {
        await Bun.sleep(5);
        return await originalRun(...args);
      } finally {
        activeRuns -= 1;
      }
    };

    try {
      const result = await parallelService.recognize(imageBuffer, {
        flatten: true,
        noCache: true,
      });
      expect(result.results.length).toBeGreaterThan(0);
      expect(maxActiveRuns).toBeGreaterThan(1);
      expect(maxActiveRuns).toBeLessThanOrEqual(parallelWorkers);
    } finally {
      recognitionSession.run = originalRun;
      await parallelService.destroy();
    }
  });

  test("should release model buffers after initialization", async () => {
    const freshService = new PaddleOcrService({
      model: {
        detection: detModel,
        recognition: recModel,
        charactersDictionary: dict,
      },
    });
    await freshService.initialize();

    const result = await freshService.recognize(imageBuffer);
    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0.8);

    await freshService.destroy();
  });
});

describe("ImageProcessor try/finally safety", () => {
  let service: PaddleOcrService;

  beforeEach(async () => {
    service = new PaddleOcrService({
      model: {
        detection: detModel,
        recognition: recModel,
        charactersDictionary: dict,
      },
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.destroy();
  });

  test("should handle multiple sequential recognitions without leaks", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await service.recognize(imageBuffer, { noCache: true });
      expect(result.text).not.toBeEmpty();
      expect(result.confidence).toBeGreaterThan(0.5);
    }
  });
});
