// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * PP-OCRv5 vs PP-OCRv6 small vs PP-OCRv6 tiny comparison example.
 *
 * Run with:
 *   bun examples/index.ts
 *
 * On a cold cache the models are downloaded once and stored in
 * ~/.cache/ppu-paddle-ocr. Subsequent runs read from disk.
 */

import type { ModelUrls } from "../src";
import { PaddleOcrService, V5_EN_MOBILE_MODEL, V6_SMALL_MODEL, V6_TINY_MODEL } from "../src";

const imagePath = `${import.meta.dir}/../assets/receipt.jpg`;
const imgFile = Bun.file(imagePath);
const fileBuffer = await imgFile.arrayBuffer();

async function runOcr(
  label: string,
  modelUrls: ModelUrls
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

const v6Small = await runOcr("PP-OCRv6 small (default)", V6_SMALL_MODEL);
const v6Tiny = await runOcr("PP-OCRv6 tiny", V6_TINY_MODEL);
const v5 = await runOcr("PP-OCRv5 English mobile (legacy)", V5_EN_MOBILE_MODEL);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n=== Comparison ===");
console.log("Model              | Confidence |  Time  | vs v6-small");
console.log("-------------------|------------|--------|-------------");

function row(
  label: string,
  r: { confidence: number; timeMs: number },
  base: { confidence: number; timeMs: number }
): void {
  const conf = `${(r.confidence * 100).toFixed(2)}%`.padEnd(10);
  const time = `${r.timeMs} ms`.padEnd(6);
  const dConf = ((r.confidence - base.confidence) * 100).toFixed(2);
  const dTime = r.timeMs - base.timeMs;
  const sign = (n: number): string => (n >= 0 ? "+" : "");
  const delta = `${sign(parseFloat(dConf))}${dConf}pp / ${sign(dTime)}${dTime}ms`;
  console.log(`${label.padEnd(19)}| ${conf} | ${time} | ${delta}`);
}

row("v6 small", v6Small, v6Small);
row("v6 tiny", v6Tiny, v6Small);
row("v5 mobile EN", v5, v6Small);
