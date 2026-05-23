import { PaddleOcrService } from "../src";

import dict from "../models/en_dict.txt" with { type: "file" };
import recModel from "../models/en_PP-OCRv4_mobile_rec_infer.onnx" with { type: "file" };
import detModel from "../models/PP-OCRv5_mobile_det_infer.onnx" with { type: "file" };

// Images per batch / measurement rounds. Override with env:
//   BATCH_N=32 ROUNDS=9 bun bench/batch.bench.ts
const N = Number(process.env.BATCH_N ?? 16);
const ROUNDS = Number(process.env.ROUNDS ?? 7);

const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
const images = Array.from({ length: N }, () => imageBuffer.slice(0));

const service = new PaddleOcrService({
  model: { detection: detModel, recognition: recModel, charactersDictionary: dict },
  processing: { engine: "opencv" },
  recognition: { charactersDictionary: [] as string[] },
});
await service.initialize();

// `noCache` forces real work every iteration — otherwise identical buffers
// would short-circuit on the LRU cache and the comparison would be meaningless.
const opts = { noCache: true } as const;

const methods: Record<string, () => Promise<unknown>> = {
  "sequential for-loop": async () => {
    for (const img of images) await service.recognize(img, opts);
  },
  "Promise.all(map(recognize))": () =>
    Promise.all(images.map((img) => service.recognize(img, opts))),
  "batchRecognize (auto)": () => service.batchRecognize(images, opts),
  "batchRecognize (c=4)": () => service.batchRecognize(images, { ...opts, concurrency: 4 }),
  "batchRecognize (c=8)": () => service.batchRecognize(images, { ...opts, concurrency: 8 }),
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** Measure one method run: wall time + peak RSS sampled across event-loop turns. */
async function measure(fn: () => Promise<unknown>): Promise<{ ms: number; peakMb: number }> {
  Bun.gc(true);
  let peak = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }, 4);
  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  clearInterval(sampler);
  return { ms, peakMb: peak / 1024 / 1024 };
}

const stats = Object.entries(methods).map(([name, fn]) => ({
  name,
  fn,
  times: [] as number[],
  peaks: [] as number[],
}));

// Warm up every method once (JIT, allocator) before timing.
for (const s of stats) await s.fn();

// Round-robin so thermal/GC drift hits every method equally.
for (let r = 0; r < ROUNDS; r++) {
  for (const s of stats) {
    const { ms, peakMb } = await measure(s.fn);
    s.times.push(ms);
    s.peaks.push(peakMb);
  }
}

console.log(`\n=== batch vs. concurrent recognize() — ${N} images/iter, ${ROUNDS} rounds ===`);
console.log(`opencv, noCache, ${process.platform}/${process.arch}, bun ${Bun.version}\n`);
console.log("method                          median ms/iter   ms/image   peak RSS");
console.log("------------------------------- -------------- ---------- ----------");
for (const s of stats) {
  const ms = median(s.times);
  const mb = median(s.peaks);
  console.log(
    `${s.name.padEnd(31)} ${ms.toFixed(0).padStart(11)} ms ${(ms / N).toFixed(1).padStart(8)} ms ${mb.toFixed(0).padStart(7)} MB`
  );
}

await service.destroy();
