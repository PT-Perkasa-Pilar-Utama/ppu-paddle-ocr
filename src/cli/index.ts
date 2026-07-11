#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * `ppu-paddle-ocr` executable entry point. Thin shim around {@link main}: wires
 * argv, the SIGINT handler, and the final exit code. All logic lives in
 * `run.ts` so it stays importable from tests without side effects.
 */

process.on("SIGINT", () => process.exit(130));

try {
  // Dynamic import: a static one would fail during module-graph resolution,
  // before this try/catch exists, when the optional onnxruntime-node backend
  // is absent.
  const { main } = await import("./run.js");
  process.exit(await main(process.argv.slice(2)));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("onnxruntime-node") && /cannot find (module|package)/i.test(msg)) {
    process.stderr.write(
      "The 'onnxruntime-node' backend is not installed (optional peer dependency, ~258MB).\n" +
        "In a project:  npm install ppu-paddle-ocr onnxruntime-node\n" +
        "Zero-install:  npx -p onnxruntime-node -p ppu-paddle-ocr ppu-paddle-ocr <args>\n"
    );
    process.exit(1);
  }
  process.stderr.write(`${e instanceof Error ? (e.stack ?? msg) : String(e)}\n`);
  process.exit(1);
}
