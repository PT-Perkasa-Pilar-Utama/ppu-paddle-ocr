// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import * as ort from "onnxruntime-react-native";
import type { CanvasLike } from "ppu-ocv/canvas-mobile";

import type { FlattenedPaddleOcrResult, PaddleOcrResult } from "../core/base-paddle-ocr.service.js";
import { BasePaddleOcrService } from "../core/base-paddle-ocr.service.js";
import type { CoreCanvas } from "../core/platform.js";
import { createSessionWithFallback } from "../core/session-factory.js";
import type { PaddleOptions, RecognizeOptions } from "../interface.js";
import { DEFAULT_MODEL_URLS } from "../model-catalogue.js";
import { fetchArrayBufferWithRetry, parseDictionary } from "../utils.js";
import { DetectionService } from "./detection.service.mobile.js";
import { getDefaultMobileExecutionProviders, MobilePlatformProvider } from "./platform.mobile.js";
import { RecognitionService } from "./recognition.service.mobile.js";

export type { FlattenedPaddleOcrResult, PaddleOcrResult };

/**
 * Default session options for the React Native build.
 *
 * `executionProviders` is resolved during `initialize()` (defaulting to CPU);
 * if the user supplies their own `session` with explicit providers, we respect
 * that and skip resolution.
 */
const DEFAULT_MOBILE_SESSION_OPTIONS: ort.InferenceSession.SessionOptions = {
  graphOptimizationLevel: "all",
};

/**
 * PaddleOcrService for React Native (iOS / Android) environments.
 * Uses `onnxruntime-react-native` and `ppu-ocv/canvas-mobile` (Skia) instead of
 * their Node or Web counterparts.
 */
export class PaddleOcrService extends BasePaddleOcrService {
  /**
   * Creates a mobile PaddleOcrService instance.
   * @param options - Configuration options for the service.
   */
  public constructor(options?: PaddleOptions) {
    super(new MobilePlatformProvider(), options);

    // Override default session options for MOBILE if not provided
    if (this.options.session === undefined || Object.keys(this.options.session).length === 0) {
      this.options.session = DEFAULT_MOBILE_SESSION_OPTIONS;
    }
  }

  /**
   * Creates the detection and recognition ONNX sessions from the configured
   * models using `onnxruntime-react-native`.
   */
  protected async initSessions(): Promise<void> {
    throw new Error(
      "Initialization is handled proactively in PaddleOcrService. Call initialize() instead."
    );
  }

