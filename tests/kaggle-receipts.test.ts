/**
 * Dataset path: assets/kaggle/images/{0..19}.jpg
 * Ground truth:  assets/kaggle/annotations.xml (bounding-box labels with text)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

declare const Bun: { file: (path: string) => { arrayBuffer(): Promise<ArrayBuffer> } };
declare const process: { memoryUsage(): { rss: number } };

import dict from "../models/en_dict.txt" with { type: "file" };
import recModel from "../models/en_PP-OCRv4_mobile_rec_infer.onnx" with { type: "file" };
import detModel from "../models/PP-OCRv5_mobile_det_infer.onnx" with { type: "file" };

function flatText(result: { text: string }): string {
  return result.text.toUpperCase().replace(/[^A-Z0-9\s]/g, " ");
}

function containsAll(corpus: string, ...keywords: string[]): boolean {
  return keywords.every((kw) => corpus.includes(kw.toUpperCase()));
}

async function loadReceipt(index: number): Promise<ArrayBuffer> {
  const ext = index === 6 ? "JPG" : "jpg";
  return Bun.file(`./assets/kaggle/images/${index}.${ext}`).arrayBuffer();
}

let service: PaddleOcrService;

const MODEL_OPTIONS = {
  model: {
    detection: detModel,
    recognition: recModel,
    charactersDictionary: dict,
  },
};

beforeAll(async () => {
  service = new PaddleOcrService(MODEL_OPTIONS);
  await service.initialize();
}, 60_000);

afterAll(async () => {
  await service.destroy();
});

describe("OCR accuracy on Kaggle receipt images", () => {
  test("image 0: recognises WALMART header", async () => {
    const buf = await loadReceipt(0);
    const result = await service.recognize(buf);

    expect(result.text).not.toBeEmpty();
    expect(result.confidence).toBeGreaterThan(0);
    expect(containsAll(flatText(result), "WALMART")).toBe(true);
  }, 60_000);

  test("image 8: recognises COSTCO header", async () => {
    const buf = await loadReceipt(8);
    const result = await service.recognize(buf);

    expect(result.text).not.toBeEmpty();
    expect(containsAll(flatText(result), "COSTCO")).toBe(true);
  }, 60_000);

  test("image 11: recognises WHOLE FOODS header", async () => {
    const buf = await loadReceipt(11);
    const result = await service.recognize(buf);

    expect(result.text).not.toBeEmpty();
    expect(containsAll(flatText(result), "WHOLE", "FOODS")).toBe(true);
  }, 60_000);


  test("image 1: recognises TRADER JOE header", async () => {
    const buf = await loadReceipt(1);
    const result = await service.recognize(buf);

    expect(result.text).not.toBeEmpty();
    expect(containsAll(flatText(result), "TRADER")).toBe(true);
  }, 60_000);

  test("image 9: recognises WINCO header", async () => {
    const buf = await loadReceipt(9);
    const result = await service.recognize(buf);

    expect(result.text).not.toBeEmpty();
    expect(containsAll(flatText(result), "WINCO")).toBe(true);
  }, 60_000);

  test("result structure: every line has words with text and confidence", async () => {
    const buf = await loadReceipt(0);
    const result = await service.recognize(buf);

    expect(result.lines.length).toBeGreaterThan(0);
    for (const line of result.lines) {
      expect(line.length).toBeGreaterThan(0);
      for (const word of line) {
        expect(typeof word.text).toBe("string");
        expect(word.confidence).toBeGreaterThanOrEqual(0);
        expect(word.confidence).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);
});

describe("Stability under concurrent load (18 receipts)", () => {
  test(
    "all 18 receipts settle and ≥80% return non-empty text",
    async () => {
      const indices = Array.from({ length: 20 }, (_, i) => i).filter((i) => i !== 5 && i !== 14);

      const concurrentService = new PaddleOcrService({
        ...MODEL_OPTIONS,
        maxConcurrency: 2,
      });
      await concurrentService.initialize();

      const buffers = await Promise.all(indices.map(loadReceipt));

      const settled = await Promise.allSettled(
        buffers.map((buf) => concurrentService.recognize(buf)),
      );

      await concurrentService.destroy();

      const fulfilled = settled.filter((s) => s.status === "fulfilled");
      const withText = fulfilled.filter(
        (s) => (s as PromiseFulfilledResult<any>).value.text.length > 0,
      );

      expect(settled.length).toBe(indices.length);

      expect(withText.length / indices.length).toBeGreaterThanOrEqual(0.8);
    },
    300_000,
  );
});

describe("Memory regression: RSS growth over repeated calls", () => {
  test(
    "RSS grows by less than 150 MB across 10 sequential calls with noCache",
    async () => {
      const buf = await loadReceipt(0);

      await service.recognize(buf);

      const rssBefore = process.memoryUsage().rss;

      for (let i = 0; i < 10; i++) {
        await service.recognize(buf, { noCache: true });
      }

      const rssAfter = process.memoryUsage().rss;
      const growthMB = (rssAfter - rssBefore) / (1024 * 1024);

      expect(growthMB).toBeLessThan(150);
    },
    120_000,
  );

  test(
    "RSS growth rate is sub-linear (stabilises after warm-up)",
    async () => {
      const buf = await loadReceipt(0);

      await service.recognize(buf);

      const samples: number[] = [process.memoryUsage().rss];
      for (let i = 1; i <= 10; i++) {
        await service.recognize(buf, { noCache: true });
        samples.push(process.memoryUsage().rss);
      }

      const firstHalfGrowth = samples[5]! - samples[0]!;
      const secondHalfGrowth = samples[10]! - samples[5]!;

      const TOLERANCE_BYTES = 10 * 1024 * 1024;
      expect(secondHalfGrowth).toBeLessThanOrEqual(
        firstHalfGrowth + TOLERANCE_BYTES,
      );
    },
    120_000,
  );
});
