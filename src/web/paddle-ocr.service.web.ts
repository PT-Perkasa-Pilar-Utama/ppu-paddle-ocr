// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import * as ort from "onnxruntime-web";
import type { CanvasLike } from "ppu-ocv/web";

import type { FlattenedPaddleOcrResult, PaddleOcrResult } from "../core/base-paddle-ocr.service.js";
import { BasePaddleOcrService, DEFAULT_MODEL_URLS } from "../core/base-paddle-ocr.service.js";
import type { CoreCanvas } from "../core/platform.js";
import { createSessionWithFallback } from "../core/session-factory.js";
import type { PaddleOptions, RecognizeOptions } from "../interface.js";
import { parseDictionary } from "../utils.js";
import { DetectionService } from "./detection.service.web.js";
import { getDefaultWebExecutionProviders, WebPlatformProvider } from "./platform.web.js";
import { RecognitionService } from "./recognition.service.web.js";

export type { FlattenedPaddleOcrResult, PaddleOcrResult };

/**
 * Default session options for the web build.
 *
 * `executionProviders` is intentionally omitted here; it is resolved
 * asynchronously during `initialize()` so we can probe for WebGPU before
 * committing to a provider. If the user supplies their own `session` with
 * explicit providers, we respect that and skip detection.
 */
const DEFAULT_WEB_SESSION_OPTIONS: ort.InferenceSession.SessionOptions = {
  graphOptimizationLevel: "all",
};

/**
 * PaddleOcrService for Web/Browser environments.
 * Uses onnxruntime-web and ppu-ocv/web instead of their Node counterparts.
 */
export class PaddleOcrService extends BasePaddleOcrService {
  public constructor(options?: PaddleOptions) {
    super(new WebPlatformProvider(), options);

    // Override default session options for WEB if not provided
    if (this.options.session === undefined || Object.keys(this.options.session).length === 0) {
      this.options.session = DEFAULT_WEB_SESSION_OPTIONS;
    }
  }

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

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch resource from ${sourceUrl}`);
    }

    return response.arrayBuffer();
  }

  /** Resolve execution providers, preferring WebGPU when the browser supports it. */
  private async _resolveSessionExecutionProviders(): Promise<void> {
    const current = this.options.session ?? {};
    if (current.executionProviders && current.executionProviders.length > 0) {
      this.log(
        `Using user-provided executionProviders: ${JSON.stringify(current.executionProviders)}`
      );
      return;
    }

    const providers = await getDefaultWebExecutionProviders();
    this.options.session = { ...current, executionProviders: providers };
    this.log(`Resolved executionProviders: ${JSON.stringify(providers)}`);
  }

  /** Create an ORT session, silently falling back to WASM if the preferred providers fail. */
  private async _createSession(modelData: Uint8Array): Promise<ort.InferenceSession> {
    return createSessionWithFallback(
      ort as unknown as { InferenceSession: typeof ort.InferenceSession },
      modelData,
      this.options.session,
      (msg) => console.warn(`[PaddleOcrService] ${msg}`),
      (next) => (this.options.session = next)
    );
  }

  /**
   * Initialize the OCR service by loading models, dictionary, and the OpenCV runtime.
   *
   * Must be called before `recognize()`.
   */
  public async initialize(): Promise<void> {
    try {
      this.log("Initializing PaddleOcrService (Web)...");

      await this._resolveSessionExecutionProviders();

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
        detectionSession as unknown as ort.InferenceSession,
        this.options.detection,
        this.options.debugging
      );
      this.recognitor = new RecognitionService(
        recognitionSession as unknown as ort.InferenceSession,
        this.options.recognition,
        this.options.debugging
      );

      if (this.options.model) this.options.model.detection = undefined;
      if (this.options.model) this.options.model.recognition = undefined;
    } catch (error) {
      console.error("Failed to initialize PaddleOcrService Web:", error);
      throw error;
    }
  }

  public isInitialized(): boolean {
    return this.detectionSession !== null && this.recognitionSession !== null;
  }

  public async changeDetectionModel(model: ArrayBuffer | string): Promise<void> {
    this.log("Changing detection model...");
    const modelBuffer = await this._loadResource(model, DEFAULT_MODEL_URLS.detection);

    await this.detectionSession?.release();
    this.detectionSession = await this._createSession(new Uint8Array(modelBuffer));
    // Rebuild the detector against the new session; the old one is now released.
    this.detector = new DetectionService(
      this.detectionSession as unknown as ort.InferenceSession,
      this.options.detection,
      this.options.debugging
    );
    if (this.options.model) this.options.model.detection = modelBuffer;
    this.log("Detection model changed successfully.");
  }

  public async changeRecognitionModel(model: ArrayBuffer | string): Promise<void> {
    this.log("Changing recognition model...");
    const modelBuffer = await this._loadResource(model, DEFAULT_MODEL_URLS.recognition);

    await this.recognitionSession?.release();
    this.recognitionSession = await this._createSession(new Uint8Array(modelBuffer));
    // Rebuild the recognitor against the new session; the old one is now released.
    this.recognitor = new RecognitionService(
      this.recognitionSession as unknown as ort.InferenceSession,
      this.options.recognition,
      this.options.debugging
    );
    if (this.options.model) this.options.model.recognition = modelBuffer;
    this.log("Recognition model changed successfully.");
  }

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

  public override recognize(
    image: ArrayBuffer | CanvasLike,
    options: RecognizeOptions & { flatten: true }
  ): Promise<FlattenedPaddleOcrResult>;

  public override recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions & { flatten?: false }
  ): Promise<PaddleOcrResult>;

  public override async recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions
  ): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
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
