// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { existsSync, readFileSync, rmSync } from "fs";
import * as ort from "onnxruntime-node";
import * as path from "path";
import type { Canvas } from "ppu-ocv";
import { ImageProcessor } from "ppu-ocv";
import { CanvasProcessor } from "ppu-ocv/canvas";

import { BasePaddleOcrService } from "../core/base-paddle-ocr.service.js";
import { globalImageCache, ImageCache } from "../core/image-cache.js";
import { groupRecognitionResultsByLine } from "../core/recognition/result-grouping.js";
import { createSessionWithFallback } from "../core/session-factory.js";
import type { PaddleOptions, RecognizeOptions } from "../interface.js";
import { DEFAULT_MODEL_URLS } from "../model-catalogue.js";
import { parseDictionary } from "../utils.js";
import type { FlattenedPaddleOcrResult, PaddleOcrResult } from "../web/paddle-ocr.service.web.js";
import { DetectionService } from "./detection.service.js";
import { CACHE_DIR, fetchAndCacheResource } from "./model-cache.js";
import { NodePlatformProvider } from "./platform.node.js";
import { RecognitionService } from "./recognition.service.js";

/**
 * PaddleOcrService - Provides OCR functionality using PaddleOCR models.
 * To use this service, create an instance and call the `initialize()` method.
 */
export class PaddleOcrService extends BasePaddleOcrService {
  /**
   * Creates an instance of PaddleOcrService.
   * @param options - Configuration options for the service.
   */
  public constructor(options?: PaddleOptions) {
    super(new NodePlatformProvider(), options);
  }

  /**
   * Fetches a resource from a URL and caches it locally.
   * If the resource is already in the cache, it loads it from there.
   */
  private async _fetchAndCache(url: string): Promise<ArrayBuffer> {
    return fetchAndCacheResource(url, this.options.debugging?.verbose);
  }

