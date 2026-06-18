import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MODEL_URLS } from "../src/core/base-paddle-ocr.service.js";
import { getCachedResourceFileName } from "../src/processor/model-cache.js";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import { levenshteinDistance, parseDictionary } from "../src/utils.js";

const CACHED_DICT_PATH = join(
  homedir(),
  ".cache",
  "ppu-paddle-ocr",
  getCachedResourceFileName(DEFAULT_MODEL_URLS.charactersDictionary)
);
const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
const groundTruth = (
  await Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`).text()
).trim();

const ACCURACY_FLOOR = 95;

function accuracy(text: string): number {
  const dist = levenshteinDistance(text.trim(), groundTruth);
  return ((groundTruth.length - dist) / groundTruth.length) * 100;
}

let dictBufferWithBlank: ArrayBuffer;
let dictBufferWithoutBlank: ArrayBuffer;

beforeAll(async () => {
  await PaddleOcrService.downloadModels();

  const dictWithBlank = readFileSync(CACHED_DICT_PATH, "utf-8");
  const dictWithoutBlank = dictWithBlank.startsWith("\n") ? dictWithBlank.slice(1) : dictWithBlank;

  dictBufferWithBlank = new TextEncoder().encode(dictWithBlank).buffer as ArrayBuffer;
  dictBufferWithoutBlank = new TextEncoder().encode(dictWithoutBlank).buffer as ArrayBuffer;
}, 120000);

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

describe("Dict load path: initialize() with default model", () => {
  let service: PaddleOcrService;

  afterEach(async () => {
    if (service) await service.destroy();
  });

  test("dict with leading blank line yields correct OCR", async () => {
    service = new PaddleOcrService({
      model: { charactersDictionary: dictBufferWithBlank },
    });
    await service.initialize();
    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);

  test("dict without leading blank line yields correct OCR", async () => {
    service = new PaddleOcrService({
      model: { charactersDictionary: dictBufferWithoutBlank },
    });
    await service.initialize();
    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(accuracy(result.text)).toBeGreaterThan(ACCURACY_FLOOR);
  }, 30000);
});

describe("Dict load path: changeTextDictionary() on default model", () => {
  let service: PaddleOcrService;

  beforeEach(async () => {
    service = new PaddleOcrService({
      model: { charactersDictionary: dictBufferWithBlank },
    });
    await service.initialize();
  }, 60000);

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

describe("Dict load path: per-call options.dictionary on default model", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    service = new PaddleOcrService({
      model: { charactersDictionary: dictBufferWithBlank },
    });
    await service.initialize();
  }, 60000);

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
