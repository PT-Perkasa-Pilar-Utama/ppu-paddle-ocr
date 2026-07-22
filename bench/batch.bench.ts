import { PaddleOcrService } from "../src";
import { Bench, printResults } from "./harness";

// Images per batch / measurement rounds. Override with env:
//   BATCH_N=32 ROUNDS=9 bun bench/batch.bench.ts
const N = Number(process.env.BATCH_N ?? 16);
const ROUNDS = Number(process.env.ROUNDS ?? 7);

const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
const images = Array.from({ length: N }, () => imageBuffer.slice(0));

// Uses the library's default models (v5).
const service = new PaddleOcrService({
  processing: { engine: "opencv" },
  recognition: { charactersDictionary: [] as string[] },
});
await service.initialize();

// `noCache` forces real work every iteration - otherwise identical buffers
// would short-circuit on the LRU cache and the comparison would be meaningless.
const opts = { noCache: true } as const;

console.log(`\n=== batch vs. concurrent recognize() - ${N} images/iter, ${ROUNDS} rounds ===`);
console.log(`opencv, noCache, ${process.platform}/${process.arch}, bun ${Bun.version}\n`);

const bench = new Bench({ rounds: ROUNDS, warmup: 1, trackMemory: true });
bench.add("sequential for-loop", async () => {
  for (const img of images) await service.recognize(img, opts);
});
bench.add("Promise.all(map(recognize))", () =>
  Promise.all(images.map((img) => service.recognize(img, opts)))
);
bench.add("batchRecognize (auto)", () => service.batchRecognize(images, opts));
bench.add("batchRecognize (c=4)", () =>
  service.batchRecognize(images, { ...opts, concurrency: 4 })
);
bench.add("batchRecognize (c=8)", () =>
  service.batchRecognize(images, { ...opts, concurrency: 8 })
);

printResults(await bench.run());

await service.destroy();
