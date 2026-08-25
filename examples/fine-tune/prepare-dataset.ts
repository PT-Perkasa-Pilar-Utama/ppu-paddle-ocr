// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Build a PaddleOCR recognition fine-tuning dataset from one or more images
 * with line-level ground truth.
 *
 * Detects word boxes, recognizes each crop, aligns the reading against your
 * ground-truth text (so labels always come from the ground truth, never from
 * the model), and splits the result 70/15/15 into train/val/test.
 *
 * Run with (defaults to the bundled receipt sample):
 *   bun examples/fine-tune/prepare-dataset.ts
 *   bun examples/fine-tune/prepare-dataset.ts <image> <ground-truth.txt> <out-dir>
 *
 * Ground-truth format: plain text, one printed line per line, transcribed
 * exactly as it appears on the image (case, punctuation, spacing).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PaddleOcrService } from "../../src";
// import { PaddleOcrService } from "ppu-paddle-ocr";

const [imagePath, truthPath, outDir] = [
  resolve(process.argv[2] ?? resolve(import.meta.dir, "../../assets/receipt.jpg")),
  resolve(process.argv[3] ?? resolve(import.meta.dir, "../../assets/receipt-ground-truth.txt")),
  resolve(process.argv[4] ?? resolve(import.meta.dir, "dataset")),
];

const MIN_MATCH_SCORE = 0.7;

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, substitution);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

/**
 * Find the ground-truth span that best matches the model's reading of a crop.
 * Slides windows of similar length across every ground-truth line, then snaps
 * the best window to word boundaries so labels never cut through a word.
 */
function matchGroundTruth(pred: string, gtLines: string[]): { label: string; score: number } {
  let best = { label: "", score: 0 };
  for (const line of gtLines) {
    for (
      let len = Math.max(1, pred.length - 2);
      len <= Math.min(line.length, pred.length + 2);
      len++
    ) {
      for (let start = 0; start + len <= line.length; start++) {
        const window = line.slice(start, start + len);
        const score = 1 - editDistance(pred, window) / Math.max(pred.length, window.length);
        if (score > best.score) {
          // snap to word boundaries
          let s = start;
          let e = start + len;
          while (s > 0 && line[s - 1] !== " " && line[s] !== " ") s--;
          while (e < line.length && line[e] !== " " && line[e - 1] !== " ") e++;
          best = { label: line.slice(s, e).trim(), score };
        }
      }
    }
  }
  return best;
}

type PngSize = { width: number; height: number };

function pngSize(buf: ArrayBuffer): PngSize {
  const view = new DataView(buf);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const gtLines = (await Bun.file(truthPath).text())
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const service = new PaddleOcrService({
  // charactersDictionary is filled in by initialize(); 0 keeps low-confidence
  // reads so the ground-truth matcher decides what to keep, not the model
  recognition: { minimumConfidence: 0, charactersDictionary: [] },
});
await service.initialize();

const image = await Bun.file(imagePath).arrayBuffer();
const detection = await service.detect(image, { crop: true });
console.log(`${detection.boxes.length} boxes detected in ${imagePath}`);

// the service's own recognition pass, run per pre-cropped box (no re-detection)
type Split = "train" | "val" | "test";

type WithRecognitor = { recognitor: Recognitor };

type RecognizedLine = { text: string; confidence: number };

type Recognitor = {
  run(
    image: ArrayBuffer,
    boxes: { x: number; y: number; width: number; height: number }[],
    dictionary: string[] | undefined,
    strategy: "per-box"
  ): Promise<RecognizedLine[]>;
};
// The recognitor is internal; the example reaches past the public API on
// purpose to score crops the same way the library does.
const recognitor = (service as unknown as WithRecognitor).recognitor;

for (const split of ["train", "val", "test"])
  mkdirSync(resolve(outDir, split), { recursive: true });
// `satisfies` would infer never[] from the empty literals and reject the
// pushes below, so the annotation stays.
// oxlint-disable-next-line anti-slop/no-known-value-widening
const lists: Record<Split, string[]> = { train: [], val: [], test: [] };
let kept = 0;
let skipped = 0;

for (let i = 0; i < detection.boxes.length; i++) {
  const crop = detection.crops?.[i];
  if (!crop) {
    skipped++;
    continue;
  }
  const { width, height } = pngSize(crop);
  const results = await recognitor.run(crop, [{ x: 0, y: 0, width, height }], undefined, "per-box");
  const pred: string = results[0]?.text ?? "";
  if (!pred) {
    skipped++;
    continue;
  }

  const { label, score } = matchGroundTruth(pred, gtLines);
  if (score < MIN_MATCH_SCORE) {
    console.log(`skip box ${i}: read "${pred}" — no ground-truth span above ${MIN_MATCH_SCORE}`);
    skipped++;
    continue;
  }

  // deterministic 70/15/15 split
  let bucket: "train" | "val" | "test";
  if (i % 20 < 14) bucket = "train";
  else if (i % 20 < 17) bucket = "val";
  else bucket = "test";

  const filename = `word_${i}.png`;
  writeFileSync(resolve(outDir, bucket, filename), new Uint8Array(crop));
  lists[bucket].push(`${bucket}/${filename}\t${label}`);
  kept++;
}

for (const [split, lines] of Object.entries(lists)) {
  writeFileSync(resolve(outDir, `${split}.txt`), `${lines.join("\n")}\n`);
  console.log(`${split}: ${lines.length} samples`);
}
console.log(`kept ${kept}, skipped ${skipped} -> ${outDir}`);

await service.destroy();
