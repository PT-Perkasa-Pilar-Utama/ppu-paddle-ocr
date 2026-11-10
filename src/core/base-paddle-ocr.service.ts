// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession } from "onnxruntime-common";
import { DEFAULT_PADDLE_OPTIONS, DEFAULT_PROCESSING_ENGINE } from "../constants.js";
import type {
  BatchRecognizeOptions,
  Box,
  DetectOptions,
  PaddleOptions,
  RecognizeOptions,
} from "../interface.js";
import { UNWARPING_MODEL_URL } from "../model-catalogue.js";
import { deepMerge } from "../utils.js";
import { BaseDetectionService } from "./base-detection.service.js";
import type { BaseRecognitionService, RecognitionResult } from "./base-recognition.service.js";
import type { BatchItemResult } from "./batch.js";
import { createAsyncQueue, resolveConcurrency, runPool } from "./batch.js";
import { cropDetectedBoxes } from "./detection/crop-boxes.js";
import { loadCustomDictionary } from "./recognition/custom-dictionary.js";
import { flattenResults, groupResultsByLine } from "./recognition/line-grouping.js";
import { bypassesCache, cacheIdentity, globalImageCache, ImageCache } from "./image-cache.js";
import { readImageBytes, toCanvas } from "./image-source.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";
import type { UnwarpResult } from "./unwarping/unwarping.service.js";
import { UnwarpingService } from "./unwarping/unwarping.service.js";

/**
 * OCR result grouped by detected text lines.
 *
 * Each entry in `lines` is an array of recognized words on the same line,
 * sorted left-to-right.
 */
export type PaddleOcrResult = {
  /** Full extracted text with lines separated by newlines. */
  text: string;
  /** Recognition results grouped by line, in reading order. */
  lines: RecognitionResult[][];
  /** Average confidence across all recognized items (0-1). */
  confidence: number;
};

/**
 * OCR result as a flat list of recognized text items.
 *
 * Convenience alternative to {@link PaddleOcrResult} when line grouping
 * is not needed (e.g. for search indexing or simple display).
 */
export type FlattenedPaddleOcrResult = {
  /** Full extracted text as a single space-separated string. */
  text: string;
  /** All recognized items in reading order. */
  results: RecognitionResult[];
  /** Average confidence across all recognized items (0-1). */
  confidence: number;
};

/** A single OCR result, grouped or flattened depending on `flatten`. */
export type AnyOcrResult = PaddleOcrResult | FlattenedPaddleOcrResult;

/** Result of a detection-only run. */
export type DetectResult = {
  /** Detected text boxes in original image coordinates. */
  boxes: Box[];
  /**
   * PNG-encoded crops, index-aligned with `boxes`. Present when `crop: true`.
   * With unwarping applied they are cut from the flattened page, so a crop
   * shows the straightened text of its box.
   */
  crops?: ArrayBuffer[];
};

/** Loads a model or dictionary from a buffer, a path or URL, or the default URL. */
export type ResourceLoader = (
  source: string | ArrayBuffer | undefined,
  defaultUrl: string
) => Promise<ArrayBuffer>;

/** Accepted source for a single image in a batch. */
export type BatchRecognizeInput = ArrayBuffer | CoreCanvas | string;

/**
 * Abstract base class for platform-agnostic PaddleOCR service.
 *
 * Concrete implementations (`PaddleOcrService` for Node, Web, etc.)
 * extend this class and provide a {@link PlatformProvider}.
 */
/**
 * Reads the detector after an initialize() guard has already run.
 *
 * SAFETY: initialize() constructs the detector, and every caller checks
 * `isInitialized` before reaching here, so the field is set.
 */
function initializedDetector(detector: BaseDetectionService | null): BaseDetectionService {
  // SAFETY: see the contract above; callers guard on isInitialized first.
  return detector as BaseDetectionService;
}

export abstract class BasePaddleOcrService {
  protected options: PaddleOptions = DEFAULT_PADDLE_OPTIONS;

  protected detectionSession: InferenceSession | null = null;
  protected recognitionSession: InferenceSession | null = null;
  protected detector: BaseDetectionService | null = null;
  protected recognitor: BaseRecognitionService | null = null;
  protected unwarpingSession: InferenceSession | null = null;
  protected unwarper: UnwarpingService | null = null;

  protected readonly platform: PlatformProvider;

