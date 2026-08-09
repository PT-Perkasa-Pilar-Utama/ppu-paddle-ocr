// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type {
  DebuggingOptions,
  DetectionOptions,
  PaddleOptions,
  ProcessingEngine,
  ProcessingOptions,
  RecognitionOptions,
  SessionOptions,
} from "./interface.js";

/** Default debugging options - logging and image dumps disabled. */
export const DEFAULT_DEBUGGING_OPTIONS: DebuggingOptions = {
  verbose: false,
  debug: false,
  debugFolder: "out",
};

/** Default text detection options. */
export const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  mean: [0.485, 0.456, 0.406],
  stdDeviation: [0.229, 0.224, 0.225],
  maxSideLength: "auto",
  minimumAreaThreshold: 20,
  paddingVertical: 0.4,
  paddingHorizontal: 0.6,
};

/** Default text recognition options. */
export const DEFAULT_RECOGNITION_OPTIONS: RecognitionOptions = {
  imageHeight: 48,
  strategy: "per-line",
  crossLineWidthFactor: 1.0,
  minimumConfidence: 0.5,
  charactersDictionary: [],
  maxCropSourceSideLength: 2000,
  mainThreadYieldMs: 0,
};

/**
 * Default `mainThreadYieldMs` applied by the web entry on the main thread
 * (never in workers): one macrotask pause per recognition inference keeps
 * the page painting and handling input while WASM blocks the thread.
 */
export const DEFAULT_WEB_MAIN_THREAD_YIELD_MS = 10;

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

/** Default image processing engine. */
export const DEFAULT_PROCESSING_ENGINE: ProcessingEngine = "opencv";

/** Default image processing options. */
export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = {
  engine: DEFAULT_PROCESSING_ENGINE,
};

/** Default combined options used when no custom config is provided. */
export const DEFAULT_PADDLE_OPTIONS: PaddleOptions = {
  model: {},
  detection: DEFAULT_DETECTION_OPTIONS,
  recognition: DEFAULT_RECOGNITION_OPTIONS,
  debugging: DEFAULT_DEBUGGING_OPTIONS,
  session: DEFAULT_SESSION_OPTIONS,
  processing: DEFAULT_PROCESSING_OPTIONS,
};
