// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession } from "onnxruntime-common";

/**
 * The image processing engine to use for preprocessing.
 *
 * - `"opencv"` - Uses OpenCV.js (`ImageProcessor` / `Contours` from `ppu-ocv`).
 *   More accurate region detection; recommended for production use. **(default)**
 * - `"canvas-native"` - Uses pure HTML Canvas operations (`CanvasProcessor` from `ppu-ocv/canvas`).
 *   No OpenCV dependency; suitable for lightweight or browser-extension environments.
 */
export type ProcessingEngine = "opencv" | "canvas-native";

/**
 * Paths to the OCR model and dictionary files.
 *
 * **Preset models** (import from `"ppu-paddle-ocr"`):
 *
 * - **PP-OCRv6**: `V6_TINY_MODEL` (default), `V6_SMALL_MODEL`, `V6_MEDIUM_MODEL`
 * - **PP-OCRv5**: `V5_EN_MOBILE_MODEL`, `V5_EN_MOBILE_INT8_MODEL`, `V5_EN_SERVER_MODEL`, `V5_MOBILE_MODEL`, `V5_SERVER_MODEL`
 * - **PP-OCRv5 Languages**: `V5_ARABIC_MOBILE_MODEL`, `V5_CYRILLIC_MOBILE_MODEL`, `V5_DEVANAGARI_MOBILE_MODEL`, `V5_GREEK_MOBILE_MODEL`, `V5_ESLAV_MOBILE_MODEL`, `V5_KOREAN_MOBILE_MODEL`, `V5_LATIN_MOBILE_MODEL`, `V5_TAMIL_MOBILE_MODEL`, `V5_TELUGU_MOBILE_MODEL`, `V5_THAI_MOBILE_MODEL`
 * - **PP-OCRv4**: `V4_EN_MOBILE_MODEL`, `V4_MOBILE_MODEL`, `V4_SERVER_MODEL`, `V4_SERVER_DOC_MODEL`
 * - **PP-OCRv3**: `V3_MOBILE_MODEL`, `V3_JAPANESE_MOBILE_MODEL`
 *
 * Or provide granular custom paths for `detection`, `recognition`, `charactersDictionary`.
 *
 * @example
 * ```ts
 * import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr";
 * const service = new PaddleOcrService({ model: V6_SMALL_MODEL });
 * ```
 */
export type ModelPathOptions = {
  /**
   * Onnx file buffer or path for the text detection model.
   * Required if not using the library's built‑in default model.
   */
  detection?: ArrayBuffer | string;

  /**
   * Onnx file buffer or path for the text recognition model.
   * Required if not using the library's built‑in default model.
   */
  recognition?: ArrayBuffer | string;

  /**
   * Onnx file buffer or path for the character dictionary.
   * Required if not using the library's built‑in default dictionary (en_dict.txt).
   */
  charactersDictionary?: ArrayBuffer | string;
};

/**
 * Controls verbose output and image dumps for debugging OCR.
 */
export type DebuggingOptions = {
  /**
   * Enable detailed logging of each processing step.
   * @default false
   */
  verbose?: boolean;

  /**
   * Save intermediate image data to disk for inspection.
   * @default false
   */
  debug?: boolean;

  /**
   * Directory where debug images will be written.
   * Relative to the current working directory.
   * @default "out"
   */
  debugFolder?: string;
};

/**
 * Parameters for the text detection preprocessing and filtering stage.
 */
export type DetectionOptions = {
  /**
   * Per-channel mean values used to normalize input pixels [R, G, B].
   * @default [0.485, 0.456, 0.406]
   */
  mean?: [number, number, number];

  /**
   * Per-channel standard deviation values used to normalize input pixels [R, G, B].
   * @default [0.229, 0.224, 0.225]
   */
  stdDeviation?: [number, number, number];

  /**
   * Maximum dimension (longest side) for input images, in pixels.
   * Images above this size will be scaled down, maintaining aspect ratio;
   * images below it are processed at native resolution (never upscaled).
   *
   * `"auto"` (the default) scales the cap with the input so small text
   * survives on large photos without manual tuning:
   * `clamp(0.75 * longestSide, 960, 1920)`. Inputs up to ~1280px behave
   * exactly like a fixed 960; a 2400px phone screenshot detects at 1800;
   * a 4K photo at 1920 instead of being crushed to a quarter scale.
   * @default "auto"
   */
  maxSideLength?: number | "auto";

  /**
   * Padding applied to each detected box vertical as a fraction of its height
   * @default 0.4
   */
  paddingVertical?: number;

  /**
   * Padding applied to each detected box vertical as a fraction of its height
   * @default 0.6
   */
  paddingHorizontal?: number;

  /**
   * Remove detected boxes with area below this threshold, in pixels.
   * @default 20
   */
  minimumAreaThreshold?: number;
};

