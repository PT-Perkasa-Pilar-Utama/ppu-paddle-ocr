// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Bounded-concurrency orchestration used by `batchRecognize` /
 * `batchRecognizeStream`. Kept platform-agnostic and free of any OCR types so
 * it can be unit-tested in isolation.
 */

/** A single settled batch item, tagged with its input index. */
export type BatchItemResult<T> =
  | { index: number; status: "fulfilled"; value: T }
  | { index: number; status: "rejected"; reason: unknown };

/** Controls how {@link runPool} schedules and settles work. */
export type RunPoolOptions = {
  /** Maximum number of tasks in flight at once. Clamped to >= 1. */
  concurrency: number;
  /** When `true`, per-item rejections are reported instead of aborting the run. */
  settle: boolean;
  /** Cancels scheduling of further items; the run rejects with an `AbortError`. */
  signal?: AbortSignal;
  /** Invoked after each item settles, with the running done count and total (if known). */
  onProgress?: (done: number, total: number | undefined) => void;
  /** Total item count when the input length is known up front. */
  total?: number;
};

function toAbortError(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The batch operation was aborted.", "AbortError");
}

/** Wrap a sync or async iterable in a uniform async iterator. */
function toAsyncIterator<I>(inputs: Iterable<I> | AsyncIterable<I>): AsyncIterator<I> {
  if (Symbol.asyncIterator in inputs) {
    return (inputs as AsyncIterable<I>)[Symbol.asyncIterator]();
  }
  const sync = (inputs as Iterable<I>)[Symbol.iterator]();
  return {
    next: () => Promise.resolve(sync.next()),
    return: (value?: unknown) =>
      Promise.resolve(sync.return?.(value) ?? { done: true, value: undefined }),
  };
}

/**
 * Run `task` over `inputs` with at most `concurrency` tasks in flight,
 * invoking `onSettle` as each item finishes (in completion order, each tagged
 * with its input index for reordering).
 *
 * Resolves once every item has settled. With `settle: false` it rejects on the
 * first task error after halting further scheduling; with `settle: true` every
 * item is delivered to `onSettle` and the run only rejects on abort. Honors
 * `signal` by ceasing to schedule new items (in-flight tasks are not forcibly
 * cancelled, but their results are dropped).
 */
export async function runPool<I, O>(
  inputs: Iterable<I> | AsyncIterable<I>,
  options: RunPoolOptions,
  task: (item: I, index: number) => Promise<O>,
  onSettle: (result: BatchItemResult<O>) => void
): Promise<void> {
  const { settle, signal } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency));

  if (signal?.aborted) throw toAbortError(signal);

  let nextIndex = 0;
  let done = 0;
  let stopped = false;
  let failed = false;
  let failure: unknown;

  // Fast path: a plain array needs no async iterator — workers claim slots
  // through a shared synchronous cursor, avoiding two promise allocations
  // per item (the serialization lock + `iterator.next()`).
  const array = Array.isArray(inputs) ? (inputs as I[]) : null;
  const iterator = array ? null : toAsyncIterator(inputs);

  // Async iterators forbid concurrent `next()` calls, so serialize pulls
  // through a one-slot async lock shared by all workers.
  let lock: Promise<void> = Promise.resolve();
  const nextItem = async (): Promise<IteratorResult<I>> => {
    const previous = lock;
    let release!: () => void;
    lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await (iterator as AsyncIterator<I>).next();
    } finally {
      release();
    }
  };

  const onAbort = () => {
    stopped = true;
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const worker = async (): Promise<void> => {
    while (!stopped) {
      let item: I;
      let index: number;

      if (array) {
        if (nextIndex >= array.length) return;
        index = nextIndex++;
        item = array[index] as I;
      } else {
        const next = await nextItem();
        if (next.done || stopped) return;
        index = nextIndex++;
        item = next.value;
      }

      try {
        const value = await task(item, index);
        if (stopped) return;
        onSettle({ index, status: "fulfilled", value });
      } catch (reason) {
        if (settle) {
          onSettle({ index, status: "rejected", reason });
        } else {
          stopped = true;
          failed = true;
          failure = reason;
          return;
        }
      } finally {
        done++;
        options.onProgress?.(done, options.total);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await iterator?.return?.();
  }

  if (signal?.aborted) throw toAbortError(signal);
  if (failed) throw failure;
}

/**
 * A minimal single-consumer async queue: producers `push` settled items, the
 * consumer drains them as an async iterable. Bridges {@link runPool}'s callback
 * model to `batchRecognizeStream`'s generator.
 */
export function createAsyncQueue<T>(): {
  push: (item: T) => void;
  close: () => void;
  fail: (error: unknown) => void;
  drain: () => AsyncGenerator<T>;
} {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let failure: { error: unknown } | null = null;

  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  return {
    push(item: T) {
      items.push(item);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    fail(error: unknown) {
      failure = { error };
      closed = true;
      notify();
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        while (items.length > 0) {
          yield items.shift() as T;
        }
        if (failure) throw failure.error;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
