import { bench, run, summary } from "mitata";
import { PaddleOcrService } from "../src";
import type { RecognitionStrategy } from "../src/interface.js";
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

// --- Benchmarks ---

type ServiceMap = Record<RecognitionStrategy, PaddleOcrService>;

function buildServices(engine: "opencv" | "canvas-native"): ServiceMap {
  const map: Partial<ServiceMap> = {};
  for (const strategy of strategies) {
    map[strategy] = new PaddleOcrService({
      processing: { engine },
      recognition: { strategy, charactersDictionary: [] as string[] },
    });
  }
  return map as ServiceMap;
}

const openCVServices = buildServices("opencv");
for (const strategy of strategies) await openCVServices[strategy].initialize();

const canvasNativeServices = buildServices("canvas-native");
for (const strategy of strategies) await canvasNativeServices[strategy].initialize();

// Summary 1: opencv (all strategies)
summary(() => {
  for (const strategy of strategies) {
    bench(`[${strategy}][opencv][noCache]`, async () => {
      await openCVServices[strategy].recognize(fileBuffer, { noCache: true });
    });
  }
})

// Summary 2: canvas-native (all strategies)
summary(() => {
  for (const strategy of strategies) {
    bench(`[${strategy}][canvas-native][noCache]`, async () => {
      await canvasNativeServices[strategy].recognize(fileBuffer, { noCache: true });
    });
  }
})

await run();

for (const strategy of strategies) await openCVServices[strategy].destroy();
for (const strategy of strategies) await canvasNativeServices[strategy].destroy();


{

  // --- Accuracy measurement ---

console.log(`\n=== Accuracy on ${imgFile.name} ===`);
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
}}
