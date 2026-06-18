// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";

import { fetchArrayBufferWithRetry } from "../utils.js";

/** On-disk directory for cached model and dictionary files. */
export const CACHE_DIR: string = path.join(os.homedir(), ".cache", "ppu-paddle-ocr");

/**
 * Returns a deterministic cache filename for a remote resource.
 *
 * Some official model repos publish generic names such as `inference.onnx`;
 * including a short hash of the full URL avoids collisions while keeping the
 * original filename readable for humans inspecting the cache directory.
 */
export function getCachedResourceFileName(url: string): string {
  const parsed = new URL(url);
  const fileName = path.basename(parsed.pathname);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return `${hash}-${fileName}`;
}

/**
 * Downloads a resource from `url` and writes it to {@link CACHE_DIR}, or reads
 * from the cache if the file already exists.
 */
export async function fetchAndCacheResource(url: string, verbose?: boolean): Promise<ArrayBuffer> {
  const fileName = getCachedResourceFileName(url);
  const cachePath = path.join(CACHE_DIR, fileName);

  if (existsSync(cachePath)) {
    if (verbose) console.log(`[PaddleOcrService] Loading cached resource from: ${cachePath}`);
    const buf = readFileSync(cachePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  console.log(
    `[PaddleOcrService] Downloading resource: ${fileName}\n` +
      `                 Cached at: ${CACHE_DIR}`
  );
  if (verbose) console.log(`[PaddleOcrService] Fetching resource from URL: ${url}`);

  const arrayBuffer = await fetchArrayBufferWithRetry(url);

  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  writeFileSync(cachePath, Buffer.from(arrayBuffer));

  return arrayBuffer;
}
