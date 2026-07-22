/** Thrown when the inference queue is saturated; surfaced as HTTP 429. */
export class QueueFullError extends Error {
  constructor(depth: number) {
    super(`Inference queue is full (${depth} waiting). Retry later.`);
    this.name = "QueueFullError";
  }
}

/**
 * Bounded-concurrency gate around inference. Caps how many `recognize` calls
 * run at once (1 on an accelerator, a small pool on CPU) and rejects with
 * {@link QueueFullError} once the wait list exceeds `maxDepth` - backpressure
 * that keeps host RAM and device VRAM bounded under load.
 */
export class InferenceQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxDepth: number
  ) {}

  get inFlight(): number {
    return this.active;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency && this.waiters.length >= this.maxDepth) {
      throw new QueueFullError(this.waiters.length);
    }
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}