/**
 * Strategy for recognizing text in detected regions.
 *
 * - `"per-box"` - Each detected box is recognized individually (highest crop isolation, n inferences).
 * - `"per-line"` - Boxes on the same line are merged and recognized together (fewer inferences, good accuracy).
 * - `"cross-line"` - Crops are packed into uniform-width batches across lines to minimize inference count.
 *
 * @default "per-line"
 */
export type RecognitionStrategy = "per-box" | "per-line" | "cross-line";

/**
 * Parameters for the text recognition preprocessing stage.
 */
export type RecognitionOptions = {
  /**
   * Fixed height for input images, in pixels.
   * Models will resize width proportionally.
   * @default 48
   */
  imageHeight?: number;

  /**
   * Recognition strategy for processing detected text regions.
   * - `"per-box"` - Each box recognized individually (highest crop isolation, n inferences)
   * - `"per-line"` - Same-line boxes merged per line (fewer inferences, good accuracy)
   * - `"cross-line"` - Crops packed into uniform-width batches across lines (fewest inferences)
   * @default "per-line"
   */
  strategy?: RecognitionStrategy;

  /**
   * Drop recognized items whose confidence is below this value (0 disables).
   * Mirrors upstream PaddleOCR's `drop_score`: noise regions (hatch patterns,
   * logos, barcodes) read as text at 0.2-0.45 confidence, while real text
   * measures 0.65+.
   * @default 0.5
   */
  minimumConfidence?: number;

  /**
   * Width multiplier for the cross-line strategy's bin-packing target.
   * The batch target width is computed as `maxLineWidth x factor`.
   * Larger values pack more lines per batch (fewer inferences, potentially
   * lower accuracy); smaller values keep lines isolated (more inferences).
   *
   * Only used when `strategy` is `"cross-line"`.
   * @default 1.0
   */
  crossLineWidthFactor?: number;

  /**
   * A list of loaded character dictionary (string) for
   * recognition result decoding.
   */
  charactersDictionary: string[];

  /**
   * Maximum dimension (longest side) for the canvas recognition crops are
   * cut from, in pixels. Images above this size are downscaled first
   * (boxes are rescaled to match, then results are scaled back up to
   * original-image coordinates); images below it are cropped at native
   * resolution, unaffected by this option.
   *
   * This is independent of `detection.maxSideLength` - that only resizes
   * the detector's own input tensor and never touches the source canvas
   * recognition crops come from. On a far-oversized source (e.g. a
   * 4961x7016 full-page scan), skipping this cap means paying full-resolution
   * decode plus dozens of full-res per-line crop costs, unrelated to
   * detection or model inference itself.
   *
   * This is a speed/accuracy trade-off you control: lower it for faster
   * recognition on large sources at some accuracy cost; raise it (or set it
   * near your largest expected input) to always crop at native resolution.
   * @default 2000
   */
  maxCropSourceSideLength?: number;
};

/**
 * Options for individual recognize() calls.
 */
export type RecognizeOptions = {
  /**
   * Return flattened results instead of grouped by lines.
   * @default false
   */
  flatten?: boolean;

  /**
   * Override the recognition strategy for this call.
   * If omitted, the strategy from the service options is used.
   */
  strategy?: RecognitionStrategy;

  /**
   * Custom character dictionary for this specific call.
   * If provided, caching will be disabled for this call.
   */
  dictionary?: string | ArrayBuffer;

  /**
   * Disable caching for this specific call.
   * @default false
   */
  noCache?: boolean;
};

