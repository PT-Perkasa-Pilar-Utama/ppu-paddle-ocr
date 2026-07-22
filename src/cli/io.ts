// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Cross-runtime IO helpers for the CLI. Deliberately free of `Bun.*` globals so
 * the published `bin` runs under plain `node` (via `npx`) as well as Bun.
 */

import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A non-zero-exit error carrying the intended process exit code. */
export class CliError extends Error {
  public readonly code: number;
  public constructor(message: string, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

/** Throw a usage error (exit code 2). */
export function usageError(message: string): never {
  throw new CliError(message, 2);
}

const HTTP = /^https?:\/\//i;
const GLOB_MAGIC = /[*?[\]{}]/;

/**
 * Resolve a CLI image argument to an `ArrayBuffer`. The Node `recognize()`
 * accepts only `ArrayBuffer`/`Canvas`, so URLs are fetched here and files read
 * from disk - which also sidesteps the SDK's absolute-path-only string rule.
 */
export async function loadImageInput(arg: string): Promise<ArrayBuffer> {
  if (HTTP.test(arg)) {
    const res = await fetch(arg);
    if (!res.ok) throw new CliError(`Failed to fetch ${arg}: ${res.status} ${res.statusText}`);
    return res.arrayBuffer();
  }
  if (!existsSync(arg)) throw new CliError(`No such file: ${arg}`);
  const buf = readFileSync(arg);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** True if a non-URL path is missing on disk. URLs are assumed reachable. */
export function isMissingLocalFile(arg: string): boolean {
  return !HTTP.test(arg) && !existsSync(arg);
}

/**
 * Expand positional patterns into a concrete list. Glob patterns are resolved
 * against the filesystem; plain paths and URLs pass through verbatim so a typo
 * surfaces as a clear "No such file" later instead of silently vanishing.
 */
export function expandPatterns(patterns: string[]): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    if (HTTP.test(pattern) || !GLOB_MAGIC.test(pattern)) {
      out.push(pattern);
      continue;
    }
    const matches = globSync(pattern).sort();
    if (matches.length === 0) throw new CliError(`No files match: ${pattern}`);
    out.push(...matches);
  }
  return out;
}

/** Walk up from this module to the nearest `ppu-paddle-ocr` package.json. */
export function readVersion(): string {
  let dir = import.meta.dirname;
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "ppu-paddle-ocr" && pkg.version) return pkg.version;
      } catch {
        // keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return "0.0.0";
    dir = parent;
  }
}

/** Write `content` to a file (with trailing newline) or to stdout. */
export function writeOutput(content: string, outputPath?: string): void {
  if (outputPath) {
    writeFileSync(outputPath, content.endsWith("\n") ? content : `${content}\n`);
    return;
  }
  process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
}

/** Log a line to stderr unless quiet. */
export function logStderr(message: string, quiet: boolean): void {
  if (!quiet) process.stderr.write(`${message}\n`);
}