  public constructor(platform: PlatformProvider, options?: PaddleOptions) {
    this.platform = platform;
    // SAFETY: deepMerge walks an arbitrary option tree, so it is typed over
    // Record<string, unknown>. Both inputs are PaddleOptions and the merge only
    // copies keys, so the result carries the same shape back out.
    this.options = deepMerge(
      {},
      DEFAULT_PADDLE_OPTIONS as unknown as Record<string, unknown>,
      options as unknown as Record<string, unknown>
    ) as unknown as PaddleOptions;
    this.options.session = this.options.session || DEFAULT_PADDLE_OPTIONS.session;
  }

  protected log(message: string): void {
    if (this.options.debugging?.verbose) {
      console.log(`[PaddleOcrService:Base] ${message}`);
    }
  }

  protected abstract initSessions(): Promise<void>;

  /**
   * Returns whether every inference session the options ask for is ready:
   * detection and recognition, plus unwarping when it is enabled.
   */
  public isInitialized(): boolean {
    return (
      this.detectionSession !== null &&
      this.recognitionSession !== null &&
      (!this.options.unwarping?.enabled || this.unwarpingSession !== null)
    );
  }

  /** Release all inference sessions and services. */
  public async destroy(): Promise<void> {
    await this.detectionSession?.release();
    await this.recognitionSession?.release();
    await this.unwarpingSession?.release();
    this.detectionSession = null;
    this.recognitionSession = null;
    this.unwarpingSession = null;
    this.detector = null;
    this.recognitor = null;
    this.unwarper = null;
  }

  /**
   * Load the unwarping model when `unwarping.enabled` is set; a no-op otherwise.
   *
   * Each platform's `initialize()` calls this with its own loader and session
   * factory, so the model source, the default URL, and the service wiring are
   * decided here once.
   */
  protected async initializeUnwarping(
    loadResource: ResourceLoader,
    createSession: (modelData: Uint8Array) => Promise<InferenceSession>
  ): Promise<void> {
    if (!this.options.unwarping?.enabled) return;

    const modelBuffer = await loadResource(this.options.model?.unwarping, UNWARPING_MODEL_URL);
    this.unwarpingSession = await createSession(new Uint8Array(modelBuffer));
    this.unwarper = new UnwarpingService(
      this.platform,
      this.unwarpingSession,
      this.options.debugging
    );
    this.log(
      `Unwarping ONNX model loaded successfully\n\tinput: ${this.unwarpingSession.inputNames}\n\toutput: ${this.unwarpingSession.outputNames}`
    );
  }

  /**
   * Flatten a photo of a curled, folded, or tilted page.
   *
   * The same stage `recognize()` and `detect()` run when unwarping is on,
   * exposed for callers that want the flattened image itself. Requires
   * `unwarping: { enabled: true }` in the constructor options.
   *
   * @param image - The source image as an `ArrayBuffer`, platform canvas, or URL/path string.
   * @returns The flattened page with a map back to the photo, or the input
   *   unchanged with the reason the correction was skipped.
   */
  public async unwarp(image: ArrayBuffer | CoreCanvas | string): Promise<UnwarpResult> {
    return this.requireUnwarper().run(await toCanvas(this.platform, image));
  }

  private requireUnwarper(): UnwarpingService {
    if (!this.unwarper) {
      throw new Error(
        "Unwarping is not available on this service. Construct it with `unwarping: { enabled: true }` and call initialize()."
      );
    }
    return this.unwarper;
  }

  /**
   * Run the unwarping stage when the call asks for it, else return null.
   *
   * A per-call `unwarp` wins over the constructor's `unwarping.enabled`. The
   * page is redrawn from a copy no larger than recognition's crop-source cap,
   * so no pixel is computed that recognition would scale away.
   */
  private async runUnwarping(
    canvas: CoreCanvas,
    perCall: boolean | undefined
  ): Promise<UnwarpResult | null> {
    if (!this.wantsUnwarping(perCall)) return null;
    return this.requireUnwarper().run(canvas, this.options.recognition?.maxCropSourceSideLength);
  }

  private wantsUnwarping(perCall: boolean | undefined): boolean {
    return perCall ?? this.options.unwarping?.enabled ?? false;
  }

  /**
   * Cache key for one image on this service.
   *
   * The image hash alone is not enough: the cache is shared by every service
   * in the process, and the same image reads differently under another model,
   * another dictionary, or with unwarping on. The key therefore also names the
   * sessions and dictionary in use (by object identity, so swapping a model
   * retires its entries) and whether the page is flattened first.
   */
  private cacheKeyFor(imageBuffer: ArrayBuffer, unwarp: boolean): string {
    return [
      ImageCache.generateKey(imageBuffer),
      cacheIdentity(this.detectionSession),
      cacheIdentity(this.recognitionSession),
      cacheIdentity(this.options.recognition?.charactersDictionary),
      unwarp ? cacheIdentity(this.unwarpingSession) : "plain",
    ].join("|");
  }

