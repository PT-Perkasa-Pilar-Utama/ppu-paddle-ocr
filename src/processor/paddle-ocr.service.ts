import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as ort from "onnxruntime-node";
import * as os from "os";
import * as path from "path";
import type { Canvas } from "ppu-ocv";
import { ImageProcessor } from "ppu-ocv";
import { CanvasProcessor } from "ppu-ocv/canvas";

import {
  BasePaddleOcrService,
  DICT_BASE_URL,
  MODEL_BASE_URL,
} from "../core/base-paddle-ocr.service.js";
import { globalImageCache, ImageCache } from "../core/image-cache.js";
import type { PaddleOptions, RecognizeOptions } from "../interface.js";
import type { FlattenedPaddleOcrResult, PaddleOcrResult } from "../web/paddle-ocr.service.web.js";
import { DetectionService } from "./detection.service.js";
import { NodePlatformProvider } from "./platform.node.js";
import { RecognitionService } from "./recognition.service.js";
import type { RecognitionResult } from "./recognition.service.js";

const CACHE_DIR = path.join(os.homedir(), ".cache", "ppu-paddle-ocr");

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
    const fileName = path.basename(new URL(url).pathname);
    const cachePath = path.join(CACHE_DIR, fileName);

    if (existsSync(cachePath)) {
      this.log(`Loading cached resource from: ${cachePath}`);
      const buf = readFileSync(cachePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }

    console.log(
      `[PaddleOcrService] Downloading resource: ${fileName}\n` +
        `                 Cached at: ${CACHE_DIR}`
    );
    this.log(`Fetching resource from URL: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch resource from ${url}`);
    }
    if (!response.body) {
      throw new Error("Response body is null or undefined");
    }

    const contentLength = response.headers.get("Content-Length");
    const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
    let receivedLength = 0;
    const chunks: Uint8Array[] = [];

    const reader = response.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      receivedLength += value.length;

      if (totalLength > 0) {
        const percentage = ((receivedLength / totalLength) * 100).toFixed(2);
        process.stdout.write(`\rDownloading... ${percentage}%`);
      }
    }
    process.stdout.write("\n"); // Move to the next line

    const buffer = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, position);
      position += chunk.length;
    }

    this.log(`Caching resource to: ${cachePath}`);
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(cachePath, Buffer.from(buffer));

    return buffer.buffer;
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

      // Load detection model
      const detModelBuffer = await this._loadResource(
        this.options.model?.detection,
        `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`
      );

      // Use configured session options
      this.detectionSession = await ort.InferenceSession.create(
        new Uint8Array(detModelBuffer),
        this.options.session ?? {}
      );
      if (this.options.model) this.options.model.detection = detModelBuffer;
      this.log(
        `Detection ONNX model loaded successfully\n\tinput: ${this.detectionSession.inputNames}\n\toutput: ${this.detectionSession.outputNames}`
      );

      // Load recognition model
      const recModelBuffer = await this._loadResource(
        this.options.model?.recognition,
        `${MODEL_BASE_URL}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.onnx`
      );
      this.recognitionSession = await ort.InferenceSession.create(
        new Uint8Array(recModelBuffer),
        this.options.session ?? {}
      );
      if (this.options.model) this.options.model.recognition = recModelBuffer;
      this.log(
        `Recognition ONNX model loaded successfully\n\tinput: ${this.recognitionSession.inputNames}\n\toutput: ${this.recognitionSession.outputNames}`
      );

      // Load character dictionary
      const dictBuffer = await this._loadResource(
        this.options.model?.charactersDictionary,
        `${DICT_BASE_URL}/recognition/multi/en/v5/ppocrv5_en_dict.txt`
      );
      const dictionaryContent = Buffer.from(dictBuffer).toString("utf-8");
      const charactersDictionary = dictionaryContent.split("\n");

      if (charactersDictionary.length === 0) {
        throw new Error("Character dictionary is empty or could not be loaded.");
      }

      if (this.options.model) this.options.model.charactersDictionary = dictBuffer;
      if (this.options.recognition)
        this.options.recognition.charactersDictionary = charactersDictionary;
      this.log(`Character dictionary loaded with ${charactersDictionary.length} entries.`);

      const engine = this.options.processing?.engine || "opencv";

      // Eagerly initialize OpenCV WASM runtime when using the opencv engine.
      // Without this, the first OpenCV operation triggers a lazy synchronous
      // import + WASM compilation of @techstark/opencv-js, causing a severe
      // performance regression (3-6x slower first inference).
      if (engine === "opencv") {
        await ImageProcessor.initRuntime();
        this.log("OpenCV runtime initialized.");
      }

      this.detector = new DetectionService(
        this.detectionSession as NonNullable<typeof this.detectionSession>,
        this.options.detection,
        this.options.debugging,
        engine
      );
      this.recognitor = new RecognitionService(
        this.recognitionSession as NonNullable<typeof this.recognitionSession>,
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
    const modelBuffer = await this._loadResource(
      model,
      `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`
    );

    await this.detectionSession?.release();
    this.detectionSession = await ort.InferenceSession.create(
      new Uint8Array(modelBuffer),
      this.options.session ?? {}
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
    const modelBuffer = await this._loadResource(
      model,
      `${MODEL_BASE_URL}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.onnx`
    );

    await this.recognitionSession?.release();
    this.recognitionSession = await ort.InferenceSession.create(
      new Uint8Array(modelBuffer),
      this.options.session ?? {}
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
      `${DICT_BASE_URL}/recognition/multi/en/v5/ppocrv5_en_dict.txt`
    );

    const dictionaryContent = Buffer.from(dictBuffer).toString("utf-8");
    const charactersDictionary = dictionaryContent.split("\n");

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
      const dictionaryContent = Buffer.from(dictBuffer).toString("utf-8");
      charactersDictionary = dictionaryContent.split("\n");

      if (charactersDictionary.length === 0) {
        throw new Error("Custom character dictionary is empty or could not be loaded.");
      }
    }

    const sourceCanvas =
      image instanceof ArrayBuffer ? await CanvasProcessor.prepareCanvas(image) : image;

    const strategy = this.options.recognition?.strategy ?? "per-line";
    const detection = await (this.detector as NonNullable<typeof this.detector>).run(sourceCanvas);
    const recognition = await (this.recognitor as NonNullable<typeof this.recognitor>).run(
      sourceCanvas,
      detection,
      charactersDictionary,
      strategy
    );

    // Grouping the recognition result logic to build lines
    const processed = this.processRecognition(recognition);

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

  private processRecognition(recognition: RecognitionResult[]): PaddleOcrResult {
    const result: PaddleOcrResult = {
      text: "",
      lines: [],
      confidence: 0,
    };

    if (!recognition.length) {
      return result;
    }

    const totalConfidence = recognition.reduce((sum, r) => sum + r.confidence, 0);
    result.confidence = totalConfidence / recognition.length;

    const firstRec = recognition[0];
    if (!firstRec) return result;
    let currentLine: RecognitionResult[] = [firstRec];
    let fullText = firstRec.text;
    let avgHeight = firstRec.box.height;

    for (let i = 1; i < recognition.length; i++) {
      const current = recognition[i];
      const previous = recognition[i - 1];
      if (!current || !previous) continue;

      const verticalGap = Math.abs(current.box.y - previous.box.y);
      const threshold = avgHeight * 0.5;

      if (verticalGap <= threshold) {
        currentLine.push(current);
        fullText += ` ${current.text}`;

        avgHeight = currentLine.reduce((sum, r) => sum + r.box.height, 0) / currentLine.length;
      } else {
        result.lines.push([...currentLine]);

        fullText += `\n${current.text}`;

        currentLine = [current];
        avgHeight = current.box.height;
      }
    }

    if (currentLine.length > 0) {
      result.lines.push([...currentLine]);
    }

    result.text = fullText;
    return result;
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
