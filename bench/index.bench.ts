import { bench, run, summary } from "mitata";
import { PaddleOcrService } from "../src";
import type { ProcessingEngine, RecognitionStrategy } from "../src/interface.js";
import { levenshteinDistance } from "../src/utils.js";

const strategies: RecognitionStrategy[] = ["per-box", "per-line", "cross-line"];
const engines = ["opencv", "canvas-native"] as const;

const imgFile = Bun.file(`${import.meta.dir}/../assets/receipt.jpg`);
const gtFile = Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`);
const fileBuffer = await imgFile.arrayBuffer();
const groundTruth = (await gtFile.text()).trim();

function measureAccuracy(ocrText: string) {
  const dist = levenshteinDistance(ocrText.trim(), groundTruth);
  const accuracy =
    groundTruth.length > 0 ? ((groundTruth.length - dist) / groundTruth.length) * 100 : 0;
  return { dist, accuracy };
}

// --- Accuracy measurement ---

console.log("\n=== Accuracy (Levenshtein distance vs ground truth) ===");
console.log(`  ground truth length: ${groundTruth.length} chars\n`);

for (const engine of engines) {
  console.log(`  [${engine}]`);
  for (const strategy of strategies) {
    const service = new PaddleOcrService({
      processing: { engine },
      recognition: { strategy, charactersDictionary: [] as string[] },
    });
    await service.initialize();
    const result = await service.recognize(fileBuffer, { noCache: true });
    const { dist, accuracy } = measureAccuracy(result.text);
    console.log(`    ${strategy.padEnd(14)} accuracy=${accuracy.toFixed(2)}%  dist=${dist}`);
    await service.destroy();
  }
  console.log();
}

// --- Benchmarks ---

const allServices: PaddleOcrService[] = [];

async function makeService(engine: ProcessingEngine, strategy: RecognitionStrategy) {
  const s = new PaddleOcrService({
    processing: { engine },
    recognition: { strategy, charactersDictionary: [] as string[] },
  });
  await s.initialize();
  await s.recognize(fileBuffer, { noCache: true });
  allServices.push(s);
  return s;
}

// Summary 1: opencv (all strategies)
{
  const svcs = await Promise.all(strategies.map((s) => makeService("opencv", s)));
  summary(() => {
    for (let i = 0; i < strategies.length; i++) {
      bench(`[${strategies[i]}][opencv][noCache]`, async () => {
        await svcs[i]?.recognize(fileBuffer, { noCache: true });
      });
    }
  });
}

// Summary 2: canvas-native (all strategies)
{
  const svcs = await Promise.all(strategies.map((s) => makeService("canvas-native", s)));
  summary(() => {
    for (let i = 0; i < strategies.length; i++) {
      bench(`[${strategies[i]}][canvas-native][noCache]`, async () => {
        await svcs[i]?.recognize(fileBuffer, { noCache: true });
      });
    }
  });
}

await run();

for (const s of allServices) {
  await s.destroy();
}
