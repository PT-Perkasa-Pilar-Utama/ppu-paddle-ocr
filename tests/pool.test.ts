import { describe, expect, test } from "bun:test";
import type { BatchItemResult } from "../src/core/batch.js";
import { createAsyncQueue, runPool } from "../src/core/batch.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function collect<O>() {
  const out: BatchItemResult<O>[] = [];
  return { out, onSettle: (r: BatchItemResult<O>) => out.push(r) };
}

describe("runPool", () => {
  test("returns every item tagged with its input index", async () => {
    const { out, onSettle } = collect<number>();
    await runPool([10, 20, 30], { concurrency: 2, settle: true }, async (n) => n * 2, onSettle);

    const byIndex = out.sort((a, b) => a.index - b.index);
    expect(byIndex.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(byIndex.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([20, 40, 60]);
  });

  test("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const { onSettle } = collect<number>();

    await runPool(
      [1, 2, 3, 4, 5, 6],
      { concurrency: 2, settle: true },
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delay(10);
        inFlight--;
        return n;
      },
      onSettle
    );

    expect(peak).toBe(2);
  });

  test("settle:true reports per-item rejections without aborting", async () => {
    const { out, onSettle } = collect<number>();
    await runPool(
      [1, 2, 3],
      { concurrency: 3, settle: true },
      async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      },
      onSettle
    );

    expect(out).toHaveLength(3);
    const rejected = out.find((r) => r.status === "rejected");
    expect(rejected?.index).toBe(1);
  });

  test("settle:false rejects on the first error", async () => {
    const { onSettle } = collect<number>();
    const run = runPool(
      [1, 2, 3],
      { concurrency: 1, settle: false },
      async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      },
      onSettle
    );

    await expect(run).rejects.toThrow("boom");
  });

  test("aborts before scheduling when signal already aborted", async () => {
    const { onSettle } = collect<number>();
    const ac = new AbortController();
    ac.abort();

    const run = runPool(
      [1, 2],
      { concurrency: 1, settle: true, signal: ac.signal },
      async (n) => n,
      onSettle
    );
    await expect(run).rejects.toThrow();
  });

  test("abort mid-flight stops scheduling and rejects", async () => {
    const { out, onSettle } = collect<number>();
    const ac = new AbortController();

    const run = runPool(
      [1, 2, 3, 4, 5],
      { concurrency: 1, settle: true, signal: ac.signal },
      async (n) => {
        if (n === 2) ac.abort();
        await delay(5);
        return n;
      },
      onSettle
    );

    await expect(run).rejects.toThrow();
    // Scheduling halts: not all five items get processed.
    expect(out.length).toBeLessThan(5);
  });

  test("reports progress with running count and total", async () => {
    const seen: Array<[number, number | undefined]> = [];
    const { onSettle } = collect<number>();

    await runPool(
      [1, 2, 3],
      {
        concurrency: 1,
        settle: true,
        total: 3,
        onProgress: (done, total) => seen.push([done, total]),
      },
      async (n) => n,
      onSettle
    );

    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  test("consumes async iterables", async () => {
    async function* gen() {
      yield "a";
      yield "b";
      yield "c";
    }
    const { out, onSettle } = collect<string>();

    await runPool(gen(), { concurrency: 2, settle: true }, async (s) => s.toUpperCase(), onSettle);

    expect(out.map((r) => r.index).sort()).toEqual([0, 1, 2]);
  });
});

describe("createAsyncQueue", () => {
  test("drains pushed items then closes", async () => {
    const q = createAsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.close();

    const got: number[] = [];
    for await (const n of q.drain()) got.push(n);
    expect(got).toEqual([1, 2]);
  });

  test("flushes buffered items before throwing on failure", async () => {
    const q = createAsyncQueue<number>();
    q.push(1);
    q.fail(new Error("late"));

    const got: number[] = [];
    await expect(
      (async () => {
        for await (const n of q.drain()) got.push(n);
      })()
    ).rejects.toThrow("late");
    expect(got).toEqual([1]);
  });
});
