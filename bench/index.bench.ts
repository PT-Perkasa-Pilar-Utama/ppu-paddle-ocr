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

const openCVService = new PaddleOcrService({
  processing: { engine: "opencv" },
  recognition: { charactersDictionary: [] as string[] },
});
await openCVService.initialize();

const canvasNativeService = new PaddleOcrService({
  processing: { engine: "canvas-native" },
  recognition: { charactersDictionary: [] as string[] },
});
await canvasNativeService.initialize();

// Summary 1: opencv (all strategies)
summary(() => {
  for (const strategy of strategies) {
    bench(`[${strategy}][opencv][noCache]`, async () => {
      await openCVService.recognize(fileBuffer, { noCache: true, strategy });
    });
  }
});

// Summary 2: canvas-native (all strategies)
summary(() => {
  for (const strategy of strategies) {
    bench(`[${strategy}][canvas-native][noCache]`, async () => {
      await canvasNativeService.recognize(fileBuffer, { noCache: true, strategy });
    });
  }
});

await run();

await openCVService.destroy();
await canvasNativeService.destroy();

{
  // --- Accuracy measurement ---

  console.log(`\n=== Accuracy on ${imgFile.name} ===`);
  console.log(`  ground truth length: ${groundTruth.length} chars\n`);

  for (const engine of engines) {
    const service = new PaddleOcrService({
      processing: { engine },
      recognition: { charactersDictionary: [] as string[] },
    });
    await service.initialize();
    console.log(`  [${engine}]`);
    for (const strategy of strategies) {
      const result = await service.recognize(fileBuffer, { noCache: true, strategy });
      const { dist, accuracy } = measureAccuracy(result.text);
      console.log(`    ${strategy.padEnd(14)} accuracy=${accuracy.toFixed(2)}%  dist=${dist}`);
    }
    await service.destroy();
    console.log();
  }
}
