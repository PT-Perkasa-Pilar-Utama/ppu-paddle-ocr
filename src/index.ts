export type {
  FlattenedPaddleOcrResult,
  PaddleOcrResult,
} from "./core/base-paddle-ocr.service.js";
export { PaddleOcrService } from "./processor/paddle-ocr.service.js";

export type {
  Box,
  DebuggingOptions,
  DetectionOptions,
  ModelPathOptions,
  PaddleOptions,
  RecognitionOptions,
} from "./interface.js";

export type { PreprocessDetectionResult } from "./core/base-detection.service.js";
export { DetectionService } from "./processor/detection.service.js";

export type { RecognitionResult } from "./core/base-recognition.service.js";
export { RecognitionService } from "./processor/recognition.service.js";

export {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
  DEFAULT_PADDLE_OPTIONS,
  DEFAULT_RECOGNITION_OPTIONS,
} from "./constants.js";
