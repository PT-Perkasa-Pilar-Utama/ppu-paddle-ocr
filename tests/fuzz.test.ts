// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Dynamic analysis (fuzzing) of the untrusted-input boundary. `fast-check`
 * generates many random byte buffers at runtime and feeds them to the OCR
 * service's image-decode path; a crash, hang, or non-Error throw is a finding.
 * Assertions run throughout (the property uses `expect`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fc from "fast-check";

import { PaddleOcrService } from "../src/index.js";

describe("fuzz: OCR is robust to malformed image input", () => {
  let service: PaddleOcrService;

  beforeAll(async () => {
    // canvas-native engine: no @techstark/opencv-js init, faster per run.
    service = new PaddleOcrService({ processing: { engine: "canvas-native" } });
    await service.initialize();
  }, 120000); // v6 models may need downloading on first run

  afterAll(async () => {
    if (service) await service.destroy();
  });

  test("recognize never crashes on arbitrary bytes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 8192 }), async (bytes) => {
        try {
          const result = await service.recognize(bytes.buffer as ArrayBuffer, { noCache: true });
          // If random bytes happened to decode, the result must be well-formed.
          expect(Array.isArray(result.lines)).toBe(true);
        } catch (error) {
          // Malformed input must fail gracefully with a normal Error — never a
          // native crash, hang, or non-Error throw.
          expect(error).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 100 }
    );
  }, 120000);

  test("recognize rejects an empty buffer gracefully", async () => {
    await expect(service.recognize(new ArrayBuffer(0), { noCache: true })).rejects.toBeInstanceOf(
      Error
    );
  });
});
