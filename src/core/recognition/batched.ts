// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { CoreCanvas } from "../platform.js";
import type { RecognitionContext } from "./strategies.js";
import { decodeLogitsRow } from "./ctc.js";
import { preprocessImage } from "./image-tensor.js";

/**
 * Recognizes many crops with width-bucketed batched inference: crops are
 * sorted by width, chunked into `recBatchSize` groups, right-padded to each
 * chunk's max width, and stacked into one `[N, 3, H, W]` tensor per chunk -
 * one `session.run` per chunk instead of per crop. Results come back in the
 * caller's original crop order.
 *
 * Falls back to per-crop tensors when the loaded model's batch dimension is
 * fixed (`recBatchSize` is treated as 1 then by the caller) - padding is
 * tensor-space zeros, matching upstream PaddleOCR's `padding_im`.
 */
export async function recognizeCropsBatched(
  crops: CoreCanvas[],
  ctx: RecognitionContext,
  charactersDictionary?: string[]
): Promise<Array<{ text: string; confidence: number; positions: number[] }>> {
  const targetHeight = ctx.options.imageHeight ?? 48;
  const batchSize = Math.max(1, ctx.options.recBatchSize ?? 6);
  const dict = charactersDictionary ?? ctx.options.charactersDictionary ?? [];
  const spaceRecovery = ctx.options.spaceRecovery ?? false;
  const imageProcessor = ctx.engine === "opencv" ? ctx.platform.imageProcessor : undefined;

  const prepped = await Promise.all(
    crops.map((crop) =>
      preprocessImage(
        crop,
        targetHeight,
        imageProcessor,
        ctx.platform.canvas.createProcessor.bind(ctx.platform.canvas)
      )
    )
  );

  // Width-sorted chunks minimize padding waste inside each batch.
  const order = prepped
    .map((_, i) => i)
    .sort((a, b) => {
      const wa = prepped[a]?.tensorWidth ?? 0;
      const wb = prepped[b]?.tensorWidth ?? 0;
      return wa - wb;
    });

  const results: Array<{ text: string; confidence: number; positions: number[] }> = Array.from({
    length: crops.length,
  });

  for (let start = 0; start < order.length; start += batchSize) {
    const chunk = order.slice(start, start + batchSize);
    const maxWidth = Math.max(...chunk.map((i) => prepped[i]?.tensorWidth ?? 1));
    const channelSize = targetHeight * maxWidth;
    const stacked = new Float32Array(chunk.length * 3 * channelSize);

    chunk.forEach((cropIndex, row) => {
      const p = prepped[cropIndex];
      if (!p) return;
      const rowBase = row * 3 * channelSize;
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < targetHeight; y++) {
          const src = (c * targetHeight + y) * p.tensorWidth;
          const dst = rowBase + (c * targetHeight + y) * maxWidth;
          stacked.set(p.imageTensor.subarray(src, src + p.tensorWidth), dst);
          // Replicate the crop's right edge into the padding instead of
          // leaving tensor-zero gray: convolution receptive fields bleed a
          // few columns past the boundary, and a hard edge there perturbs
          // the last characters of short crops.
          const edge = p.imageTensor[src + p.tensorWidth - 1] ?? 0;
          stacked.fill(edge, dst + p.tensorWidth, dst + maxWidth);
        }
      }
    });

    let inputTensor;
    try {
      inputTensor = new ctx.platform.ort.Tensor("float32", stacked, [
        chunk.length,
        3,
        targetHeight,
        maxWidth,
      ]);
      const output = await ctx.runInference(inputTensor);
      const [, seqLen, numClasses] = output.dims;
      const data = output.data as Float32Array;
      const rowSize = (seqLen ?? 0) * (numClasses ?? 0);
      chunk.forEach((cropIndex, row) => {
        // The output sequence spans the padded width; timesteps past the
        // crop's own width cover padding only and decode as hallucinated
        // trailing characters (and skew position-based line splitting).
        // Truncate to the crop's share of the sequence before decoding.
        const widthShare = (prepped[cropIndex]?.tensorWidth ?? maxWidth) / maxWidth;
        const validSeq = Math.max(1, Math.min(seqLen ?? 0, Math.ceil((seqLen ?? 0) * widthShare)));
        results[cropIndex] = decodeLogitsRow(
          data.subarray(row * rowSize, row * rowSize + validSeq * (numClasses ?? 0)),
          validSeq,
          numClasses ?? 0,
          dict,
          spaceRecovery
        );
      });
    } finally {
      inputTensor?.dispose();
    }
  }

  return results;
}

/**
 * True when the loaded recognition session accepts a dynamic batch dimension.
 * Fixed-batch models (some custom exports) must stay on the per-crop path.
 */
export function supportsDynamicBatch(session: { inputMetadata?: unknown }): boolean {
  const meta = session.inputMetadata as
    | ReadonlyArray<{ shape?: ReadonlyArray<number | string> }>
    | undefined;
  const dim = meta?.[0]?.shape?.[0];
  return typeof dim !== "number" || dim < 0;
}
