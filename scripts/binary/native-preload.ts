// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { dlopen } from "bun:ffi";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Makes onnxruntime-node's native binding loadable inside a `bun build
 * --compile` executable.
 *
 * Bun embeds the `.node` binding and extracts it to a temp file at runtime,
 * but the binding references its shared library by install name
 * (`@rpath/libonnxruntime.1.dylib` on macOS, `libonnxruntime.so.1` soname on
 * Linux, `onnxruntime.dll` on Windows) and the loader cannot find it next to
 * the extracted file. The fix: extract the embedded shared libraries to a
 * real directory ourselves and dlopen the main one first - every platform
 * loader resolves an already-loaded library by name before searching disk.
 *
 * @param embedded - Library file name to embedded path (`with type "file"` import).
 * @param mainLib - The library to preload (the one the binding links against).
 * @param cacheKey - Version + target discriminator for the extraction dir, so
 * upgrades never reuse a stale extraction.
 */
export async function preloadOnnxRuntime(
  embedded: Record<string, string>,
  mainLib: string,
  cacheKey: string
): Promise<void> {
  const dir = join(tmpdir(), `ppu-paddle-ocr-native-${cacheKey}`);
  mkdirSync(dir, { recursive: true });

  for (const [name, source] of Object.entries(embedded)) {
    const dest = join(dir, name);
    const file = Bun.file(source);
    if (existsSync(dest) && statSync(dest).size === file.size) continue;

    // Write-then-rename so a crashed or concurrent run never leaves a
    // truncated library behind. Windows throws when renaming onto an
    // existing file; if a racing process already produced dest, that's fine.
    const tmp = `${dest}.${process.pid}.tmp`;
    await Bun.write(tmp, file);
    try {
      renameSync(tmp, dest);
    } catch (err) {
      rmSync(tmp, { force: true });
      if (!existsSync(dest)) throw err;
    }
  }

  // Any exported symbol works; OrtGetApiBase is the stable C API entry point.
  dlopen(join(dir, mainLib), { OrtGetApiBase: { args: [], returns: "ptr" } });
}
