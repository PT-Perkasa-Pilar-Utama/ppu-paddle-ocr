import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { BatchItemResult } from "../src/core/batch.js";
import type { AnyOcrResult } from "../src/core/base-paddle-ocr.service.js";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();

let service: PaddleOcrService;
let single: string;

beforeAll(async () => {
  await PaddleOcrService.downloadModels();
  // Uses the library's default models (v5).
  service = new PaddleOcrService();
  await service.initialize();
  single = (await service.recognize(imageBuffer)).text;
}, 30_000);

afterAll(async () => {
  await service?.destroy();
});

describe("batchRecognize", () => {
  test("returns one result per image, index-aligned and matching single recognize", async () => {
    const results = await service.batchRecognize([imageBuffer, imageBuffer, imageBuffer]);
    expect(results).toHaveLength(3);
    for (const r of results) expect(r.text).toBe(single);
  });

  test("honors flatten passthrough", async () => {
    const [r] = await service.batchRecognize([imageBuffer], { flatten: true });
    expect(r).toHaveProperty("results");
    expect(Array.isArray((r as { results: unknown[] }).results)).toBe(true);
  });

  test("reports progress for every item", async () => {
    const ticks: number[] = [];
    await service.batchRecognize([imageBuffer, imageBuffer], {
      onProgress: (done) => ticks.push(done),
    });
    expect(ticks).toEqual([1, 2]);
  });

  test("settle:true isolates a failing image", async () => {
    const bad = new ArrayBuffer(8); // not a decodable image
    const results = (await service.batchRecognize([imageBuffer, bad, imageBuffer], {
      settle: true,
    })) as BatchItemResult<AnyOcrResult>[];

    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]?.status).toBe("fulfilled");
  });

  test("settle:false rejects the whole batch on first failure", async () => {
    const bad = new ArrayBuffer(8);
    await expect(service.batchRecognize([bad, imageBuffer])).rejects.toBeDefined();
  });

  test("rejects when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      service.batchRecognize([imageBuffer], { signal: ac.signal })
    ).rejects.toBeDefined();
  });
});

describe("batchRecognizeStream", () => {
  test("yields each result with its input index", async () => {
    const seen: number[] = [];
    for await (const item of service.batchRecognizeStream([imageBuffer, imageBuffer])) {
      expect(item.status).toBe("fulfilled");
      seen.push(item.index);
    }
    expect(seen.sort()).toEqual([0, 1]);
  });

  test("throws on first failure when settle is false", async () => {
    const bad = new ArrayBuffer(8);
    const run = async () => {
      for await (const _ of service.batchRecognizeStream([bad])) {
        // drain
      }
    };
    await expect(run()).rejects.toBeDefined();
  });
});
