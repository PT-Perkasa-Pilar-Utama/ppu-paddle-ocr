// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

import { DEFAULT_MODEL_URLS } from "../src/model-catalogue.js";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

const imgFile = Bun.file(`${import.meta.dir}/../assets/receipt.jpg`);
const imageBuffer = await imgFile.arrayBuffer();

beforeAll(async () => {
  await PaddleOcrService.downloadModels();
}, 120000); // v6 models may need downloading on first run

describe("recognition strategies", () => {
  let service: PaddleOcrService;

  afterEach(async () => {
    if (service) await service.destroy();
  });

  for (const strategy of ["per-box", "per-line", "cross-line"] as const) {
    test(`recognizes with the ${strategy} strategy (per-call override)`, async () => {
      service = new PaddleOcrService();
      await service.initialize();

      const result = await service.recognize(imageBuffer, { strategy, noCache: true });
      expect(result.text).toBeString();
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.lines.length).toBeGreaterThan(0);
    }, 30000);
  }

  test("cross-line honors crossLineWidthFactor from service options", async () => {
    service = new PaddleOcrService({
      recognition: {
        charactersDictionary: [],
        strategy: "cross-line",
        crossLineWidthFactor: 1.5,
      },
    });
    await service.initialize();

    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text.length).toBeGreaterThan(0);
  }, 30000);

  test("flatten + per-box override returns a flat array", async () => {
    service = new PaddleOcrService();
    await service.initialize();

    const result = await service.recognize(imageBuffer, {
      strategy: "per-box",
      flatten: true,
      noCache: true,
    });
    expect(result.results).toBeArray();
    expect(result.results.length).toBeGreaterThan(0);
  }, 30000);
});

describe("detection and recognition option overrides", () => {
  let service: PaddleOcrService;

  afterEach(async () => {
    if (service) await service.destroy();
  });

  test("custom detection tuning still produces text", async () => {
    service = new PaddleOcrService({
      detection: {
        maxSideLength: 480,
        minimumAreaThreshold: 10,
        paddingVertical: 0.2,
        paddingHorizontal: 0.3,
        mean: [0.5, 0.5, 0.5],
        stdDeviation: [0.5, 0.5, 0.5],
      },
    });
    await service.initialize();

    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text.length).toBeGreaterThan(0);
  }, 30000);
});

describe("debugging options", () => {
  const debugFolder = `${import.meta.dir}/../out-test-debug`;

  afterAll(() => {
    if (existsSync(debugFolder)) rmSync(debugFolder, { recursive: true, force: true });
  });

  test("verbose + debug exercise the logging and dump paths", async () => {
    // Run the verbose/debug code paths for coverage, but silence the console so
    // the suite output stays clean (the calls still execute, just to a no-op).
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const service = new PaddleOcrService({
        debugging: { verbose: true, debug: true, debugFolder },
      });
      await service.initialize();

      const result = await service.recognize(imageBuffer, { noCache: true });
      expect(result.text.length).toBeGreaterThan(0);

      await service.destroy();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  }, 30000);
});

describe("batch streaming, concurrency, and cancellation", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    service = new PaddleOcrService();
    await service.initialize();
  }, 120000);

  afterAll(async () => {
    if (service) await service.destroy();
  });

  test("batchRecognizeStream yields a result per image", async () => {
    const out: string[] = [];
    for await (const r of service.batchRecognizeStream([imageBuffer, imageBuffer], {
      noCache: true,
    })) {
      expect(r.status).toBe("fulfilled");
      if (r.status === "fulfilled") out.push(r.value.text);
    }
    expect(out.length).toBe(2);
  }, 40000);

  test("explicit concurrency is honored", async () => {
    const results = await service.batchRecognize([imageBuffer, imageBuffer, imageBuffer], {
      concurrency: 2,
      noCache: true,
    });
    expect(results.length).toBe(3);
  }, 40000);

  test("an already-aborted signal rejects the batch", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      service.batchRecognize([imageBuffer, imageBuffer], { signal: ac.signal })
    ).rejects.toBeDefined();
  });

  test("streaming with settle isolates a failing image", async () => {
    const bad = new ArrayBuffer(8); // not a decodable image
    const statuses: string[] = [];
    for await (const r of service.batchRecognizeStream([imageBuffer, bad], {
      settle: true,
      noCache: true,
    })) {
      statuses.push(r.status);
    }
    expect(statuses).toContain("fulfilled");
    expect(statuses).toContain("rejected");
  }, 40000);
});

