import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { V5_EN_MOBILE_MODEL } from "../src/model-catalogue.js";
import { cachePathFor } from "../src/processor/model-cache.js";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { levenshteinDistance, parseDictionary } from "../src/utils.js";

// The v5 EN dict lives in the model cache (downloaded by the top-level warmup below).
const CACHED_V5_DICT_PATH = cachePathFor(V5_EN_MOBILE_MODEL.charactersDictionary);
const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
const groundTruth = (
  await Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`).text()
).trim();

const ACCURACY_FLOOR = 95;

function accuracy(text: string): number {
  const dist = levenshteinDistance(text.trim(), groundTruth);
  return ((groundTruth.length - dist) / groundTruth.length) * 100;
}

// Warm the caches at module level, not in beforeAll: the clearModelCache test
// in strategies-options.test.ts deletes the v5 files from the shared cache, so
// any later (or next-run) suite starts cold here, and a cold re-download can
// blow bun's fixed 5 s lifecycle-hook timeout on slow networks. Top-level
// await has no such cap.
await PaddleOcrService.downloadModels(); // v6 default cache (used by the main test suite)

// Warm v5 EN model cache so ppocrv5_en_dict.txt exists on disk.
// We initialize a throwaway service with V5_EN_MOBILE_MODEL; the Node
// cache layer writes each file on first fetch and skips it on subsequent runs.
const warmup = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL });
await warmup.initialize();
await warmup.destroy();

const dictWithBlank = readFileSync(CACHED_V5_DICT_PATH, "utf-8");
const dictWithoutBlank = dictWithBlank.startsWith("\n") ? dictWithBlank.slice(1) : dictWithBlank;

const dictBufferWithBlank = new TextEncoder().encode(dictWithBlank).buffer as ArrayBuffer;
const dictBufferWithoutBlank = new TextEncoder().encode(dictWithoutBlank).buffer as ArrayBuffer;

describe("parseDictionary", () => {
  test("preserves leading blank line", () => {
    expect(parseDictionary("\nA\nB\nC\n")).toEqual(["", "A", "B", "C", ""]);
  });

  test("works without leading blank line", () => {
    expect(parseDictionary("A\nB\nC\n")).toEqual(["A", "B", "C", ""]);
  });

  test("handles CRLF line endings", () => {
    expect(parseDictionary("A\r\nB\r\nC\r\n")).toEqual(["A", "B", "C", ""]);
  });

  test("handles mixed LF and CRLF", () => {
    expect(parseDictionary("A\r\nB\nC\r\n")).toEqual(["A", "B", "C", ""]);
  });

  test("accepts ArrayBuffer input", () => {
    const buf = new TextEncoder().encode("\nX\nY\n").buffer as ArrayBuffer;
    expect(parseDictionary(buf)).toEqual(["", "X", "Y", ""]);
  });

  test("accepts Uint8Array input", () => {
    const arr = new TextEncoder().encode("\nP\nQ\n");
    expect(parseDictionary(arr)).toEqual(["", "P", "Q", ""]);
  });

  test("empty string returns single empty entry", () => {
    expect(parseDictionary("")).toEqual([""]);
  });
});

// These three describe blocks test dictionary loading behaviour using the v5
// English models explicitly. Using v5 ensures the dict size (437 entries)
// matches the model's output classes, giving a meaningful accuracy signal.

describe("Dict load path: initialize() with v5 model", () => {
  let service: PaddleOcrService;

  afterEach(async () => {
    if (service) await service.destroy();
  });

  test("dict with leading blank line yields correct OCR", async () => {
    service = new PaddleOcrService({
      model: { ...V5_EN_MOBILE_MODEL, charactersDictionary: dictBufferWithBlank },
    });
    await service.initialize();
    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);

  test("dict without leading blank line yields correct OCR", async () => {
    service = new PaddleOcrService({
      model: { ...V5_EN_MOBILE_MODEL, charactersDictionary: dictBufferWithoutBlank },
    });
    await service.initialize();
    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);
});

describe("Dict load path: changeTextDictionary() on v5 model", () => {
  let service: PaddleOcrService;

  beforeEach(async () => {
    service = new PaddleOcrService({
      model: { ...V5_EN_MOBILE_MODEL, charactersDictionary: dictBufferWithBlank },
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.destroy();
  });

  test("swap to dict with leading blank line", async () => {
    await service.changeTextDictionary(dictBufferWithBlank);
    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);

  test("swap to dict without leading blank line", async () => {
    await service.changeTextDictionary(dictBufferWithoutBlank);
    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);
});

describe("Dict load path: per-call options.dictionary on v5 model", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    service = new PaddleOcrService({
      model: { ...V5_EN_MOBILE_MODEL, charactersDictionary: dictBufferWithBlank },
    });
    await service.initialize();
  });

  test("override with dict containing leading blank line", async () => {
    const result = await service.recognize(imageBuffer, {
      noCache: true,
      dictionary: dictBufferWithBlank,
    });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);

  test("override with dict missing leading blank line", async () => {
    const result = await service.recognize(imageBuffer, {
      noCache: true,
      dictionary: dictBufferWithoutBlank,
    });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);

  test("teardown", async () => {
    await service.destroy();
  });
});
