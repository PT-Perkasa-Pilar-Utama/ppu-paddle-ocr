import { describe, expect, test } from "bun:test";
import { Semaphore } from "../src/utils.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("Semaphore construction", () => {
  test("throws RangeError for slots = 0", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });

  test("throws RangeError for negative slots", () => {
    expect(() => new Semaphore(-5)).toThrow(RangeError);
  });

  test("creates successfully for slots >= 1", () => {
    expect(() => new Semaphore(1)).not.toThrow();
    expect(() => new Semaphore(100)).not.toThrow();
  });
});

describe("Semaphore acquire / release", () => {
  test("acquire() resolves synchronously (within microtask) when slots are available", async () => {
    const sem = new Semaphore(2);
    let count = 0;

    sem.acquire().then(() => count++);
    sem.acquire().then(() => count++);

    expect(count).toBe(0);
    await tick();
    expect(count).toBe(2);
  });

  test("acquire() blocks when all slots are occupied", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let resolved = false;
    const waiter = sem.acquire().then(() => {
      resolved = true;
    });

    await tick();
    expect(resolved).toBe(false);
    sem.release();
    await waiter;
    expect(resolved).toBe(true);
  });

  test("pendingCount reflects the queue depth accurately through the lifecycle", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    expect(sem.pendingCount).toBe(0);

    const p1 = sem.acquire();
    expect(sem.pendingCount).toBe(1);

    const p2 = sem.acquire();
    expect(sem.pendingCount).toBe(2);

    const p3 = sem.acquire();
    expect(sem.pendingCount).toBe(3);

    sem.release();
    await p1;
    expect(sem.pendingCount).toBe(2);

    sem.release();
    await p2;
    expect(sem.pendingCount).toBe(1);

    sem.release();
    await p3;
    expect(sem.pendingCount).toBe(0);
  });

  test("Semaphore(3) allows 3 simultaneous acquirers with no waiting", async () => {
    const sem = new Semaphore(3);
    const t0 = Date.now();

    await Promise.all([sem.acquire(), sem.acquire(), sem.acquire()]);

    expect(Date.now() - t0).toBeLessThan(20);
    expect(sem.pendingCount).toBe(0);
  });

  test("slots are fully restored to initial capacity after a complete acquire/release cycle", async () => {
    const sem = new Semaphore(3);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();

    let queued = false;
    const p = sem.acquire().then(() => {
      queued = true;
    });
    expect(sem.pendingCount).toBe(1);

    sem.release();
    sem.release();
    sem.release();
    await p;
    expect(queued).toBe(true);

    const t0 = Date.now();
    await Promise.all([sem.acquire(), sem.acquire(), sem.acquire()]);
    expect(Date.now() - t0).toBeLessThan(20);
  });
});


describe("Semaphore FIFO ordering", () => {
  test("waiters are woken in the order they called acquire()", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];

    const tasks = [1, 2, 3, 4, 5].map((id) =>
      sem.acquire().then(() => {
        order.push(id);
        sem.release(); 
      }),
    );

    sem.release(); 
    await Promise.all(tasks);

    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  test("completion timestamps are monotonically increasing with maxConcurrency=1", async () => {
    const DELAY = 15;
    const sem = new Semaphore(1);

    const timestamps: number[] = [];

    const work = async () => {
      await sem.acquire();
      try {
        await delay(DELAY);
        timestamps.push(Date.now());
      } finally {
        sem.release();
      }
    };

    await Promise.all([work(), work(), work(), work()]);

    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]! - timestamps[i - 1]!).toBeGreaterThanOrEqual(
        DELAY - 5,
      );
    }
  });
});

describe("Semaphore error resilience", () => {
  test("release() inside finally still unblocks the next waiter when the guarded task throws", async () => {
    const sem = new Semaphore(1);

    const failingTask = async () => {
      await sem.acquire();
      try {
        throw new Error("deliberate failure");
      } finally {
        sem.release();
      }
    };

    await expect(failingTask()).rejects.toThrow("deliberate failure");

    let resolved = false;
    sem.acquire().then(() => {
      resolved = true;
    });
    await tick();
    expect(resolved).toBe(true);
  });

  test("mixed success/failure tasks: all waiters eventually unblock", async () => {
    const sem = new Semaphore(1);
    const N = 6;
    let settled = 0;

    const tasks = Array.from({ length: N }, (_, i) =>
      (async () => {
        await sem.acquire();
        try {
          await delay(5);
          if (i % 2 === 0) throw new Error(`fail-${i}`);
        } finally {
          sem.release();
          settled++;
        }
      })().catch(() => {}),
    );

    await Promise.all(tasks);
    expect(settled).toBe(N);
    expect(sem.pendingCount).toBe(0);
  });
});

describe("Semaphore concurrency ceiling", () => {
  test("maxObservedActive never exceeds slots under heavy concurrent load", async () => {
    const SLOTS = 3;
    const WORKERS = 30;
    const sem = new Semaphore(SLOTS);

    let active = 0;
    let maxActive = 0;

    const work = async () => {
      await sem.acquire();
      try {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(Math.floor(Math.random() * 20));
      } finally {
        active--;
        sem.release();
      }
    };

    await Promise.all(Array.from({ length: WORKERS }, work));

    expect(maxActive).toBeLessThanOrEqual(SLOTS);
    expect(maxActive).toBeGreaterThan(0);
    expect(sem.pendingCount).toBe(0);
  });

  test("Semaphore(1) is strictly serial: never 2 concurrent callers", async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let wasEverDouble = false;

    const work = async () => {
      await sem.acquire();
      try {
        active++;
        if (active > 1) wasEverDouble = true;
        await delay(10);
      } finally {
        active--;
        sem.release();
      }
    };

    await Promise.all(Array.from({ length: 10 }, work));

    expect(wasEverDouble).toBe(false);
  });
});
