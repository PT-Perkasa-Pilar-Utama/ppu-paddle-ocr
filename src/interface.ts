import type { InferenceSession } from "onnxruntime-common";

/**
 * The image processing engine to use for preprocessing.
 *
 * - `"opencv"` – Uses OpenCV.js (`ImageProcessor` / `Contours` from `ppu-ocv`).
 *   More accurate region detection; recommended for production use. **(default)**
 * - `"canvas-native"` – Uses pure HTML Canvas operations (`CanvasProcessor` from `ppu-ocv/canvas`).
 *   No OpenCV dependency; suitable for lightweight or browser-extension environments.
 */
export type ProcessingEngine = "opencv" | "canvas-native";

/**
 * Paths to the OCR model and dictionary files.
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
   * Images above this size will be scaled down, maintaining aspect ratio.
   * @default 640
   */
  maxSideLength?: number;

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
   * @default 50
   */
  minimumAreaThreshold?: number;
};

/**
 * Strategy for recognizing text in detected regions.
 *
 * - `"per-box"` – Each detected box is recognized individually (most accurate, n inferences).
 * - `"per-line"` – Boxes on the same line are merged and recognized together (fewer inferences, good accuracy).
 * - `"cross-line"` – Crops are packed into uniform-width batches across lines to minimize inference count.
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
   * - `"per-box"` – Each box recognized individually (most accurate, n inferences)
   * - `"per-line"` – Same-line boxes merged per line (fewer inferences, good accuracy)
   * - `"cross-line"` – Crops packed into uniform-width batches across lines (fewest inferences)
   * @default "per-line"
   */
  strategy?: RecognitionStrategy;

  /**
   * Width multiplier for the cross-line strategy's bin-packing target.
   * The batch target width is computed as `maxLineWidth × factor`.
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
 * Controls the image processing backend.
 */
export type ProcessingOptions = {
  /**
   * The image processing engine used for detection preprocessing and
   * recognition resizing.
   *
   * - `"opencv"` – Uses OpenCV.js via `ppu-ocv` (more accurate, **default**).
   * - `"canvas-native"` – Pure canvas operations via `ppu-ocv/canvas` (no OpenCV dependency).
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
