import type { InferenceSession } from "onnxruntime-common";
import { CanvasProcessor } from "ppu-ocv/canvas";
import { DEFAULT_PADDLE_OPTIONS } from "../constants.js";
import type { Box, PaddleOptions, RecognizeOptions } from "../interface.js";
import { deepMerge } from "../utils.js";
import type { BaseDetectionService } from "./base-detection.service.js";
import type { BaseRecognitionService } from "./base-recognition.service.js";
import type { RecognitionResult } from "./base-recognition.service.js";
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
  /** Average confidence across all recognized items (0–1). */
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
  /** Average confidence across all recognized items (0–1). */
  confidence: number;
};

/** Base URL for downloading default PaddleOCR model files from GitHub. */
export const MODEL_BASE_URL =
  "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";

/** Base URL for downloading default PaddleOCR dictionary files from GitHub. */
export const DICT_BASE_URL =
  "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main";

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
        if (typeof (image as Record<string, unknown>).toBuffer === "function") {
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
          ? await CanvasProcessor.prepareCanvas(imageBuffer)
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

        dict = dictionaryContent
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }

      const strategy = this.options.recognition?.strategy ?? "per-line";
      const results = await (this.recognitor as BaseRecognitionService).run(
        canvas,
        boxes,
        dict,
        strategy
      );
      const groupedResult = this.groupResultsByLine(results);

      const finalResult = options?.flatten ? this.flattenResults(results) : groupedResult;

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

  private flattenResults(results: RecognitionResult[]): FlattenedPaddleOcrResult {
    if (results.length === 0) {
      return { text: "", results: [], confidence: 0 };
    }

    const text = results.map((r) => r.text).join(" ");
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    return {
      text,
      results,
      confidence: avgConfidence,
    };
  }

  private groupResultsByLine(results: RecognitionResult[]): PaddleOcrResult {
    if (results.length === 0) {
      return { text: "", lines: [], confidence: 0 };
    }

    const lines: RecognitionResult[][] = [];
    let currentLine: RecognitionResult[] = [];
    const firstResult = results[0];
    if (!firstResult) return { text: "", lines: [], confidence: 0 };
    let currentY = firstResult.box.y;
    let avgHeight = firstResult.box.height;

    for (const result of results) {
      const { box } = result;

      if (Math.abs(box.y - currentY) < avgHeight / 2) {
        currentLine.push(result);
        avgHeight = (avgHeight * (currentLine.length - 1) + box.height) / currentLine.length;
      } else {
        currentLine.sort((a, b) => a.box.x - b.box.x);
        lines.push(currentLine);
        currentLine = [result];
        currentY = box.y;
        avgHeight = box.height;
      }
    }

    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.box.x - b.box.x);
      lines.push(currentLine);
    }

    const fullText = lines.map((line) => line.map((r) => r.text).join(" ")).join("\n");

    const totalConfidence = lines.reduce(
      (sum, line) => sum + line.reduce((s, r) => s + r.confidence, 0),
      0
    );
    const totalItems = lines.reduce((sum, line) => sum + line.length, 0);

    return {
      text: fullText,
      lines,
      confidence: totalItems > 0 ? totalConfidence / totalItems : 0,
    };
  }
}
