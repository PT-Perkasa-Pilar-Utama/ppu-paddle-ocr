import { describe, expect, test } from "bun:test";
import { BasePaddleOcrService } from "../src/core/base-paddle-ocr.service.js";
import type { CoreCanvas, PlatformProvider } from "../src/core/platform.js";
import type { PaddleOcrResult } from "../src/core/base-paddle-ocr.service.js";
import type { PaddleOptions } from "../src/interface.js";
import { Semaphore } from "../src/utils.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tiny image stand-in for all function signatures that expect ArrayBuffer. */
const DUMMY = new ArrayBuffer(4);

function makeMockPlatform(): PlatformProvider {
  return {
    pathSeparator: "/",
    ort: {
      Tensor: class MockTensor {
        dispose() {}
      } as any,
      InferenceSession: {} as any,
    },
    createCanvas: (_w: number, _h: number) => ({}) as CoreCanvas,
    isCanvas: (_img: unknown): _img is CoreCanvas => false,
    loadResource: async () => new ArrayBuffer(0),
    saveDebugImage: async () => {},
    imageProcessor: {
      prepareCanvas: async () => ({}) as CoreCanvas,
      ImageProcessor: class {} as any,
      Contours: class {} as any,
      cv: {} as any,
      CanvasToolkit: {
        getInstance: () => ({ clearOutput: () => {} }),
      } as any,
    },
  };
}

class MockOcrService extends BasePaddleOcrService {
  private readonly inferenceDelay: number;

  constructor(options: PaddleOptions = {}, inferenceDelay = 0) {
    super(makeMockPlatform(), options);
    this.inferenceDelay = inferenceDelay;
  }

  protected async initSessions(): Promise<void> {
    const d = this.inferenceDelay;

    this.detector = {
      run: async (_canvas: any): Promise<any[]> => {
        if (d > 0) await delay(d);
        return []; // 0 boxes to _recognize short-circuits with empty result
      },
      deskew: async (canvas: any): Promise<any> => canvas,
    } as any;

    this.recognitor = {
      run: async (): Promise<any[]> => [],
    } as any;
  }

  get _semaphore(): Semaphore {
    return (this as any).semaphore as Semaphore;
  }
}

describe("maxQueueSize — queue overflow rejection", () => {
  test("rejects immediately when pendingCount reaches maxQueueSize", async () => {
    const svc = new MockOcrService({ maxConcurrency: 1, maxQueueSize: 2 });

    svc._semaphore.acquire();

    // Two calls should queue successfully (pendingCount 1, then 2)
    const p1 = svc.recognize(DUMMY).catch(() => {});
    const p2 = svc.recognize(DUMMY).catch(() => {});

    expect(svc._semaphore.pendingCount).toBe(2);
    expect(svc.recognize(DUMMY)).rejects.toThrow("queue is full");
    svc._semaphore.release();
    await Promise.allSettled([p1, p2]);
  });

  test("allows exactly maxQueueSize calls to queue before rejecting", async () => {
    const MAX = 3;
    const svc = new MockOcrService({ maxConcurrency: 1, maxQueueSize: MAX });

    svc._semaphore.acquire();

    const queued = Array.from({ length: MAX }, () =>
      svc.recognize(DUMMY).catch(() => {}),
    );
    expect(svc._semaphore.pendingCount).toBe(MAX);

    expect(svc.recognize(DUMMY)).rejects.toThrow("queue is full");

    svc._semaphore.release();
    await Promise.allSettled(queued);
  });

  test("maxQueueSize=0 (default) never rejects regardless of queue depth", async () => {
    const svc = new MockOcrService({ maxConcurrency: 1, maxQueueSize: 0 });

    svc._semaphore.acquire();

    const calls = Array.from({ length: 15 }, () =>
      svc.recognize(DUMMY).catch(() => {}),
    );

    expect(svc._semaphore.pendingCount).toBe(15);

    svc._semaphore.release();
    await Promise.allSettled(calls);
  });

  test("error message contains maxQueueSize value for debuggability", async () => {
    const svc = new MockOcrService({ maxConcurrency: 1, maxQueueSize: 1 });

    svc._semaphore.acquire();
    const p = svc.recognize(DUMMY).catch(() => {});

    const err = await svc.recognize(DUMMY).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("maxQueueSize=1");

    svc._semaphore.release();
    await p;
  });
});

