// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * @module
 *
 * PaddleOCR for React Native (iOS and Android).
 *
 * Uses `onnxruntime-react-native` (native JSI) and `ppu-ocv/canvas-mobile`
 * (Skia-backed) instead of their Node or Web counterparts, enabling accurate
 * text detection and recognition directly on a mobile device.
 *
 * Requires `onnxruntime-react-native` and `@shopify/react-native-skia` to be
 * installed in the app, and a dev client / prebuild (not Expo Go) since both
 * ship native modules.
 *
 * @example
 * ```ts
 * import { PaddleOcrService } from "ppu-paddle-ocr/mobile";
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
export { PaddleOcrService } from "./paddle-ocr.service.mobile.js";

export type {
  BatchRecognizeOptions,
  Box,
  DebuggingOptions,
  DetectionOptions,
  ModelPathOptions,
  PaddleOptions,
  ProcessingEngine,
  ProcessingOptions,
  RecognitionOptions,
} from "../interface.js";

export type { PreprocessDetectionResult } from "../core/base-detection.service.js";
export { DetectionService } from "./detection.service.mobile.js";

export type { RecognitionResult } from "../core/base-recognition.service.js";
export { RecognitionService } from "./recognition.service.mobile.js";

export { getDefaultMobileExecutionProviders } from "./platform.mobile.js";

export {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
  DEFAULT_PADDLE_OPTIONS,
  DEFAULT_PROCESSING_ENGINE,
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_RECOGNITION_OPTIONS,
} from "../constants.js";