  /**
   * Run the full OCR pipeline (detection → recognition) on an image.
   *
   * @param image - The source image as an `ArrayBuffer`, platform canvas, or URL/path string.
   * @param options - Per-call options such as `flatten`, `noCache`, and custom `dictionary`.
   * @returns Grouped or flattened OCR results depending on `options.flatten`.
   */
  public async recognize(
    image: ArrayBuffer | CoreCanvas | string,
    options?: RecognizeOptions
  ): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
    if (!this.detector || !this.recognitor) {
      await this.initSessions();
    }

    try {
      const imageBuffer = await readImageBytes(this.platform, image);

      const cacheKey = this.cacheKeyFor(imageBuffer, this.wantsUnwarping(options?.unwarp));

      if (!bypassesCache(options)) {
        // SAFETY: the cache is keyed by this method's own cacheKey, and only
        // this method writes it, always with the grouped shape.
        const cacheResult = globalImageCache.get(cacheKey) as PaddleOcrResult | undefined;
        if (cacheResult) {
          this.log("Using cached OCR result");
          return options?.flatten
            ? {
                text: cacheResult.text,
                results: cacheResult.lines.flat(),
                confidence: cacheResult.confidence,
              }
            : cacheResult;
        }
      }

      const sourceCanvas =
        typeof image === "string" || image instanceof ArrayBuffer
          ? await this.platform.canvas.prepareCanvas(imageBuffer)
          : image;
      const unwarped = await this.runUnwarping(sourceCanvas, options?.unwarp);
      const canvas = unwarped ? unwarped.canvas : sourceCanvas;
      // SAFETY: initialize() constructs the detector before any recognize call,
      // and the guard at the top of this method rejects an uninitialized service.
      const boxes = await (this.detector as BaseDetectionService).run(canvas);

      if (boxes.length === 0) {
        return options?.flatten
          ? { text: "", results: [], confidence: 0 }
          : { text: "", lines: [], confidence: 0 };
      }

      const dict = options?.dictionary
        ? await loadCustomDictionary(this.platform, options.dictionary)
        : this.options.recognition?.charactersDictionary;

      const strategy = options?.strategy ?? this.options.recognition?.strategy ?? "per-line";
      // SAFETY: as with the detector, initialize() sets this and the guard at
      // the top of the method rejects an uninitialized service.
      const results = await (this.recognitor as BaseRecognitionService).run(
        canvas,
        boxes,
        dict,
        strategy,
        options
      );
      // Lines are grouped on the image the text was read from: on a flattened
      // page they are straight, which the grouping relies on. Only then do the
      // boxes move back to the caller's photo.
      const mapping = unwarped?.status === "unwarped" ? unwarped.mapping : null;
      const grouped = groupResultsByLine(results);
      // Without a mapping the page was not flattened and the boxes are
      // already in photo coordinates.
      const toSource = (items: RecognitionResult[]): RecognitionResult[] =>
        mapping ? mapping.itemsToSource(items) : items;
      const groupedResult: PaddleOcrResult = { ...grouped, lines: grouped.lines.map(toSource) };

      // The cache always holds the grouped shape, whichever shape this call
      // returns: a later call reads the entry without knowing who wrote it.
      if (!bypassesCache(options)) {
        globalImageCache.set(cacheKey, groupedResult);
      }

      if (!options?.flatten) return groupedResult;
      const flattened = flattenResults(results);
      return { ...flattened, results: toSource(flattened.results) };
    } catch (e: unknown) {
      if (this.options.debugging?.verbose) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error("recognize: error", err.message, err.stack);
      }
      throw e;
    }
  }

  /**
   * Run text detection only (no recognition) on an image.
   *
   * @param image - The source image as an `ArrayBuffer`, platform canvas, or URL/path string.
   * @param options - Any {@link DetectionOptions} tuning field to override for
   *   this call, plus `crop: true` to return each region as a PNG `ArrayBuffer`
   *   and/or `saveCropsTo` to write the crops to a folder (Node/Bun only).
   * @returns Detected boxes in original image coordinates, plus crops when requested.
   */
  public async detect(
    image: ArrayBuffer | CoreCanvas | string,
    options?: DetectOptions
  ): Promise<DetectResult> {
    if (!this.detector) {
      await this.initSessions();
    }

    const { crop, saveCropsTo, unwarp, ...tuning } = options ?? {};
    const detector =
      Object.keys(tuning).length > 0
        ? new BaseDetectionService(
            this.platform,
            // SAFETY: guarded by the same initialize() check as the detector.
            this.detectionSession as InferenceSession,
            { ...this.options.detection, ...tuning },
            this.options.debugging,
            this.options.processing?.engine ?? DEFAULT_PROCESSING_ENGINE
          )
        : initializedDetector(this.detector);

    const sourceCanvas = await toCanvas(this.platform, image);
    const unwarped = await this.runUnwarping(sourceCanvas, unwarp);
    const canvas = unwarped ? unwarped.canvas : sourceCanvas;
    const mapping = unwarped?.status === "unwarped" ? unwarped.mapping : null;

    const detected = (await detector.run(canvas)).filter((box) => box.width > 0 && box.height > 0);
    const boxes = mapping ? detected.map((box) => mapping.boxToSource(box)) : detected;

    if (!crop && !saveCropsTo) {
      return { boxes };
    }

    // Crops are cut from the image the boxes were found on, so `detected`, not
    // the boxes mapped back to the photo.
    const crops = await cropDetectedBoxes(this.platform, canvas, detected, { crop, saveCropsTo });

    return crop ? { boxes, crops } : { boxes };
  }

  /**
   * Run {@link recognize} over many images with bounded concurrency.
   *
   * Results are returned index-aligned to the inputs regardless of completion
   * order. Memory stays bounded: at most `concurrency` images are decoded and
   * in flight at once, so a large (or streamed) input set never materializes
   * all at once. See {@link BatchRecognizeOptions} for `settle`, `signal`, and
   * `onProgress`.
   *
   * @param images - An array or (async) iterable of image sources.
   * @param options - Per-image recognize options plus batch controls.
   */
  public batchRecognize(
    images: Iterable<BatchRecognizeInput> | AsyncIterable<BatchRecognizeInput>,
    options: BatchRecognizeOptions & { settle: true }
  ): Promise<BatchItemResult<AnyOcrResult>[]>;
  public batchRecognize(
    images: Iterable<BatchRecognizeInput> | AsyncIterable<BatchRecognizeInput>,
    options?: BatchRecognizeOptions
  ): Promise<AnyOcrResult[]>;
  public async batchRecognize(
    images: Iterable<BatchRecognizeInput> | AsyncIterable<BatchRecognizeInput>,
    options?: BatchRecognizeOptions
  ): Promise<AnyOcrResult[] | BatchItemResult<AnyOcrResult>[]> {
    const settle = options?.settle ?? false;
    const collected: BatchItemResult<AnyOcrResult>[] = [];

    await runPool<BatchRecognizeInput, AnyOcrResult>(
      images,
      {
        concurrency: resolveConcurrency(
          options?.concurrency,
          this.options.session?.executionProviders
        ),
        settle,
        signal: options?.signal,
        onProgress: options?.onProgress,
        total: Array.isArray(images) ? images.length : undefined,
      },
      (image) => this.recognize(image, options),
      (result) => {
        collected[result.index] = result;
      }
    );

    if (settle) return collected;
    // SAFETY: unreachable. Without `settle`, runPool rethrows the first
    // rejection, so a rejected entry cannot reach this map.
    return collected.map((item) =>
      item.status === "fulfilled" ? item.value : (undefined as never)
    );
  }

  /**
   * Streaming variant of {@link batchRecognize}: yields each image's result as
   * soon as it finishes (completion order), so callers needn't buffer the whole
   * batch. Each item carries its input `index` for reordering.
   *
   * With `settle: false` (default) the generator throws on the first image
   * failure; with `settle: true` failures arrive as `{ status: "rejected" }`.
   */
  public async *batchRecognizeStream(
    images: Iterable<BatchRecognizeInput> | AsyncIterable<BatchRecognizeInput>,
    options?: BatchRecognizeOptions
  ): AsyncGenerator<BatchItemResult<AnyOcrResult>> {
    const queue = createAsyncQueue<BatchItemResult<AnyOcrResult>>();

    const pump = (async () => {
      try {
        await runPool<BatchRecognizeInput, AnyOcrResult>(
          images,
          {
            concurrency: resolveConcurrency(
              options?.concurrency,
              this.options.session?.executionProviders
            ),
            settle: options?.settle ?? false,
            signal: options?.signal,
            onProgress: options?.onProgress,
            total: Array.isArray(images) ? images.length : undefined,
          },
          (image) => this.recognize(image, options),
          (result) => queue.push(result)
        );
        queue.close();
      } catch (error) {
        queue.fail(error);
      }
    })();

    yield* queue.drain();
    await pump;
  }
}
