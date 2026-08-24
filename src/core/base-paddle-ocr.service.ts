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
import { deepMerge, parseDictionary } from "../utils.js";
import { BaseDetectionService } from "./base-detection.service.js";
import type { BaseRecognitionService, RecognitionResult } from "./base-recognition.service.js";
import type { BatchItemResult } from "./batch.js";
import { createAsyncQueue, runPool } from "./batch.js";
import { cropDetectedBoxes } from "./detection/crop-boxes.js";
import { flattenResults, groupResultsByLine } from "./recognition/line-grouping.js";
import { globalImageCache, ImageCache } from "./image-cache.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";

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
  /** PNG-encoded crops, index-aligned with `boxes`. Present when `crop: true`. */
  crops?: ArrayBuffer[];
};

/** Accepted source for a single image in a batch. */
export type BatchRecognizeInput = ArrayBuffer | CoreCanvas | string;

/**
 * Abstract base class for platform-agnostic PaddleOCR service.
 *
 * Concrete implementations (`PaddleOcrService` for Node, Web, etc.)
 * extend this class and provide a {@link PlatformProvider}.
 */
export abstract class BasePaddleOcrService {
  protected options: PaddleOptions = DEFAULT_PADDLE_OPTIONS;

  protected detectionSession: InferenceSession | null = null;
  protected recognitionSession: InferenceSession | null = null;
  protected detector: BaseDetectionService | null = null;
  protected recognitor: BaseRecognitionService | null = null;

  protected readonly platform: PlatformProvider;

  public constructor(platform: PlatformProvider, options?: PaddleOptions) {
    this.platform = platform;
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
      let imageBuffer: ArrayBuffer;

      if (typeof image === "string") {
        if (!image.startsWith("http") && !image.startsWith("/")) {
          throw new Error(
            "Invalid image string format. Must be an HTTP URL, an absolute path, ArrayBuffer, or Canvas"
          );
        }
        imageBuffer = await this.platform.loadResource(image, image);
      } else if (image instanceof ArrayBuffer) {
        imageBuffer = image;
      } else {
        if (typeof (image as unknown as Record<string, unknown>).toBuffer === "function") {
          const canvasWithBuffer = image as { toBuffer: (format: string) => Buffer };
          const buffer = canvasWithBuffer.toBuffer("image/png");
          imageBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          ) as ArrayBuffer;
        } else {
          const canvasWithCtx = image as {
            getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
            width: number;
            height: number;
          };
          const ctx = canvasWithCtx.getContext("2d", {
            willReadFrequently: true,
          });
          const imageData = ctx.getImageData(0, 0, canvasWithCtx.width, canvasWithCtx.height);
          const data = imageData.data;
          imageBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
          ) as ArrayBuffer;
        }
      }

      const cacheKey = ImageCache.generateKey(imageBuffer);

      if (!options?.noCache && !options?.dictionary) {
        const cacheResult = globalImageCache.get(cacheKey) as
          | (PaddleOcrResult & Partial<FlattenedPaddleOcrResult>)
          | undefined;
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
      }

      let boxes: Box[] = [];
      const canvas =
        typeof image === "string" || image instanceof ArrayBuffer
          ? await this.platform.canvas.prepareCanvas(imageBuffer)
          : image;
      boxes = await (this.detector as BaseDetectionService).run(canvas);

      if (boxes.length === 0) {
        return options?.flatten
          ? { text: "", results: [], confidence: 0 }
          : { text: "", lines: [], confidence: 0 };
      }

      let dict = this.options.recognition?.charactersDictionary;

      if (options?.dictionary) {
        let dictionaryContent = "";

        if (typeof options.dictionary === "string") {
          const dictBuffer = await this.platform.loadResource(
            options.dictionary,
            options.dictionary
          );
          dictionaryContent = new TextDecoder("utf-8").decode(dictBuffer);
        } else {
          dictionaryContent = new TextDecoder("utf-8").decode(options.dictionary);
        }

        dict = parseDictionary(dictionaryContent);
      }

      const strategy = options?.strategy ?? this.options.recognition?.strategy ?? "per-line";
      const results = await (this.recognitor as BaseRecognitionService).run(
        canvas,
        boxes,
        dict,
        strategy
      );
      const groupedResult = groupResultsByLine(results);

      const finalResult = options?.flatten ? flattenResults(results) : groupedResult;

      if (!options?.noCache && !options?.dictionary) {
        globalImageCache.set(cacheKey, finalResult);
      }

      return finalResult;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("recognize: error", err.message, err.stack);
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

    const { crop, saveCropsTo, ...tuning } = options ?? {};
    const detector =
      Object.keys(tuning).length > 0
        ? new BaseDetectionService(
            this.platform,
            this.detectionSession as InferenceSession,
            { ...this.options.detection, ...tuning },
            this.options.debugging,
            this.options.processing?.engine ?? DEFAULT_PROCESSING_ENGINE
          )
        : (this.detector as BaseDetectionService);

    let canvas: CoreCanvas;
    if (typeof image === "string") {
      if (!image.startsWith("http") && !image.startsWith("/")) {
        throw new Error(
          "Invalid image string format. Must be an HTTP URL, an absolute path, ArrayBuffer, or Canvas"
        );
      }
      canvas = await this.platform.canvas.prepareCanvas(
        await this.platform.loadResource(image, image)
      );
    } else if (image instanceof ArrayBuffer) {
      canvas = await this.platform.canvas.prepareCanvas(image);
    } else {
      canvas = image;
    }

    const boxes = (await detector.run(canvas)).filter((box) => box.width > 0 && box.height > 0);

    if (!crop && !saveCropsTo) {
      return { boxes };
    }

    const crops = await cropDetectedBoxes(this.platform, canvas, boxes, { crop, saveCropsTo });

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
        concurrency: this.resolveConcurrency(options?.concurrency),
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
            concurrency: this.resolveConcurrency(options?.concurrency),
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

  /**
   * Resolve the effective concurrency. `"auto"` (or unset) yields `1` when an
   * accelerator execution provider is configured, else a small CPU default.
   */
  private resolveConcurrency(value?: number | "auto"): number {
    if (typeof value === "number" && value > 0) return Math.floor(value);

    const providers = this.options.session?.executionProviders ?? [];
    const usesAccelerator = providers.some((provider) => {
      const name = (typeof provider === "string" ? provider : provider.name).toLowerCase();
      return name !== "cpu" && name !== "wasm";
    });

    return usesAccelerator ? 1 : 4;
  }

  /**
   * Returns true once both detection and recognition sessions are loaded.
   */
  public isInitialized(): boolean {
    return this.detectionSession !== null && this.recognitionSession !== null;
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
