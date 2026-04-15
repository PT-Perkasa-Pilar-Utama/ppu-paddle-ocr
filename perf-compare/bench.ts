/**
 * Side-by-side profiling benchmark for v4.1.1 vs v5.1.1
 *
 * Usage:
 *   bun run perf-compare/bench.ts v4
 *   bun run perf-compare/bench.ts v5
 */
import { performance } from "node:perf_hooks";

const version = process.argv[2] || Bun.argv[2];
if (version !== "v4" && version !== "v5") {
  console.error("Usage: bun run perf-compare/bench.ts <v4|v5>");
  process.exit(1);
}

const { PaddleOcrService } = await import(
  `./${version}/node_modules/ppu-paddle-ocr/index.js`
);

const rootDir = import.meta.dir + "/..";

const detModel = rootDir + "/models/PP-OCRv5_mobile_det_infer.onnx";
const recModel = rootDir + "/models/en_PP-OCRv4_mobile_rec_infer.onnx";
const dict = rootDir + "/models/en_dict.txt";

const receiptBuf = await Bun.file(
  rootDir + "/assets/receipt.jpg",
).arrayBuffer();

let privateBuf: ArrayBuffer | null = null;
try {
  privateBuf = await Bun.file(
    rootDir + "/private-tests/private-test-1.png",
  ).arrayBuffer();
} catch {}

const images: ArrayBuffer[] = [receiptBuf];
if (privateBuf) images.push(privateBuf);

console.log(`\n=== ppu-paddle-ocr ${version} ===`);
console.log(`Images: ${images.length}`);

const serviceOpts: any = {
  model: {
    detection: detModel,
    recognition: recModel,
    charactersDictionary: dict,
  },
};

// v5 supports processing.engine; v4 always uses opencv
if (version === "v5") {
  serviceOpts.processing = { engine: "opencv" };
}

const service = new PaddleOcrService();

// --- Phase 1: initialize ---
const t0 = performance.now();
await service.initialize();
const initMs = performance.now() - t0;
console.log(`initialize(): ${initMs.toFixed(1)} ms`);

// --- Phase 2: first recognize (cold) ---
const t1 = performance.now();
const firstResult = await service.recognize(images[0]!, { noCache: true });
const firstMs = performance.now() - t1;
console.log(
  `first recognize(): ${firstMs.toFixed(1)} ms (detected ${firstResult.lines?.flat().length ?? "?"} items)`,
);

// --- Phase 3: warm recognize ---
const WARM_ROUNDS = 5;
const warmRuns: number[] = [];
for (let round = 0; round < WARM_ROUNDS; round++) {
  for (const img of images) {
    const start = performance.now();
    await service.recognize(img, { noCache: true });
    warmRuns.push(performance.now() - start);
  }
}

const avg = warmRuns.reduce((a, b) => a + b, 0) / warmRuns.length;
const sorted = [...warmRuns].sort((a, b) => a - b);
const min = sorted[0]!;
const median = sorted[Math.floor(sorted.length / 2)]!;
const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
const max = sorted[sorted.length - 1]!;

console.log(
  `warm recognize() (${warmRuns.length} runs): min=${min.toFixed(1)} avg=${avg.toFixed(1)} median=${median.toFixed(1)} p95=${p95.toFixed(1)} max=${max.toFixed(1)} ms`,
);

const totalMs = initMs + firstMs + warmRuns.reduce((a, b) => a + b, 0);
console.log(`total wall-clock: ${totalMs.toFixed(1)} ms`);
console.log(
  `individual runs: [${warmRuns.map((r) => r.toFixed(1)).join(", ")}]`,
);

await service.destroy();
