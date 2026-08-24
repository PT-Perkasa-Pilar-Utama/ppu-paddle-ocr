// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * @module
 *
 * PaddleOCR for browsers and web environments.
 *
 * Uses `onnxruntime-web` (WebAssembly) and `ppu-ocv/web` instead of their
 * Node counterparts, enabling accurate text detection and recognition
 * directly inside the browser.
 *
 * @example
 * ```ts
 * import { PaddleOcrService } from "ppu-paddle-ocr/web";
 *
 * const service = new PaddleOcrService();
 * await service.initialize();
 *
 * const result = await service.recognize(imageBuffer, { flatten: true });
 * console.log(result.text);
 * ```
 */

export type {
  AnyOcrResult,
  BatchRecognizeInput,
  DetectResult,
  FlattenedPaddleOcrResult,
  PaddleOcrResult,
} from "../core/base-paddle-ocr.service.js";
export type { BatchItemResult } from "../core/batch.js";
export {
  DEFAULT_MODEL,
  DEFAULT_MODEL_URLS,
  DICT_BASE_URL,
  MODEL_BASE_URL,
  MODEL_PRESETS,
  type ModelPreset,
  type ModelUrls,
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
} from "../model-catalogue.js";
export { PaddleOcrService } from "./paddle-ocr.service.web.js";

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
} from "../interface.js";

export type { PreprocessDetectionResult } from "../core/base-detection.service.js";
export { DetectionService } from "./detection.service.web.js";

export type { RecognitionResult } from "../core/base-recognition.service.js";
export { RecognitionService } from "./recognition.service.web.js";

export { getDefaultWebExecutionProviders, isWebGpuAvailable, isWebWorker } from "./platform.web.js";

export {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
  DEFAULT_PADDLE_OPTIONS,
  DEFAULT_PROCESSING_ENGINE,
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_RECOGNITION_OPTIONS,
} from "../constants.js";

import type { CanvasLike } from "ppu-ocv/web";
import type { DetectOptions, PaddleOptions, RecognizeOptions } from "../interface.js";
import type {
  DetectResult,
  FlattenedPaddleOcrResult,
  PaddleOcrResult,
} from "../core/base-paddle-ocr.service.js";
import { PaddleOcrService } from "./paddle-ocr.service.web.js";

let defaultWebService: PaddleOcrService | null = null;

/**
 * Convenience function to run text recognition in the browser.
 */
export async function ocr(
  image: ArrayBuffer | CanvasLike | string,
  options: PaddleOptions & RecognizeOptions & { flatten: true }
): Promise<FlattenedPaddleOcrResult>;
export async function ocr(
  image: ArrayBuffer | CanvasLike | string,
  options?: PaddleOptions & RecognizeOptions & { flatten?: false }
): Promise<PaddleOcrResult>;
export async function ocr(
  image: ArrayBuffer | CanvasLike | string,
  options?: PaddleOptions & RecognizeOptions
): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
  if (!defaultWebService) {
    defaultWebService = new PaddleOcrService(options);
    await defaultWebService.initialize();
  }
  return (
    options?.flatten
      ? defaultWebService.recognize(
          image as ArrayBuffer | CanvasLike,
          options as RecognizeOptions & { flatten: true }
        )
      : defaultWebService.recognize(
          image as ArrayBuffer | CanvasLike,
          options as (RecognizeOptions & { flatten?: false }) | undefined
        )
  ) as Promise<PaddleOcrResult | FlattenedPaddleOcrResult>;
}

/**
 * Convenience function to run text detection in the browser.
 */
export async function detect(
  image: ArrayBuffer | CanvasLike | string,
  options?: PaddleOptions & DetectOptions
): Promise<DetectResult> {
  if (!defaultWebService) {
    defaultWebService = new PaddleOcrService(options);
    await defaultWebService.initialize();
  }
  return defaultWebService.detect(image as ArrayBuffer | CanvasLike, options);
}
