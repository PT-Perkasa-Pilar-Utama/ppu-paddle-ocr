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

export type { FlattenedPaddleOcrResult, PaddleOcrResult } from "./core/base-paddle-ocr.service.js";
export { PaddleOcrService } from "./processor/paddle-ocr.service.js";

export type {
  Box,
  DebuggingOptions,
  DetectionOptions,
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
