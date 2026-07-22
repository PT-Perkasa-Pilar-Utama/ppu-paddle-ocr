// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * bun test preload: warm the default (tiny) model cache once, before any
 * test file runs. Without this, the first cold-cache initialize() happens
 * inside a 5s beforeEach/beforeAll hook and times out whenever the LFS
 * download is slow - one flaky failure per test file. Warm cache = no-op.
 */
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

await PaddleOcrService.downloadModels();
