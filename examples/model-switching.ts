// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Example: Easy model switching with type completion.
 *
 * Run with:
 *   bun examples/model-switching.ts
 */

import {
  PaddleOcrService,
  V6_SMALL_MODEL,
  V6_TINY_MODEL,
  V5_EN_MOBILE_MODEL,
  V5_THAI_MOBILE_MODEL,
} from "../src";

// ─── Preset Models ────────────────────────────────────────────────────────────

// Easy switching with exported constants (autocomplete-friendly)
const _service1 = new PaddleOcrService({ model: V6_SMALL_MODEL });
const _service2 = new PaddleOcrService({ model: V6_TINY_MODEL });
const _service3 = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL });
const _service4 = new PaddleOcrService({ model: V5_THAI_MOBILE_MODEL });

// ─── Granular Override ────────────────────────────────────────────────────────

// Start with a preset, then override specific parts
const _service5 = new PaddleOcrService({
  model: {
    ...V6_SMALL_MODEL,
    // Use custom detection but keep v6 small recognition
    detection: "https://example.com/custom-det.onnx",
  },
});

// Fully custom
const _service6 = new PaddleOcrService({
  model: {
    detection: "./models/custom-det.onnx",
    recognition: "./models/custom-rec.onnx",
    charactersDictionary: "./models/custom-dict.txt",
  },
});

console.log("✓ All model configurations compiled successfully");
console.log("✓ Type completion works for all preset models");
