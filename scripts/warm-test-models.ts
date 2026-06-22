// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Warm the on-disk model cache before the test suite runs.
 *
 * CI pins Bun 1.2.23, which caps lifecycle-hook timeouts at the 5 s default and
 * rejects a per-hook timeout argument. The test hooks download models on first
 * use, so a cold cache would blow that 5 s limit. Running this first turns those
 * in-hook downloads into fast disk hits.
 *
 * Downloads the default (PP-OCRv6 small) plus the PP-OCRv5 English models the
 * dictionary tests use.
 */

import { PaddleOcrService, V5_EN_MOBILE_MODEL } from "../src/index.js";

await PaddleOcrService.downloadModels();

const v5 = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL });
await v5.initialize();
await v5.destroy();

console.log("Model cache warmed (PP-OCRv6 small + PP-OCRv5 EN).");
