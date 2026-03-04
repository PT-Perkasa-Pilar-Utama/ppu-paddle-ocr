import type {
  DebuggingOptions,
  DetectionOptions,
  PaddleOptions,
  RecognitionOptions,
  SessionOptions,
} from "./interface.js";

/** Default debugging options – logging and image dumps disabled. */
export const DEFAULT_DEBUGGING_OPTIONS: DebuggingOptions = {
  verbose: false,
  debug: false,
  debugFolder: "out",
};

/** Default text detection options. */
export const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  autoDeskew: false,
  mean: [0.485, 0.456, 0.406],
  stdDeviation: [0.229, 0.224, 0.225],
  maxSideLength: 640,
  minimumAreaThreshold: 25,
  paddingVertical: 0.4,
  paddingHorizontal: 0.6,
};

/** Default text recognition options. */
export const DEFAULT_RECOGNITION_OPTIONS: RecognitionOptions = {
  imageHeight: 48,
  charactersDictionary: [],
};

/** Default ONNX Runtime session options. */
export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
  enableCpuMemArena: true,
  enableMemPattern: true,
  executionMode: "sequential",
  interOpNumThreads: 0,
  intraOpNumThreads: 0,
};

/** Default combined options used when no custom config is provided. */
export const DEFAULT_PADDLE_OPTIONS: PaddleOptions = {
  model: {},
  detection: DEFAULT_DETECTION_OPTIONS,
  recognition: DEFAULT_RECOGNITION_OPTIONS,
  debugging: DEFAULT_DEBUGGING_OPTIONS,
  session: DEFAULT_SESSION_OPTIONS,
};
