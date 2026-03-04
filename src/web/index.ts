export {
  PaddleOcrService,
  type FlattenedPaddleOcrResult,
  type PaddleOcrResult,
} from "./paddle-ocr.service.web.js";

export type {
  Box,
  DebuggingOptions,
  DetectionOptions,
  ModelPathOptions,
  PaddleOptions,
  RecognitionOptions,
} from "../interface.js";

export {
  DetectionServiceWeb as DetectionService,
  type PreprocessDetectionResult,
} from "./detection.service.web.js";

export {
  RecognitionServiceWeb as RecognitionService,
  type RecognitionResult,
} from "./recognition.service.web.js";

export {
  DEFAULT_DEBUGGING_OPTIONS,
  DEFAULT_DETECTION_OPTIONS,
  DEFAULT_PADDLE_OPTIONS,
  DEFAULT_RECOGNITION_OPTIONS,
} from "../constants.js";