describe("maxConcurrency=1 — serial execution", () => {
  let svc: MockOcrService;

  test("at most 1 _recognize() runs at a time under concurrent load", async () => {
    svc = new MockOcrService({ maxConcurrency: 1 }, 25 /* ms per call */);

    let active = 0;
    let maxObservedActive = 0;
    const orig: (...args: any[]) => any = (svc as any)._recognize.bind(svc);
    (svc as any)._recognize = async (...args: any[]) => {
      active++;
      maxObservedActive = Math.max(maxObservedActive, active);
      try {
        return await orig(...args);
      } finally {
        active--;
      }
    };

    await Promise.all(
      Array.from({ length: 5 }, () => svc.recognize(DUMMY)),
    );

    expect(maxObservedActive).toBe(1);
  }, 10_000);

  test("completion order is FIFO — calls finish in the order they were submitted", async () => {
    svc = new MockOcrService({ maxConcurrency: 1 }, 10 /* ms per call */);
    const completionOrder: number[] = [];

    await Promise.all(
      [0, 1, 2, 3, 4].map((id) =>
        svc
          .recognize(DUMMY)
          .then(() => completionOrder.push(id)),
      ),
    );

    expect(completionOrder).toEqual([0, 1, 2, 3, 4]);
  }, 10_000);

  test("total elapsed time ≈ N x inferenceDelay (serial, not parallel)", async () => {
    const DELAY = 30;
    const N = 4;
    svc = new MockOcrService({ maxConcurrency: 1 }, DELAY);

    const t0 = Date.now();
    await Promise.all(Array.from({ length: N }, () => svc.recognize(DUMMY)));
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeGreaterThanOrEqual((N - 1) * DELAY - 20);
  }, 10_000);

  test("all concurrent requests complete and return valid empty results", async () => {
    svc = new MockOcrService({ maxConcurrency: 1 }, 5);

    const results = (await Promise.all(
      Array.from({ length: 6 }, () => svc.recognize(DUMMY)),
    )) as PaddleOcrResult[];

    for (const r of results) {
      expect(r).toHaveProperty("text");
      expect(r).toHaveProperty("lines");
      expect(r).toHaveProperty("confidence");
    }
  }, 10_000);
});

describe("maxConcurrency=2 — limited parallelism", () => {
  let svc: MockOcrService;

  test("maxObservedActive is exactly 2 when 4 calls race with enough work per call", async () => {
    svc = new MockOcrService({ maxConcurrency: 2 }, 40);

    let active = 0;
    let maxObservedActive = 0;
    const orig: (...args: any[]) => any = (svc as any)._recognize.bind(svc);
    (svc as any)._recognize = async (...args: any[]) => {
      active++;
      maxObservedActive = Math.max(maxObservedActive, active);
      try {
        return await orig(...args);
      } finally {
        active--;
      }
    };

    await Promise.all(
      Array.from({ length: 4 }, () => svc.recognize(DUMMY)),
    );

    expect(maxObservedActive).toBe(2);
  }, 10_000);

  test("total elapsed is roughly halved compared to serial for 4 equal-duration tasks", async () => {
    const DELAY = 30;
    svc = new MockOcrService({ maxConcurrency: 2 }, DELAY);

    const t0 = Date.now();
    await Promise.all(Array.from({ length: 4 }, () => svc.recognize(DUMMY)));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(3 * DELAY + 40);
  }, 10_000);
});

describe("deskewImage shares the concurrency gate", () => {
  test("deskewImage and recognize() count against the same maxConcurrency=1 limit", async () => {
    const svc = new MockOcrService({ maxConcurrency: 1 }, 20);

    let active = 0;
    let maxObservedActive = 0;

    // Patch both private methods
    for (const method of ["_recognize", "_deskewImage"] as const) {
      const orig: (...a: any[]) => any = (svc as any)[method].bind(svc);
      (svc as any)[method] = async (...args: any[]) => {
        active++;
        maxObservedActive = Math.max(maxObservedActive, active);
        try {
          return await orig(...args);
        } finally {
          active--;
        }
      };
    }

    await Promise.all([
      svc.recognize(DUMMY),
      svc.deskewImage(DUMMY),
      svc.recognize(DUMMY),
      svc.deskewImage(DUMMY),
    ]);

    expect(maxObservedActive).toBe(1);
  }, 10_000);
});
