// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Browser-canvas polyfill so the `ppu-paddle-ocr/web` build can run under the
 * bun/Node test runner. onnxruntime-web's WASM backend already runs there; the
 * only gap is the browser canvas globals that `ppu-ocv/web` expects, backed
 * here by `@napi-rs/canvas` (real pixels, real getImageData).
 *
 * These globals are installed/removed around the web tests rather than at
 * import time: `ppu-ocv`'s NODE path detects `OffscreenCanvas` at runtime to
 * decide browser-vs-node, so leaving the globals set would make the node OCR
 * tests take the browser path. Install in `beforeAll`, remove in `afterAll`,
 * and a serial run keeps the node and web suites cleanly separated.
 */
import { Canvas, createCanvas, ImageData as NapiImageData, loadImage } from "@napi-rs/canvas";

const KEYS = [
  "OffscreenCanvas",
  "HTMLCanvasElement",
  "ImageData",
  "createImageBitmap",
  "document",
] as const;

/** Options for {@link installWebCanvas}. */
export type WebCanvasOptions = {
  /**
   * Install only the globals a Web Worker exposes: `OffscreenCanvas`,
   * `ImageData`, and `createImageBitmap`, leaving `document` and
   * `HTMLCanvasElement` undefined the way a real worker scope does.
   */
  worker?: boolean;
};

export function installWebCanvas(options: WebCanvasOptions = {}): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.OffscreenCanvas = Canvas;
  g.ImageData = NapiImageData;
  g.createImageBitmap = async (blob: Blob) => {
    const buf = Buffer.from(await blob.arrayBuffer());
    const img = (await loadImage(buf)) as unknown as { close: () => void };
    img.close = () => {};
    return img;
  };

  if (options.worker) return;

  g.HTMLCanvasElement = Canvas;
  g.document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return createCanvas(1, 1);
      throw new Error(`document.createElement: only "canvas" is polyfilled (got "${tag}")`);
    },
  };
}

export function uninstallWebCanvas(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of KEYS) delete g[key];
}
