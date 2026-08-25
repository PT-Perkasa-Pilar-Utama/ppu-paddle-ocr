// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { Box, DetectOptions } from "../../interface.js";
import type { CoreCanvas, PlatformProvider } from "../platform.js";

/**
 * Crop each detected box out of the source canvas, optionally saving each
 * crop as `crop_NNN.png` under `options.saveCropsTo` (platforms with a
 * filesystem only) and/or collecting PNG-encoded buffers when `options.crop`.
 *
 * @returns PNG buffers index-aligned with `boxes` (empty when `crop` is unset).
 */
export async function cropDetectedBoxes(
  platform: PlatformProvider,
  canvas: CoreCanvas,
  boxes: Box[],
  options: DetectOptions
): Promise<ArrayBuffer[]> {
  const toolkit = platform.canvas.getToolkit();
  const crops: ArrayBuffer[] = [];

  for (const [index, box] of boxes.entries()) {
    const cropCanvas = toolkit.crop({
      bbox: { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height },
      canvas,
    });

    if (options.saveCropsTo && platform.saveImage) {
      const filename = `crop_${String(index).padStart(3, "0")}.png`;
      await platform.saveImage(
        cropCanvas,
        [options.saveCropsTo, filename].join(platform.pathSeparator)
      );
    }
    if (options.crop) {
      crops.push(await canvasToPngBuffer(cropCanvas));
    }
  }

  return crops;
}

/**
 * Encode a platform canvas to a PNG `ArrayBuffer`.
 *
 * Supports `@napi-rs/canvas` (`toBuffer`), `OffscreenCanvas` (`convertToBlob`),
 * and `HTMLCanvasElement` (`toBlob`). Throws on canvases with no encoder
 * (e.g. the React Native Skia canvas).
 */
async function canvasToPngBuffer(canvas: CoreCanvas): Promise<ArrayBuffer> {
  // SAFETY: the two canvas encoders are probed, not assumed - both members are
  // optional here and tested before use.
  const c = canvas as unknown as {
    toBuffer?: (format: string) => Buffer;
    convertToBlob?: (options?: { type?: string }) => Promise<Blob>;
    toBlob?: (callback: (blob: Blob | null) => void, type?: string) => void;
  };

  if (typeof c.toBuffer === "function") {
    const buffer = c.toBuffer("image/png");
    // SAFETY: slice() on a Buffer's backing store returns an ArrayBuffer, never
    // the SharedArrayBuffer arm of the union.
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
  }
  if (typeof c.convertToBlob === "function") {
    const blob = await c.convertToBlob({ type: "image/png" });
    return blob.arrayBuffer();
  }
  if (typeof c.toBlob === "function") {
    const toBlob = c.toBlob.bind(c);
    const blob = await new Promise<Blob>((resolve, reject) =>
      toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob() returned null"))),
        "image/png"
      )
    );
    return blob.arrayBuffer();
  }
  throw new Error("Canvas cannot be encoded to a PNG buffer on this platform");
}
