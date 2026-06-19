// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * PP-OCRv5 vs PP-OCRv6 comparison example.
 *
 * Run with:
 *   bun examples/index.ts
 *
 * On a cold cache the v6 models are downloaded once and stored in
 * ~/.cache/ppu-paddle-ocr. Subsequent runs read from disk.
 */

import { PaddleOcrService, PP_OCRV5_MODEL_URLS, PP_OCRV6_MODEL_URLS } from "../src";

const imagePath = `${import.meta.dir}/../assets/receipt.jpg`;
const imgFile = Bun.file(imagePath);
const fileBuffer = await imgFile.arrayBuffer();

// ── PP-OCRv6 small (default since v6.0.0) ────────────────────────────────────

console.log("=== PP-OCRv6 small (default) ===");

const v6Service = new PaddleOcrService({
  model: PP_OCRV6_MODEL_URLS,
  debugging: { verbose: true },
});

await v6Service.initialize();

const v6Start = Date.now();
const v6Result = await v6Service.recognize(fileBuffer);
const v6Time = Date.now() - v6Start;

await v6Service.destroy();

console.log(v6Result.text);
console.log(`Confidence: ${(v6Result.confidence * 100).toFixed(1)}%`);
console.log(`Time: ${v6Time} ms\n`);

// ── PP-OCRv5 English mobile (previous default) ────────────────────────────────

console.log("=== PP-OCRv5 English mobile (legacy) ===");

const v5Service = new PaddleOcrService({
  model: PP_OCRV5_MODEL_URLS,
  debugging: { verbose: true },
});

await v5Service.initialize();

const v5Start = Date.now();
const v5Result = await v5Service.recognize(fileBuffer);
const v5Time = Date.now() - v5Start;

await v5Service.destroy();

console.log(v5Result.text);
console.log(`Confidence: ${(v5Result.confidence * 100).toFixed(1)}%`);
console.log(`Time: ${v5Time} ms\n`);

// ── Summary ───────────────────────────────────────────────────────────────────

const timeDiff = v5Time - v6Time;
const confDiff = (v6Result.confidence - v5Result.confidence) * 100;

console.log("=== Comparison ===");
console.log(`v6 confidence: ${(v6Result.confidence * 100).toFixed(2)}%`);
console.log(`v5 confidence: ${(v5Result.confidence * 100).toFixed(2)}%`);
console.log(`Confidence delta: ${confDiff >= 0 ? "+" : ""}${confDiff.toFixed(2)}pp (v6 vs v5)`);
console.log(`v6 time: ${v6Time} ms  |  v5 time: ${v5Time} ms`);
console.log(
  `Speed delta: ${timeDiff >= 0 ? "v6 faster by" : "v5 faster by"} ${Math.abs(timeDiff)} ms`
);
