// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * PP-OCRv6 tiny (default) vs PP-OCRv6 small vs PP-OCRv5 comparison example.
 *
 * Run with:
 *   bun examples/index.ts
 *
 * Accuracy is measured against assets/receipt-ground-truth.txt (Levenshtein).
 * The confidence column is each model's self-reported score - models are
 * calibrated differently, so confidence is NOT comparable across models and
 * does not track accuracy (tiny reads this receipt more accurately than
 * small while self-scoring lower).
 *
 * On a cold cache the models are downloaded once and stored in
 * ~/.cache/ppu-paddle-ocr. Subsequent runs read from disk.
 */

import type { ModelUrls } from "../src";
import { PaddleOcrService, V5_EN_MOBILE_MODEL, V6_SMALL_MODEL, V6_TINY_MODEL } from "../src";
import { levenshteinDistance } from "../src/utils.js";

const imagePath = `${import.meta.dir}/../assets/receipt.jpg`;
const fileBuffer = await Bun.file(imagePath).arrayBuffer();
const groundTruth = (
  await Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`).text()
).trim();

type RunResult = { accuracy: number; confidence: number; timeMs: number };

async function runOcr(label: string, modelUrls: ModelUrls): Promise<RunResult> {
  console.log(`\n=== ${label} ===`);
  const svc = new PaddleOcrService({ model: modelUrls, debugging: { verbose: true } });
  await svc.initialize();
  const t0 = Date.now();
  const result = await svc.recognize(fileBuffer, { noCache: true });
  const timeMs = Date.now() - t0;
  await svc.destroy();

  const dist = levenshteinDistance(result.text.trim(), groundTruth);
  const accuracy = (groundTruth.length - dist) / groundTruth.length;

  console.log(result.text);
  console.log(`Accuracy vs ground truth: ${(accuracy * 100).toFixed(2)}% (distance ${dist})`);
  console.log(`Self-reported confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`Time: ${timeMs} ms`);
  return { accuracy, confidence: result.confidence, timeMs };
}

const v6Tiny = await runOcr("PP-OCRv6 tiny (default)", V6_TINY_MODEL);
const v6Small = await runOcr("PP-OCRv6 small (full dictionary)", V6_SMALL_MODEL);
const v5 = await runOcr("PP-OCRv5 English mobile (legacy)", V5_EN_MOBILE_MODEL);

// --- Summary -----------------------------------------------------------------

console.log("\n=== Comparison (accuracy is vs ground truth; confidence is self-reported) ===");
console.log("Model              | Accuracy | Confidence |  Time  | vs tiny defaults");
console.log("-------------------|----------|------------|--------|------------------");

function row(label: string, r: RunResult, base: RunResult): void {
  const acc = `${(r.accuracy * 100).toFixed(2)}%`.padEnd(8);
  const conf = `${(r.confidence * 100).toFixed(2)}%`.padEnd(10);
  const time = `${r.timeMs} ms`.padEnd(6);
  const dAcc = ((r.accuracy - base.accuracy) * 100).toFixed(2);
  const dTime = r.timeMs - base.timeMs;
  const sign = (n: number): string => (n >= 0 ? "+" : "");
  const delta = `${sign(parseFloat(dAcc))}${dAcc}pp / ${sign(dTime)}${dTime}ms`;
  console.log(`${label.padEnd(19)}| ${acc} | ${conf} | ${time} | ${delta}`);
}

row("v6 tiny (default)", v6Tiny, v6Tiny);
row("v6 small", v6Small, v6Tiny);
row("v5 mobile EN", v5, v6Tiny);