  /**
   * Loads a resource from a URL string, or the default URL.
   */
  private async _loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string
  ): Promise<ArrayBuffer> {
    if (source instanceof ArrayBuffer) {
      this.log("Loading resource from ArrayBuffer");
      return source;
    }

    const sourceUrl = typeof source === "string" ? source : defaultUrl;
    this.log(`Fetching resource from URL: ${sourceUrl}`);

    return fetchArrayBufferWithRetry(sourceUrl);
  }

  /** Resolve execution providers, defaulting to CPU when none are supplied. */
  private _resolveSessionExecutionProviders(): void {
    const current = this.options.session ?? {};
    if (current.executionProviders && current.executionProviders.length > 0) {
      this.log(
        `Using user-provided executionProviders: ${JSON.stringify(current.executionProviders)}`
      );
      return;
    }

    const providers = getDefaultMobileExecutionProviders();
    this.options.session = { ...current, executionProviders: providers };
    this.log(`Resolved executionProviders: ${JSON.stringify(providers)}`);
  }

  /** Create an ORT session, silently falling back to CPU if the preferred providers fail. */
  private async _createSession(modelData: Uint8Array): Promise<ort.InferenceSession> {
    // SAFETY: createSessionWithFallback is written against the ORT namespace
    // shape (onnxruntime-react-native ships its own copy of these types); this
    // narrows to the one member it uses.
    return createSessionWithFallback(
      ort as unknown as { InferenceSession: typeof ort.InferenceSession },
      modelData,
      this.options.session,
      (msg) => console.warn(`[PaddleOcrService] ${msg}`),
      (next) => (this.options.session = next)
    );
  }

  /**
   * Initialize the OCR service by loading models and the character dictionary.
   *
   * Must be called before `recognize()`.
   */
  public async initialize(): Promise<void> {
    try {
      this.log("Initializing PaddleOcrService (Mobile)...");

      this._resolveSessionExecutionProviders();

      const [detModelBuffer, recModelBuffer, dictBuffer] = await Promise.all([
        this._loadResource(this.options.model?.detection, DEFAULT_MODEL_URLS.detection),
        this._loadResource(this.options.model?.recognition, DEFAULT_MODEL_URLS.recognition),
        this._loadResource(
          this.options.model?.charactersDictionary,
          DEFAULT_MODEL_URLS.charactersDictionary
        ),
      ]);

      const [detectionSession, recognitionSession] = await Promise.all([
        this._createSession(new Uint8Array(detModelBuffer)),
        this._createSession(new Uint8Array(recModelBuffer)),
      ]);

      this.detectionSession = detectionSession;
      this.recognitionSession = recognitionSession;

      if (this.options.model) this.options.model.detection = detModelBuffer;
      if (this.options.model) this.options.model.recognition = recModelBuffer;
      this.log(
        `Detection ONNX model loaded successfully\n\tinput: ${detectionSession.inputNames}\n\toutput: ${detectionSession.outputNames}`
      );
      this.log(
        `Recognition ONNX model loaded successfully\n\tinput: ${recognitionSession.inputNames}\n\toutput: ${recognitionSession.outputNames}`
      );

      const charactersDictionary = parseDictionary(dictBuffer);

      if (charactersDictionary.length === 0) {
        throw new Error("Character dictionary is empty or could not be loaded.");
      }

      if (this.options.model) this.options.model.charactersDictionary = dictBuffer;
      if (this.options.recognition)
        this.options.recognition.charactersDictionary = charactersDictionary;
      this.log(`Character dictionary loaded with ${charactersDictionary.length} entries.`);

      this.detector = new DetectionService(
        // SAFETY: the session came from this class's own createSession above,
        // so it is the runtime type DetectionService expects; only the two
        // packages' declarations of it differ.
        detectionSession as unknown as ort.InferenceSession,
        this.options.detection,
        this.options.debugging
      );
      this.recognitor = new RecognitionService(
        // SAFETY: as with the detection session above.
        recognitionSession as unknown as ort.InferenceSession,
        this.options.recognition,
        this.options.debugging
      );

      if (this.options.model) this.options.model.detection = undefined;
      if (this.options.model) this.options.model.recognition = undefined;
    } catch (error) {
      console.error("Failed to initialize PaddleOcrService Mobile:", error);
      throw error;
    }
  }

  /**
   * Returns `true` once both detection and recognition sessions are loaded.
   */
  public isInitialized(): boolean {
    return this.detectionSession !== null && this.recognitionSession !== null;
  }

  /**
   * Swaps the detection model at runtime, releasing the previous session.
   * @param model - ONNX detection model as a buffer, file path, or URL.
   */
  public async changeDetectionModel(model: ArrayBuffer | string): Promise<void> {
    this.log("Changing detection model...");
    const modelBuffer = await this._loadResource(model, DEFAULT_MODEL_URLS.detection);

    await this.detectionSession?.release();
    this.detectionSession = await this._createSession(new Uint8Array(modelBuffer));
    // Rebuild the detector against the new session; the old one is now released.
    this.detector = new DetectionService(
      // SAFETY: assigned by initialize() from createSession; same declaration
      // mismatch as above.
      this.detectionSession as unknown as ort.InferenceSession,
      this.options.detection,
      this.options.debugging
    );
    if (this.options.model) this.options.model.detection = modelBuffer;
    this.log("Detection model changed successfully.");
  }

  /**
   * Swaps the recognition model at runtime, releasing the previous session.
   * @param model - ONNX recognition model as a buffer, file path, or URL.
   */
  public async changeRecognitionModel(model: ArrayBuffer | string): Promise<void> {
    this.log("Changing recognition model...");
    const modelBuffer = await this._loadResource(model, DEFAULT_MODEL_URLS.recognition);

    await this.recognitionSession?.release();
    this.recognitionSession = await this._createSession(new Uint8Array(modelBuffer));
    // Rebuild the recognitor against the new session; the old one is now released.
    this.recognitor = new RecognitionService(
      // SAFETY: as with the detection session above.
      this.recognitionSession as unknown as ort.InferenceSession,
      this.options.recognition,
      this.options.debugging
    );
    if (this.options.model) this.options.model.recognition = modelBuffer;
    this.log("Recognition model changed successfully.");
  }

  /**
   * Replaces the character dictionary used to decode recognition output.
   * @param dictionary - Dictionary as a buffer, file path, or URL.
   */
  public async changeTextDictionary(dictionary: ArrayBuffer | string): Promise<void> {
    this.log("Changing text dictionary...");
    const dictBuffer = await this._loadResource(
      dictionary,
      DEFAULT_MODEL_URLS.charactersDictionary
    );

    const charactersDictionary = parseDictionary(dictBuffer);

    if (charactersDictionary.length === 0) {
      throw new Error("Character dictionary is empty or could not be loaded.");
    }

    if (this.options.model) this.options.model.charactersDictionary = dictBuffer;
    if (this.options.recognition)
      this.options.recognition.charactersDictionary = charactersDictionary;
    this.log(
      `Character dictionary changed successfully with ${charactersDictionary.length} entries.`
    );
  }

  /**
   * Run the full OCR pipeline (detection → recognition) on an image.
   * @param image - Source image as an `ArrayBuffer` or Skia canvas.
   * @param options - Per-call options such as `flatten` and `strategy`.
   * @returns Grouped or flattened OCR results depending on `options.flatten`.
   */
  public override recognize(
    image: ArrayBuffer | CanvasLike,
    options: RecognizeOptions & { flatten: true }
  ): Promise<FlattenedPaddleOcrResult>;

  /**
   * Run the full OCR pipeline (detection → recognition) on an image.
   * @param image - Source image as an `ArrayBuffer` or Skia canvas.
   * @param options - Per-call options; omit `flatten` for line-grouped results.
   * @returns OCR results grouped by line.
   */
  public override recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions & { flatten?: false }
  ): Promise<PaddleOcrResult>;

  public override async recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions
  ): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
    // SAFETY: this override widens the public parameter for callers; the base
    // implementation probes the value before touching it.
    return super.recognize(image as ArrayBuffer | CoreCanvas, options);
  }

  /**
   * Release all ONNX sessions and free resources.
   */
  public async destroy(): Promise<void> {
    await this.detectionSession?.release();
    await this.recognitionSession?.release();
    this.detectionSession = null;
    this.recognitionSession = null;
    this.detector = null;
    this.recognitor = null;
  }
}

export default PaddleOcrService;
