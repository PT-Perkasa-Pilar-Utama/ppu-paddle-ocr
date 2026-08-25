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
 * Cache path for `url`: the file name under a directory named after a digest
 * of the whole URL.
 *
 * The digest is what keeps two resources that share a file name apart. Model
 * file names repeat across hosts and directories, so keying on the name alone
 * would serve one URL's bytes for another's request - a custom model shadowed
 * by a preset, or a host swap that silently keeps reading the old host's copy.
 */
export function cachePathFor(url: string): string {
  const fileName = path.basename(new URL(url).pathname);
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return path.join(CACHE_DIR, digest, fileName);
}

/**
 * Downloads a resource from `url` and writes it to {@link CACHE_DIR}, or reads
 * from the cache if the file already exists.
 */
export async function fetchAndCacheResource(url: string, verbose?: boolean): Promise<ArrayBuffer> {
  const fileName = path.basename(new URL(url).pathname);
  const cachePath = cachePathFor(url);

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

  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, Buffer.from(arrayBuffer));

  return arrayBuffer;
}
