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
  FlattenedPaddleOcrResult,
  PaddleOcrResult,
} from "../core/base-paddle-ocr.service.js";
export { DEFAULT_MODEL_URLS } from "../core/base-paddle-ocr.service.js";
export type { BatchItemResult } from "../core/batch.js";
export { PaddleOcrService } from "./paddle-ocr.service.web.js";

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
export { DetectionService } from "./detection.service.web.js";

export type { RecognitionResult } from "../core/base-recognition.service.js";
export { RecognitionService } from "./recognition.service.web.js";

export { getDefaultWebExecutionProviders, isWebGpuAvailable } from "./platform.web.js";

export {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
  DEFAULT_PADDLE_OPTIONS,
  DEFAULT_PROCESSING_ENGINE,
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_RECOGNITION_OPTIONS,
} from "../constants.js";