describe("input forms and caching", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    service = new PaddleOcrService();
    await service.initialize();
  });

  afterAll(async () => {
    if (service) await service.destroy();
  });

  test("cached result is reused on the second call (default caching)", async () => {
    const first = await service.recognize(imageBuffer);
    const second = await service.recognize(imageBuffer);
    expect(second.text).toBe(first.text);
    // flattened read from the same cache entry
    const flat = await service.recognize(imageBuffer, { flatten: true });
    expect(flat.text).toBe(first.text);
  }, 30000);

  test("accepts a per-call dictionary as an ArrayBuffer", async () => {
    // Plumbing check: the per-call `dictionary` override must accept an
    // ArrayBuffer. The v5 en dict is used purely as a convenient fixture — this
    // asserts the override is wired through, not recognition accuracy (the dict
    // need not match the v6 default recognition model for this path).
    const dictBuffer = await Bun.file(
      `${import.meta.dir}/../models/ppocrv5_en_dict.txt`
    ).arrayBuffer();
    const result = await service.recognize(imageBuffer, { dictionary: dictBuffer });
    expect(result.text).toBeString();
  }, 30000);
});

describe("batch over an async iterable", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    service = new PaddleOcrService();
    await service.initialize();
  });

  afterAll(async () => {
    if (service) await service.destroy();
  });

  test("accepts an async iterable input (unknown total)", async () => {
    async function* gen() {
      yield imageBuffer;
      yield imageBuffer;
    }
    const seen: Array<number | undefined> = [];
    const results = await service.batchRecognize(gen(), {
      noCache: true,
      onProgress: (_done, total) => seen.push(total),
    });
    expect(results.length).toBe(2);
    expect(seen).toContain(undefined); // total is unknown for an async iterable
  }, 40000);
});

describe("runtime model and dictionary swapping", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    service = new PaddleOcrService();
    await service.initialize();
  });

  afterAll(async () => {
    if (service) await service.destroy();
  });

  test("swaps the detection model from a buffer", async () => {
    // Detection is generation-agnostic (DB-based), so the v5 mobile detector
    // works against the v6 default recognition head loaded by initialize().
    const det = await Bun.file(
      `${import.meta.dir}/../models/PP-OCRv5_mobile_det_infer.onnx`
    ).arrayBuffer();
    await service.changeDetectionModel(det);

    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text.length).toBeGreaterThan(0);
  }, 40000);

  test("swaps the recognition model from the default URL", async () => {
    // Use the current default (v6 small) recognition model, which matches the
    // v6 dictionary loaded by initialize(); never the stale v4 fixture.
    await service.changeRecognitionModel(DEFAULT_MODEL_URLS.recognition);
    const result = await service.recognize(imageBuffer, { noCache: true });
    expect(result.text.length).toBeGreaterThan(0);
  }, 40000);

  test("rejects an empty dictionary", async () => {
    await expect(service.changeTextDictionary("")).rejects.toBeDefined();
  });
});

describe("error paths and lifecycle", () => {
  test("recognize before initialize throws", async () => {
    const service = new PaddleOcrService();
    await expect(service.recognize(imageBuffer)).rejects.toBeDefined();
  });

  test("isInitialized toggles, and destroy is idempotent", async () => {
    const service = new PaddleOcrService();
    expect(service.isInitialized()).toBe(false);
    await service.initialize();
    expect(service.isInitialized()).toBe(true);
    await service.destroy();
    await service.destroy(); // second destroy must not throw
    expect(service.isInitialized()).toBe(false);
  }, 30000);
});

// Kept last: it clears the model cache, then re-downloads (exercising the
// streaming fetch-with-progress path), leaving the cache warm again.
describe("model cache download path", () => {
  test("clearModelCache then downloadModels fetches and re-caches", async () => {
    // verbose: true exercises the streaming fetch-with-progress logging path;
    // silence the console so the suite output stays clean.
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const service = new PaddleOcrService();
      service.clearModelCache();
      await PaddleOcrService.downloadModels({ verbose: true });

      await service.initialize();
      const result = await service.recognize(imageBuffer, { noCache: true });
      expect(result.text.length).toBeGreaterThan(0);
      await service.destroy();
    } finally {
      logSpy.mockRestore();
    }
  }, 600000); // cold re-download of ~30 MB v6 models needs ample time
});
