// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * @module
 *
 * Blazing-fast PaddleOCR for Node.js and Bun.
 *
 * Provides accurate text detection and recognition with a
 * simple, modern, type-safe API. Ideal for document processing, data
 * extraction, and computer vision tasks.
 *
 * @example
 * ```ts
 * import { PaddleOcrService } from "ppu-paddle-ocr";
 *
 * const service = new PaddleOcrService();
 * await service.initialize();
 *
 * const result = await service.recognize(imageBuffer);
 * console.log(result.text);
 * ```
 */

export type {
  AnyOcrResult,
  BatchRecognizeInput,
  DetectResult,
  FlattenedPaddleOcrResult,
  PaddleOcrResult,
} from "./core/base-paddle-ocr.service.js";

export type { BatchItemResult } from "./core/batch.js";
export {
  DEFAULT_MODEL,
  DEFAULT_MODEL_URLS,
  DICT_BASE_URL,
  MODEL_BASE_URL,
  MODEL_PRESETS,
  V3_JAPANESE_MOBILE_MODEL,
  V3_MOBILE_MODEL,
  V4_EN_MOBILE_MODEL,
  V4_MOBILE_MODEL,
  V4_SERVER_DOC_MODEL,
  V4_SERVER_MODEL,
  V5_ARABIC_MOBILE_MODEL,
  V5_CYRILLIC_MOBILE_MODEL,
  V5_DEVANAGARI_MOBILE_MODEL,
  V5_EN_MOBILE_INT8_MODEL,
  V5_EN_MOBILE_MODEL,
  V5_EN_SERVER_MODEL,
  V5_ESLAV_MOBILE_MODEL,
  V5_GREEK_MOBILE_MODEL,
  V5_KOREAN_MOBILE_MODEL,
  V5_LATIN_MOBILE_MODEL,
  V5_MOBILE_MODEL,
  V5_SERVER_MODEL,
  V5_TAMIL_MOBILE_MODEL,
  V5_TELUGU_MOBILE_MODEL,
  V5_THAI_MOBILE_MODEL,
  V6_MEDIUM_MODEL,
  V6_SMALL_MODEL,
  V6_TINY_MODEL,
  type ModelPreset,
  type ModelUrls,
} from "./model-catalogue.js";
export { PaddleOcrService } from "./processor/paddle-ocr.service.js";

export type {
  BatchRecognizeOptions,
  Box,
  DebuggingOptions,
  DetectionOptions,
  DetectOptions,
  ModelPathOptions,
  PaddleOptions,
  ProcessingEngine,
  ProcessingOptions,
  RecognitionOptions,
  RecognitionStrategy,
} from "./interface.js";

export type { PreprocessDetectionResult } from "./core/base-detection.service.js";
export { DetectionService } from "./processor/detection.service.js";

export type { RecognitionResult } from "./core/base-recognition.service.js";
export { RecognitionService } from "./processor/recognition.service.js";

export {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
  DEFAULT_PADDLE_OPTIONS,
  DEFAULT_PROCESSING_ENGINE,
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_RECOGNITION_OPTIONS,
} from "./constants.js";

import type { Canvas } from "ppu-ocv";
import type { DetectOptions, PaddleOptions, RecognizeOptions } from "./interface.js";
import type {
  DetectResult,
  FlattenedPaddleOcrResult,
  PaddleOcrResult,
} from "./core/base-paddle-ocr.service.js";
import { PaddleOcrService } from "./processor/paddle-ocr.service.js";

let defaultService: PaddleOcrService | null = null;

/**
 * Convenience function to run text recognition on an image.
 */
export async function ocr(
  image: ArrayBuffer | Canvas | string,
  options: PaddleOptions & RecognizeOptions & { flatten: true }
): Promise<FlattenedPaddleOcrResult>;
export async function ocr(
  image: ArrayBuffer | Canvas | string,
  options?: PaddleOptions & RecognizeOptions & { flatten?: false }
): Promise<PaddleOcrResult>;
export async function ocr(
  image: ArrayBuffer | Canvas | string,
  options?: PaddleOptions & RecognizeOptions
): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
  if (!defaultService) {
    defaultService = new PaddleOcrService(options);
    await defaultService.initialize();
  }
  return (
    options?.flatten
      ? defaultService.recognize(
          image as ArrayBuffer | Canvas,
          options as RecognizeOptions & { flatten: true }
        )
      : defaultService.recognize(
          image as ArrayBuffer | Canvas,
          options as (RecognizeOptions & { flatten?: false }) | undefined
        )
  ) as Promise<PaddleOcrResult | FlattenedPaddleOcrResult>;
}

/**
 * Convenience function to run text detection on an image.
 */
export async function detect(
  image: ArrayBuffer | Canvas | string,
  options?: PaddleOptions & DetectOptions
): Promise<DetectResult> {
  if (!defaultService) {
    defaultService = new PaddleOcrService(options);
    await defaultService.initialize();
  }
  return defaultService.detect(image as ArrayBuffer | Canvas, options);
}
