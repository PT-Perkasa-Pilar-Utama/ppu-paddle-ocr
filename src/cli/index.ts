#!/usr/bin/env node
/**
 * `ppu-paddle-ocr` executable entry point. Thin shim around {@link main}: wires
 * argv, the SIGINT handler, and the final exit code. All logic lives in
 * `run.ts` so it stays importable from tests without side effects.
 */

import { main } from "./run.js";

process.on("SIGINT", () => process.exit(130));

try {
  process.exit(await main(process.argv.slice(2)));
} catch (e) {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
}