  /**
   * Loads a resource from a buffer, a file path, a URL, or a default URL.
   */
  private async _loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string
  ): Promise<ArrayBuffer> {
    if (source instanceof ArrayBuffer) {
      this.log("Loading resource from ArrayBuffer");
      return source;
    }

    if (typeof source === "string") {
      if (source.startsWith("http")) {
        return this._fetchAndCache(source);
      } else {
        const resolvedPath = path.resolve(process.cwd(), source);
        this.log(`Loading resource from path: ${resolvedPath}`);
        const buf = readFileSync(resolvedPath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
    }

    return this._fetchAndCache(defaultUrl);
  }

  /**
   * Not used by the Node service - initialization runs in {@link initialize}.
   * @throws Always; call {@link initialize} instead.
   */
  protected async initSessions(): Promise<void> {
    throw new Error(
      "Initialization is handled proactively in PaddleOcrService. Call initialize() instead."
    );
  }

  /**
   * Initializes the OCR service by loading models and dictionary.
   * This method must be called before any OCR operations.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized()) {
      this.log("PaddleOcrService is already initialized.");
      return;
    }

    try {
      this.log("Initializing PaddleOcrService...");

      const engine = this.options.processing?.engine || "opencv";

      const [detModelBuffer, recModelBuffer, dictBuffer] = await Promise.all([
        this._loadResource(this.options.model?.detection, DEFAULT_MODEL_URLS.detection),
        this._loadResource(this.options.model?.recognition, DEFAULT_MODEL_URLS.recognition),
        this._loadResource(
          this.options.model?.charactersDictionary,
          DEFAULT_MODEL_URLS.charactersDictionary
        ),
      ]);

      const [detectionSession, recognitionSession] = await Promise.all([
        createSessionWithFallback(
          ort,
          new Uint8Array(detModelBuffer),
          this.options.session,
          (msg) => this.log(msg),
          (next) => (this.options.session = next)
        ),
        createSessionWithFallback(
          ort,
          new Uint8Array(recModelBuffer),
          this.options.session,
          (msg) => this.log(msg),
          (next) => (this.options.session = next)
        ),
        engine === "opencv" ? ImageProcessor.initRuntime() : Promise.resolve(),
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
        detectionSession,
        this.options.detection,
        this.options.debugging,
        engine
      );
      this.recognitor = new RecognitionService(
        recognitionSession,
        this.options.recognition,
        this.options.debugging,
        engine
      );

      if (this.options.model) this.options.model.detection = undefined;
      if (this.options.model) this.options.model.recognition = undefined;
    } catch (error) {
      console.error("Failed to initialize PaddleOcrService:", error);
      throw error;
    }
  }

  /**
   * Checks if the service has been initialized with models loaded.
   */
  public isInitialized(): boolean {
    return this.detectionSession !== null && this.recognitionSession !== null;
  }

  /**
   * Changes the detection model for the current instance.
   * @param model - The new detection model as a path, URL, or ArrayBuffer.
   */
  public async changeDetectionModel(model: ArrayBuffer | string): Promise<void> {
    this.log("Changing detection model...");
    const modelBuffer = await this._loadResource(model, DEFAULT_MODEL_URLS.detection);

    await this.detectionSession?.release();
    this.detectionSession = await createSessionWithFallback(
      ort,
      new Uint8Array(modelBuffer),
      this.options.session,
      (msg) => this.log(msg),
      (next) => (this.options.session = next)
    );
    this.detector = new DetectionService(
      this.detectionSession,
      this.options.detection,
      this.options.debugging,
      this.options.processing?.engine || "opencv"
    );
    if (this.options.model) this.options.model.detection = modelBuffer;
    this.log("Detection model changed successfully.");
  }

  /**
   * Changes the recognition model for the current instance.
   * @param model - The new recognition model as a path, URL, or ArrayBuffer.
   */
  public async changeRecognitionModel(model: ArrayBuffer | string): Promise<void> {
    this.log("Changing recognition model...");
    const modelBuffer = await this._loadResource(model, DEFAULT_MODEL_URLS.recognition);

    await this.recognitionSession?.release();
    this.recognitionSession = await createSessionWithFallback(
      ort,
      new Uint8Array(modelBuffer),
      this.options.session,
      (msg) => this.log(msg),
      (next) => (this.options.session = next)
    );
    this.recognitor = new RecognitionService(
      this.recognitionSession,
      this.options.recognition,
      this.options.debugging,
      this.options.processing?.engine || "opencv"
    );
    if (this.options.model) this.options.model.recognition = modelBuffer;
    this.log("Recognition model changed successfully.");
  }

  /**
   * Changes the text dictionary for the current instance.
   * @param dictionary - The new dictionary as a path, URL, ArrayBuffer, or string content.
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
   * Recognize text in an image, returning flattened results.
   *
   * @param image - Source image as `ArrayBuffer` or `Canvas`.
   * @param options - Must include `flatten: true`.
   * @returns Flat list of recognized text items.
   */
  public override recognize(
    image: ArrayBuffer | Canvas,
    options: RecognizeOptions & { flatten: true }
  ): Promise<FlattenedPaddleOcrResult>;

  /**
   * Recognize text in an image, returning line-grouped results.
   *
   * @param image - Source image as `ArrayBuffer` or `Canvas`.
   * @param options - Optional recognition options.
   * @returns OCR results grouped by detected text lines.
   */
  public override recognize(
    image: ArrayBuffer | Canvas,
    options?: RecognizeOptions & { flatten?: false }
  ): Promise<PaddleOcrResult>;

  public override async recognize(
    image: ArrayBuffer | Canvas,
    options?: RecognizeOptions
  ): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
    if (!this.isInitialized()) {
      throw new Error("PaddleOcrService is not initialized. Call initialize() first.");
    }

    let imageBuffer: ArrayBuffer;

    if (image instanceof ArrayBuffer) {
      imageBuffer = image;
    } else {
      if (typeof image.toBuffer === "function") {
        const buffer = image.toBuffer("image/png");
        imageBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer;
      } else {
        const ctx = image.getContext("2d");
        const imageData = ctx.getImageData(0, 0, image.width, image.height);
        const data = imageData.data;
        imageBuffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        ) as ArrayBuffer;
      }
    }

    const cacheKey = ImageCache.generateKey(imageBuffer);

    const cacheResult = (
      !options?.noCache && !options?.dictionary ? globalImageCache.get(cacheKey) : undefined
    ) as (PaddleOcrResult & Partial<FlattenedPaddleOcrResult>) | undefined;
    if (cacheResult) {
      this.log("Using cached OCR result");

      if (options?.flatten) {
        return {
          text: cacheResult.text,
          results: cacheResult.lines ? cacheResult.lines.flat() : (cacheResult.results ?? []),
          confidence: cacheResult.confidence,
        };
      }

      return cacheResult as PaddleOcrResult;
    }

    let charactersDictionary: string[] | undefined;
    if (options?.dictionary) {
      const dictBuffer = await this._loadResource(options.dictionary, "");
      charactersDictionary = parseDictionary(dictBuffer);

      if (charactersDictionary.length === 0) {
        throw new Error("Custom character dictionary is empty or could not be loaded.");
      }
    }

    const sourceCanvas =
      image instanceof ArrayBuffer ? await CanvasProcessor.prepareCanvas(image) : image;

    const strategy = options?.strategy ?? this.options.recognition?.strategy ?? "per-line";
    const detector = this.detector as NonNullable<BasePaddleOcrService["detector"]>;
    const recognitor = this.recognitor as NonNullable<BasePaddleOcrService["recognitor"]>;
    const detection = await detector.run(sourceCanvas);
    const recognition = await recognitor.run(
      sourceCanvas,
      detection,
      charactersDictionary,
      strategy
    );

    const processed = groupRecognitionResultsByLine(recognition);

    const result = options?.flatten
      ? {
          text: processed.text,
          results: recognition,
          confidence: processed.confidence,
        }
      : processed;

    if (!options?.noCache && !options?.dictionary) {
      globalImageCache.set(cacheKey, result);
    }

    return result as PaddleOcrResult | FlattenedPaddleOcrResult;
  }

  /**
   * Pre-download all default models to the local cache directory.
   * Call this before `initialize()` to avoid first-run download delays or
   * to warm the cache in CI/CD pipelines and test suites.
   */
  public static async downloadModels(options?: { verbose?: boolean }): Promise<void> {
    const verbose = options?.verbose ?? false;
    const urls = [
      DEFAULT_MODEL_URLS.detection,
      DEFAULT_MODEL_URLS.recognition,
      DEFAULT_MODEL_URLS.charactersDictionary,
    ];

    for (const url of urls) {
      await fetchAndCacheResource(url, verbose);
    }
  }

  /**
   * Delete all locally cached ONNX model files.
   */
  public clearModelCache(): void {
    if (existsSync(CACHE_DIR)) {
      this.log(`Clearing model cache at: ${CACHE_DIR}`);
      rmSync(CACHE_DIR, { recursive: true, force: true });
      console.log(`[PaddleOcrService] Model cache cleared: ${CACHE_DIR}`);
    } else {
      this.log("Cache directory does not exist, nothing to clear.");
    }
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
