// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * PP-OCRv5 vs PP-OCRv6 small comparison example.
 *
 * Run with:
 *   bun examples/index.ts
 *
 * On a cold cache the v6 models are downloaded once and stored in
 * ~/.cache/ppu-paddle-ocr. Subsequent runs read from disk.
 *
 * NOTE: PP-OCRv6 tiny uses a different, smaller dictionary (6906 classes)
 * than the small/medium models (18710 classes). A dedicated tiny dict is
 * required before it can be benchmarked correctly.
 */

import { PaddleOcrService, PP_OCRV5_MODEL_URLS, PP_OCRV6_MODEL_URLS } from "../src";

const imagePath = `${import.meta.dir}/../assets/receipt.jpg`;
const imgFile = Bun.file(imagePath);
const fileBuffer = await imgFile.arrayBuffer();

async function runOcr(
  label: string,
  modelUrls: typeof PP_OCRV6_MODEL_URLS
): Promise<{ text: string; confidence: number; timeMs: number }> {
  console.log(`\n=== ${label} ===`);
  const svc = new PaddleOcrService({ model: modelUrls, debugging: { verbose: true } });
  await svc.initialize();
  const t0 = Date.now();
  const result = await svc.recognize(fileBuffer, { noCache: true });
  const timeMs = Date.now() - t0;
  await svc.destroy();
  console.log(result.text);
  console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`Time: ${timeMs} ms`);
  return { text: result.text, confidence: result.confidence, timeMs };
}

const v6 = await runOcr("PP-OCRv6 small (default)", PP_OCRV6_MODEL_URLS);
const v5 = await runOcr("PP-OCRv5 English mobile (legacy)", PP_OCRV5_MODEL_URLS);

// ── Summary ───────────────────────────────────────────────────────────────────

const timeDiff = v5.timeMs - v6.timeMs;
const confDiff = (v6.confidence - v5.confidence) * 100;

console.log("\n=== Comparison ===");
console.log(`v6 confidence: ${(v6.confidence * 100).toFixed(2)}%`);
console.log(`v5 confidence: ${(v5.confidence * 100).toFixed(2)}%`);
console.log(`Confidence delta: ${confDiff >= 0 ? "+" : ""}${confDiff.toFixed(2)}pp (v6 vs v5)`);
console.log(`v6 time: ${v6.timeMs} ms  |  v5 time: ${v5.timeMs} ms`);
console.log(
  `Speed delta: ${timeDiff >= 0 ? "v6 faster by" : "v5 faster by"} ${Math.abs(timeDiff)} ms`
);
