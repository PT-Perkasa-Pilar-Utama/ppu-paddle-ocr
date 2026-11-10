// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { CoreCanvas, PlatformProvider } from "./platform.js";

/** An image as the public API accepts it: encoded bytes, a canvas, or a URL/absolute path. */
export type ImageSource = ArrayBuffer | CoreCanvas | string;

const IMAGE_SOURCE_ERROR =
  "Invalid image string format. Must be an HTTP URL, an absolute path, ArrayBuffer, or Canvas";

/** Fetch or read the bytes behind a URL or absolute path. */
async function loadImageString(platform: PlatformProvider, image: string): Promise<ArrayBuffer> {
  if (!image.startsWith("http") && !image.startsWith("/")) {
    throw new Error(IMAGE_SOURCE_ERROR);
  }
  return platform.loadResource(image, image);
}

/**
 * The bytes that identify an image for caching: the encoded file for a path,
 * URL, or buffer, and the pixels (PNG-encoded where the canvas can do that)
 * for a canvas.
 */
export async function readImageBytes(
  platform: PlatformProvider,
  image: ImageSource
): Promise<ArrayBuffer> {
  if (typeof image === "string") return loadImageString(platform, image);
  if (image instanceof ArrayBuffer) return image;

  // SAFETY: this branch is the fall-through for values that are neither a
  // path nor an ArrayBuffer, so `image` is a canvas from one of the
  // supported runtimes. The typeof probe below is what establishes which.
  if (typeof (image as unknown as Record<string, unknown>).toBuffer === "function") {
    // SAFETY: guarded by the toBuffer probe above (the node-canvas shape).
    const canvasWithBuffer = image as { toBuffer: (format: string) => Buffer };
    const buffer = canvasWithBuffer.toBuffer("image/png");
    // SAFETY: slice() on a Buffer's ArrayBuffer returns an ArrayBuffer;
    // the cast only discards the SharedArrayBuffer arm of the union,
    // which node-canvas never produces.
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
  }

  // SAFETY: the remaining canvas shape, reached only when toBuffer is
  // absent; getContext("2d") below throws if the value is not a canvas.
  const canvasWithCtx = image as {
    getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
    width: number;
    height: number;
  };
  const ctx = canvasWithCtx.getContext("2d", {
    willReadFrequently: true,
  });
  const imageData = ctx.getImageData(0, 0, canvasWithCtx.width, canvasWithCtx.height);
  const data = imageData.data;
  // SAFETY: as above, ImageData is always backed by an ArrayBuffer.
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Decode an image source into a platform canvas. */
export async function toCanvas(
  platform: PlatformProvider,
  image: ImageSource
): Promise<CoreCanvas> {
  if (typeof image === "string") {
    return platform.canvas.prepareCanvas(await loadImageString(platform, image));
  }
  if (image instanceof ArrayBuffer) return platform.canvas.prepareCanvas(image);
  return image;
}