/**
 * Options for individual detect() calls.
 *
 * Extends the constructor-level {@link DetectionOptions}, so every detection
 * tuning field (`maxSideLength`, `minimumAreaThreshold`, paddings, `mean`,
 * `stdDeviation`) can also be overridden per call.
 */
export type DetectOptions = DetectionOptions & {
  /**
   * Crop each detected region and return it as a PNG-encoded `ArrayBuffer`,
   * index-aligned with the returned `boxes`.
   *
   * Not supported on React Native (the Skia canvas cannot be encoded).
   * @default false
   */
  crop?: boolean;

  /**
   * Directory where each crop is saved as `crop_NNN.png`.
   * Node/Bun only; ignored on web and mobile.
   */
  saveCropsTo?: string;
};

/**
 * Options for `batchRecognize()` / `batchRecognizeStream()`.
 *
 * Extends {@link RecognizeOptions} (applied to every image) with controls for
 * concurrency, error handling, progress, and cancellation.
 */
export type BatchRecognizeOptions = RecognizeOptions & {
  /**
   * Maximum number of images processed concurrently.
   *
   * `"auto"` (default) picks `1` when an accelerator execution provider
   * (e.g. CUDA, WebGPU) is configured - a shared inference session serializes
   * device work anyway and parallel runs would stack VRAM - and a small CPU
   * default otherwise, to overlap JS preprocessing with native inference.
   * @default "auto"
   */
  concurrency?: number | "auto";

  /**
   * When `true`, a failing image does not abort the batch: its slot is filled
   * with a `{ status: "rejected", reason }` entry. When `false` (default), the
   * first failure rejects the whole call, matching `recognize()`.
   * @default false
   */
  settle?: boolean;

  /**
   * Cancels the batch. Pending images are not scheduled and the call rejects
   * with an `AbortError`. In-flight inferences are allowed to finish but their
   * results are discarded.
   */
  signal?: AbortSignal;

  /**
   * Invoked after each image settles with the running completed count and the
   * total (when the input length is known up front, e.g. an array).
   */
  onProgress?: (done: number, total: number | undefined) => void;
};

/**
 * Controls the image processing backend.
 */
export type ProcessingOptions = {
  /**
   * The image processing engine used for detection preprocessing and
   * recognition resizing.
   *
   * - `"opencv"` - Uses OpenCV.js via `ppu-ocv` (more accurate, **default**).
   * - `"canvas-native"` - Pure canvas operations via `ppu-ocv/canvas` (no OpenCV dependency).
   *
   * @default "opencv"
   */
  engine?: ProcessingEngine;
};

/**
 * Full configuration for the PaddleOCR service.
 * Combines model file paths with detection, recognition, and debugging parameters.
 */
export type PaddleOptions = {
  /**
   * File paths to the required OCR model components.
   */
  model?: ModelPathOptions;

  /**
   * Controls parameters for text detection.
   */
  detection?: DetectionOptions;

  /**
   * Controls parameters for text recognition.
   */
  recognition?: RecognitionOptions;

  /**
   * Controls logging and image dump behavior for debugging.
   */
  debugging?: DebuggingOptions;

  /**
   * ONNX Runtime session configuration options.
   */
  session?: SessionOptions;

  /**
   * Controls the image processing backend.
   */
  processing?: ProcessingOptions;
};

/**
 * ONNX Runtime session configuration options.
 *
 * Extends the native `InferenceSession.SessionOptions` from ONNX Runtime
 * so that any valid provider configuration (e.g. WebAssembly, CUDA, CoreML)
 * is accepted without type mismatch.
 */
export type SessionOptions = InferenceSession.SessionOptions & {
  /**
   * Execution providers to use for inference (e.g., 'cpu', 'cuda', 'wasm').
   * Accepts provider name strings or provider-specific configuration objects.
   * @default ['cpu']
   */
  executionProviders?: InferenceSession.SessionOptions["executionProviders"];
};

/**
 * Simple rectangle representation.
 */
export type Box = {
  /** X-coordinate of the top-left corner. */
  x: number;
  /** Y-coordinate of the top-left corner. */
  y: number;
  /** Width of the box in pixels. */
  width: number;
  /** Height of the box in pixels. */
  height: number;
};
