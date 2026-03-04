import type { InferenceSession } from "onnxruntime-common";
import { DEFAULT_PADDLE_OPTIONS } from "../constants.js";
import type { Box, PaddleOptions, RecognizeOptions } from "../interface.js";
import { deepMerge } from "../utils.js";
import { BaseDetectionService } from "./base-detection.service.js";
import {
    BaseRecognitionService,
    type RecognitionResult,
} from "./base-recognition.service.js";
import { globalImageCache, ImageCache } from "./image-cache.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";

export interface PaddleOcrResult {
  text: string;
  lines: RecognitionResult[][];
  confidence: number;
}

export interface FlattenedPaddleOcrResult {
  text: string;
  results: RecognitionResult[];
  confidence: number;
}

export const GITHUB_BASE_URL =
  "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/main/models/";

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
      options as unknown as Record<string, unknown>,
    ) as unknown as PaddleOptions;
    this.options.session =
      this.options.session || DEFAULT_PADDLE_OPTIONS.session;
  }

  protected log(message: string): void {
    if (this.options.debugging?.verbose) {
      console.log(`[PaddleOcrService:Base] ${message}`);
    }
  }

  protected abstract initSessions(): Promise<void>;

  /**
   * Run the full OCR pipeline (Detection + Recognition) on an image
   */
  public async recognize(
    image: ArrayBuffer | CoreCanvas | string,
    options?: RecognizeOptions,
  ): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
    if (!this.detector || !this.recognitor) {
      await this.initSessions();
    }

    try {
      let imageBuffer: ArrayBuffer;
      let canvas: CoreCanvas;

      if (typeof image === "string") {
        if (!image.startsWith("http") && !image.startsWith("/")) {
          throw new Error(
            "Invalid image string format. Must be an HTTP URL, an absolute path, ArrayBuffer, or Canvas",
          );
        }
        imageBuffer = await this.platform.loadResource(image, image);
        canvas = await this.platform.imageProcessor.prepareCanvas(imageBuffer);
      } else if (image instanceof ArrayBuffer) {
        imageBuffer = image;
        canvas = await this.platform.imageProcessor.prepareCanvas(imageBuffer);
      } else {
        canvas = image;
        if (typeof (image as any).toBuffer === "function") {
          const buffer = (image as any).toBuffer("image/png");
          imageBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer;
        } else {
          const ctx = (image as any).getContext("2d", { willReadFrequently: true });
          const imageData = ctx.getImageData(
            0,
            0,
            (image as any).width,
            (image as any).height,
          );
          const data = imageData.data;
          imageBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
        }
      }

      const cacheKey = ImageCache.generateKey(imageBuffer);

      if (!options?.noCache && !options?.dictionary) {
        const cacheResult = globalImageCache.get(cacheKey);
        if (cacheResult) {
          this.log("Using cached OCR result");
          if (options?.flatten) {
            return {
              text: cacheResult.text,
              results: cacheResult.lines
                ? cacheResult.lines.flat()
                : cacheResult.results,
              confidence: cacheResult.confidence,
            };
          }
          return cacheResult as PaddleOcrResult;
        }
      }

      let boxes: Box[] = [];
      boxes = await this.detector!.run(canvas);

      if (boxes.length === 0) {
        return options?.flatten
          ? { text: "", results: [], confidence: 0 }
          : { text: "", lines: [], confidence: 0 };
      }

      let dict = this.options.recognition!.charactersDictionary;

      if (options?.dictionary) {
        let dictionaryContent = "";

        if (typeof options.dictionary === "string") {
          const dictBuffer = await this.platform.loadResource(
            options.dictionary,
            options.dictionary,
          );
          dictionaryContent = new TextDecoder("utf-8").decode(dictBuffer);
        } else {
          dictionaryContent = new TextDecoder("utf-8").decode(
            options.dictionary,
          );
        }

        dict = dictionaryContent
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }

      const results = await this.recognitor!.run(canvas, boxes, dict);

      const groupedResult = this.groupResultsByLine(results);

      const finalResult = options?.flatten
        ? this.flattenResults(results)
        : groupedResult;

      if (!options?.noCache && !options?.dictionary) {
        globalImageCache.set(cacheKey, finalResult);
      }

      return finalResult;
    } catch (e: any) {
      console.error("recognize: error", e.message, e.stack);
      throw e;
    }
  }

  public async deskewImage(
    image: ArrayBuffer | CoreCanvas | string,
  ): Promise<CoreCanvas> {
    if (!this.detector || !this.recognitor) {
      await this.initSessions();
    }

    let imageBuffer: ArrayBuffer | CoreCanvas;

    if (typeof image === "string") {
      if (!image.startsWith("http") && !image.startsWith("/")) {
        throw new Error(
          "Invalid image string format. Must be an HTTP URL, an absolute path, ArrayBuffer, or Canvas",
        );
      }
      imageBuffer = await this.platform.loadResource(image, image);
    } else {
      imageBuffer = image;
    }

    const canvas = this.platform.isCanvas(imageBuffer)
      ? imageBuffer
      : await this.platform.imageProcessor.prepareCanvas(imageBuffer);

    const deskewed = await this.detector!.deskew(canvas);
    return deskewed;
  }

  private flattenResults(
    results: RecognitionResult[],
  ): FlattenedPaddleOcrResult {
    if (results.length === 0) {
      return { text: "", results: [], confidence: 0 };
    }

    const text = results.map((r) => r.text).join(" ");
    const avgConfidence =
      results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

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
    let currentY = results[0]!.box.y;
    let avgHeight = results[0]!.box.height;

    for (const result of results) {
      const { box } = result;

      if (Math.abs(box.y - currentY) < avgHeight / 2) {
        currentLine.push(result);
        avgHeight =
          (avgHeight * (currentLine.length - 1) + box.height) /
          currentLine.length;
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

    const fullText = lines
      .map((line) => line.map((r) => r.text).join(" "))
      .join("\n");

    const totalConfidence = lines.reduce(
      (sum, line) => sum + line.reduce((s, r) => s + r.confidence, 0),
      0,
    );
    const totalItems = lines.reduce((sum, line) => sum + line.length, 0);

    return {
      text: fullText,
      lines,
      confidence: totalItems > 0 ? totalConfidence / totalItems : 0,
    };
  }
}
