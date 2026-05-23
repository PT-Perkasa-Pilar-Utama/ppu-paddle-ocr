import { performance } from "node:perf_hooks";
import { PaddleOcrService } from "../src";

const imgFile = Bun.file(`${import.meta.dir}/../assets/receipt.jpg`);
const imageBuffer = await imgFile.arrayBuffer();

// Also load the private test image if available
let privateImageBuffer: ArrayBuffer | null = null;
try {
  const privateImg = Bun.file(`${import.meta.dir}/../private-tests/private-test-1.png`);
  privateImageBuffer = await privateImg.arrayBuffer();
} catch {
  // ignore if not available
}

const images = [imageBuffer];
if (privateImageBuffer) images.push(privateImageBuffer);

console.log(`Images: ${images.length} (receipt${privateImageBuffer ? " + private-test-1" : ""})\n`);

for (const engine of ["opencv", "canvas-native"] as const) {
  console.log(`=== Engine: ${engine} ===`);

  const service = new PaddleOcrService({
    processing: { engine },
  });

  const t0 = performance.now();
  await service.initialize();
  const initMs = performance.now() - t0;
  console.log(`  initialize(): ${initMs.toFixed(1)} ms`);

  // First call (cold)
  const t1 = performance.now();
  await service.recognize(images[0] ?? new ArrayBuffer(0), { noCache: true });
  const firstMs = performance.now() - t1;
  console.log(`  first recognize(): ${firstMs.toFixed(1)} ms`);

  // Subsequent calls (warm)
  const warmRuns: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (const img of images) {
      const start = performance.now();
      await service.recognize(img, { noCache: true });
      warmRuns.push(performance.now() - start);
    }
  }

  const avg = warmRuns.reduce((a, b) => a + b, 0) / warmRuns.length;
  const sorted = [...warmRuns].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

  console.log(
    `  warm recognize() (${warmRuns.length} runs): avg=${avg.toFixed(1)} ms, median=${median.toFixed(1)} ms, p95=${p95.toFixed(1)} ms`
  );
  console.log(
    `  total wall-clock: ${(initMs + firstMs + warmRuns.reduce((a, b) => a + b, 0)).toFixed(1)} ms\n`
  );

  await service.destroy();
}
