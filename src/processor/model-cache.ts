// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";

/** On-disk directory for cached model and dictionary files. */
export const CACHE_DIR: string = path.join(os.homedir(), ".cache", "ppu-paddle-ocr");

/**
 * Downloads a resource from `url` and writes it to {@link CACHE_DIR}, or reads
 * from the cache if the file already exists.
 */
export async function fetchAndCacheResource(url: string, verbose?: boolean): Promise<ArrayBuffer> {
  const fileName = path.basename(new URL(url).pathname);
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

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch resource from ${url}`);
  }
  if (!response.body) {
    throw new Error("Response body is null or undefined");
  }

  const contentLength = response.headers.get("Content-Length");
  const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
  let receivedLength = 0;
  const chunks: Uint8Array[] = [];

  const reader = response.body.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    receivedLength += value.length;

    if (totalLength > 0) {
      const percentage = ((receivedLength / totalLength) * 100).toFixed(2);
      process.stdout.write(`\rDownloading... ${percentage}%`);
    }
  }
  process.stdout.write("\n");

  const buffer = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, position);
    position += chunk.length;
  }

  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  writeFileSync(cachePath, Buffer.from(buffer));

  return buffer.buffer;
}
