// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { currentTargetKey, entrySource, TARGETS } from "../scripts/binary/build-binaries.js";
import { preloadOnnxRuntime } from "../scripts/binary/native-preload.js";
import { readVersion } from "../src/cli/io.js";

const ROOT = join(import.meta.dir, "..");
const ORT_BIN = join(ROOT, "node_modules", "onnxruntime-node", "bin", "napi-v6");

describe("readVersion", () => {
  afterEach(() => {
    delete process.env.PPU_BINARY_VERSION;
  });

  test("returns the package.json version in a normal install", async () => {
    const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as { version: string };
    expect(readVersion()).toBe(pkg.version);
  });

  test("the build-time injected version wins (standalone binaries)", () => {
    process.env.PPU_BINARY_VERSION = "9.9.9-binary";
    expect(readVersion()).toBe("9.9.9-binary");
  });
});

describe("slim binary engine guard", () => {
  afterEach(() => {
    delete process.env.PPU_BINARY_SLIM;
  });

  test("slim pins canvas-native and rejects --engine opencv", async () => {
    const { buildPaddleOptions } = await import("../src/cli/options.js");
    process.env.PPU_BINARY_SLIM = "1";

    expect(buildPaddleOptions({}).processing).toEqual({ engine: "canvas-native" });
    expect(buildPaddleOptions({ engine: "canvas-native" }).processing).toEqual({
      engine: "canvas-native",
    });
    expect(() => buildPaddleOptions({ engine: "opencv" })).toThrow(/slim/);
  });

  test("without the slim flag the engine flag passes through", async () => {
    const { buildPaddleOptions } = await import("../src/cli/options.js");
    expect(buildPaddleOptions({ engine: "opencv" }).processing).toEqual({ engine: "opencv" });
    expect(buildPaddleOptions({}).processing).toBeUndefined();
  });
});

describe("binary build targets", () => {
  test("every target's onnxruntime libraries exist in the installed package", () => {
    // onnxruntime-node ships all platforms in one package, so a cross-compile
    // from any host must find every target's libs. If an upgrade renames or
    // drops one (as 1.27 dropped darwin/x64), this catches it before CI does.
    for (const target of Object.values(TARGETS)) {
      for (const lib of target.ortLibs) {
        expect(existsSync(join(ORT_BIN, target.ortDir, lib))).toBe(true);
      }
    }
  });

  test("entrySource embeds each lib and hands off to the CLI", () => {
    for (const target of Object.values(TARGETS)) {
      const src = entrySource(target, "1.27.0");
      for (const lib of target.ortLibs) {
        expect(src).toContain(`bin/napi-v6/${target.ortDir}/${lib}" with { type: "file" }`);
      }
      expect(src).toContain(`"${target.ortMain}", "1.27.0-${target.key}"`);
      expect(src).toContain(`await import("../src/cli/index.js")`);
    }
  });

  test("preloadOnnxRuntime extracts and dlopens the host platform's library", async () => {
    const key = currentTargetKey();
    const target = key ? TARGETS[key] : undefined;
    if (!target) return; // unsupported host; covered by the CI matrix
    const files = Object.fromEntries(
      target.ortLibs.map((lib) => [lib, join(ORT_BIN, target.ortDir, lib)])
    );

    // Twice: the second call exercises the already-extracted cache path.
    await preloadOnnxRuntime(files, target.ortMain, `test-${key}`);
    await preloadOnnxRuntime(files, target.ortMain, `test-${key}`);
  });
});
