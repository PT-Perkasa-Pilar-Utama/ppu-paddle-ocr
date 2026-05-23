/**
 * Tiny zero-dependency benchmark harness.
 *
 * Replaces mitata (which crashed intermittently on this suite). Measures each
 * task in-process with `performance.now`, round-robin across rounds so thermal
 * and GC drift hit every task equally, and reports the median (robust to
 * throttling spikes) plus optional peak RSS.
 */

export type BenchResult = {
  name: string;
  samples: number;
  /** Median wall time per run, in milliseconds. */
  median: number;
  mean: number;
  min: number;
  max: number;
  /** Sample standard deviation, in milliseconds. */
  stddev: number;
  /** Median peak RSS during a run, in MB (only when `trackMemory` is set). */
  peakMb?: number;
};

export type BenchOptions = {
  /** Recorded measurement rounds (round-robin across tasks). @default 15 */
  rounds?: number;
  /** Unrecorded warmup passes per task before timing. @default 1 */
  warmup?: number;
  /** Sample peak RSS during each run (forces GC before each run). @default false */
  trackMemory?: boolean;
};

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = sorted(xs);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function forceGc(): void {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else (globalThis as { gc?: () => void }).gc?.();
}

async function timeOnce(
  fn: () => unknown,
  trackMemory: boolean
): Promise<{ ms: number; peakMb: number }> {
  let peak = 0;
  let sampler: ReturnType<typeof setInterval> | undefined;
  if (trackMemory) {
    forceGc();
    peak = process.memoryUsage().rss;
    sampler = setInterval(() => {
      const rss = process.memoryUsage().rss;
      if (rss > peak) peak = rss;
    }, 4);
  }
  const start = performance.now();
  await fn();
  const ms = performance.now() - start;
  if (sampler) clearInterval(sampler);
  return { ms, peakMb: peak / 1024 / 1024 };
}

/** Collect tasks with `add()`, then `run()` them round-robin and get stats. */
export class Bench {
  private readonly tasks: Array<{ name: string; fn: () => unknown }> = [];
  private readonly rounds: number;
  private readonly warmup: number;
  private readonly trackMemory: boolean;

  constructor(options: BenchOptions = {}) {
    this.rounds = options.rounds ?? 15;
    this.warmup = options.warmup ?? 1;
    this.trackMemory = options.trackMemory ?? false;
  }

  add(name: string, fn: () => unknown): this {
    this.tasks.push({ name, fn });
    return this;
  }

  async run(): Promise<BenchResult[]> {
    const acc = this.tasks.map((t) => ({ ...t, times: [] as number[], peaks: [] as number[] }));

    for (const t of acc) {
      for (let i = 0; i < this.warmup; i++) await t.fn();
    }

    for (let r = 0; r < this.rounds; r++) {
      for (const t of acc) {
        const { ms, peakMb } = await timeOnce(t.fn, this.trackMemory);
        t.times.push(ms);
        t.peaks.push(peakMb);
      }
    }

    return acc.map((t) => ({
      name: t.name,
      samples: t.times.length,
      median: median(t.times),
      mean: mean(t.times),
      min: Math.min(...t.times),
      max: Math.max(...t.times),
      stddev: stddev(t.times),
      peakMb: this.trackMemory ? median(t.peaks) : undefined,
    }));
  }
}

/** Print a results table plus a relative-speed summary (fastest = baseline). */
export function printResults(results: BenchResult[]): void {
  if (results.length === 0) return;
  const withMemory = results.some((r) => r.peakMb !== undefined);
  const nameWidth = Math.max(...results.map((r) => r.name.length), 8);

  const memHeader = withMemory ? "   peak RSS" : "";
  const header = `${"task".padEnd(nameWidth)}   median      ±stddev        min        max${memHeader}`;
  console.log(header);
  console.log("-".repeat(header.length));

  const ms = (n: number) => `${n.toFixed(1)} ms`;
  for (const r of results) {
    const cells = [
      r.name.padEnd(nameWidth),
      ms(r.median).padStart(11),
      ms(r.stddev).padStart(13),
      ms(r.min).padStart(11),
      ms(r.max).padStart(11),
    ];
    if (withMemory) cells.push(`${r.peakMb?.toFixed(0)} MB`.padStart(11));
    console.log(cells.join(""));
  }

  const ranked = [...results].sort((a, b) => a.median - b.median);
  const fastest = ranked[0];
  if (!fastest || ranked.length < 2) return;
  console.log(`\nsummary — fastest: ${fastest.name}`);
  for (const r of ranked.slice(1)) {
    console.log(`  ${(r.median / fastest.median).toFixed(2)}x slower  ${r.name}`);
  }
}
