import * as ort from "onnxruntime-web";
import { ImageProcessor, type CanvasLike } from "ppu-ocv/web";

import { DEFAULT_PADDLE_OPTIONS } from "../constants.js";
import { deepMerge } from "../utils.js";

import type { PaddleOptions, RecognizeOptions } from "../interface.js";
import { globalImageCache, ImageCache } from "../processor/image-cache.js";
import { DetectionServiceWeb } from "./detection.service.web.js";
import {
  RecognitionServiceWeb,
  type RecognitionResult,
} from "./recognition.service.web.js";

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

const GITHUB_BASE_URL =
  "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/main/models/";

const DEFAULT_WEB_SESSION_OPTIONS: ort.InferenceSession.SessionOptions = {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
};

/**
 * PaddleOcrService for Web/Browser environments.
 * Uses onnxruntime-web and ppu-ocv/web instead of their Node counterparts.
 */
export class PaddleOcrService {
  private options: PaddleOptions = DEFAULT_PADDLE_OPTIONS;

  private detectionSession: ort.InferenceSession | null = null;
  private recognitionSession: ort.InferenceSession | null = null;
  private detector: DetectionServiceWeb | null = null;
  private recognitor: RecognitionServiceWeb | null = null;

  public constructor(options?: PaddleOptions) {
    this.options = deepMerge(
      {},
      DEFAULT_PADDLE_OPTIONS as unknown as Record<string, unknown>,
      options as unknown as Record<string, unknown>,
    ) as unknown as PaddleOptions;
    this.options.session =
      this.options.session || DEFAULT_PADDLE_OPTIONS.session;
  }

  private log(message: string): void {
    if (this.options.debugging?.verbose) {
      console.log(`[PaddleOcrService:Web] ${message}`);
    }
  }

  /**
   * Fetches a resource from a URL.
   * In the browser, HTTP caching handles repeat requests.
   */
  private async _fetchUrl(url: string): Promise<ArrayBuffer> {
    this.log(`Fetching resource from URL: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch resource from ${url}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Loads a resource from an ArrayBuffer, a URL string, or the default URL.
   * File paths are NOT supported in the browser.
   */
  private async _loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string,
  ): Promise<ArrayBuffer> {
    if (source instanceof ArrayBuffer) {
      this.log("Loading resource from ArrayBuffer");
      return source;
    }

    if (typeof source === "string") {
      if (source.startsWith("http")) {
        return this._fetchUrl(source);
      }
      // In the browser, treat non-http strings as relative URLs
      return this._fetchUrl(source);
    }

    return this._fetchUrl(defaultUrl);
  }

  /**
   * Initializes the OCR service by loading models and dictionary.
   * This method must be called before any OCR operations.
   */
  public async initialize(): Promise<void> {
    try {
      this.log("Initializing PaddleOcrService (Web)...");

      const sessionOptions: ort.InferenceSession.SessionOptions = {
        ...DEFAULT_WEB_SESSION_OPTIONS,
        ...this.options.session,
        executionProviders:
          (this.options.session
            ?.executionProviders as ort.InferenceSession.ExecutionProviderConfig[]) ||
          DEFAULT_WEB_SESSION_OPTIONS.executionProviders,
      };

      // Load detection model
      const detModelBuffer = await this._loadResource(
        this.options.model?.detection,
        `${GITHUB_BASE_URL}paddleocr-detection.onnx`,
      );

      this.detectionSession = await ort.InferenceSession.create(
        new Uint8Array(detModelBuffer),
        sessionOptions,
      );
      this.options.model!.detection = detModelBuffer;
      this.log(
        `Detection ONNX model loaded successfully\n\tinput: ${this.detectionSession.inputNames}\n\toutput: ${this.detectionSession.outputNames}`,
      );

      // Load recognition model
      const recModelBuffer = await this._loadResource(
        this.options.model?.recognition,
        `${GITHUB_BASE_URL}paddleocr-recognition.onnx`,
      );
      this.recognitionSession = await ort.InferenceSession.create(
        new Uint8Array(recModelBuffer),
        sessionOptions,
      );
      this.options.model!.recognition = recModelBuffer;
      this.log(
        `Recognition ONNX model loaded successfully\n\tinput: ${this.recognitionSession.inputNames}\n\toutput: ${this.recognitionSession.outputNames}`,
      );

      // Load character dictionary
      const dictBuffer = await this._loadResource(
        this.options.model?.charactersDictionary,
        `${GITHUB_BASE_URL}ppocrv5_en_dict.txt`,
      );
      const dictionaryContent = new TextDecoder("utf-8").decode(dictBuffer);
      const charactersDictionary = dictionaryContent.split("\n");

      if (charactersDictionary.length === 0) {
        throw new Error(
          "Character dictionary is empty or could not be loaded.",
        );
      }

      this.options.model!.charactersDictionary = dictBuffer;
      this.options.recognition!.charactersDictionary = charactersDictionary;
      this.log(
        `Character dictionary loaded with ${charactersDictionary.length} entries.`,
      );

      this.detector = new DetectionServiceWeb(
        this.detectionSession!,
        this.options.detection,
        this.options.debugging,
      );
      this.recognitor = new RecognitionServiceWeb(
        this.recognitionSession!,
        this.options.recognition,
        this.options.debugging,
      );

      this.options.model!.detection = undefined;
      this.options.model!.recognition = undefined;
    } catch (error) {
      console.error("Failed to initialize PaddleOcrService:", error);
      throw error;
    }
  }

  public isInitialized(): boolean {
    return this.detectionSession !== null && this.recognitionSession !== null;
  }

  /**
   * Changes the detection model for the current instance.
   */
  public async changeDetectionModel(
    model: ArrayBuffer | string,
  ): Promise<void> {
    this.log("Changing detection model...");
    const modelBuffer = await this._loadResource(
      model,
      `${GITHUB_BASE_URL}paddleocr-detection.onnx`,
    );

    await this.detectionSession?.release();

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      ...DEFAULT_WEB_SESSION_OPTIONS,
      ...this.options.session,
      executionProviders:
        (this.options.session
          ?.executionProviders as ort.InferenceSession.ExecutionProviderConfig[]) ||
        DEFAULT_WEB_SESSION_OPTIONS.executionProviders,
    };

    this.detectionSession = await ort.InferenceSession.create(
      new Uint8Array(modelBuffer),
      sessionOptions,
    );
    this.options.model!.detection = modelBuffer;
    this.log("Detection model changed successfully.");
  }

  /**
   * Changes the recognition model for the current instance.
   */
  public async changeRecognitionModel(
    model: ArrayBuffer | string,
  ): Promise<void> {
    this.log("Changing recognition model...");
    const modelBuffer = await this._loadResource(
      model,
      `${GITHUB_BASE_URL}paddleocr-recognition.onnx`,
    );

    await this.recognitionSession?.release();

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      ...DEFAULT_WEB_SESSION_OPTIONS,
      ...this.options.session,
      executionProviders:
        (this.options.session
          ?.executionProviders as ort.InferenceSession.ExecutionProviderConfig[]) ||
        DEFAULT_WEB_SESSION_OPTIONS.executionProviders,
    };

    this.recognitionSession = await ort.InferenceSession.create(
      new Uint8Array(modelBuffer),
      sessionOptions,
    );
    this.options.model!.recognition = modelBuffer;
    this.log("Recognition model changed successfully.");
  }

  /**
   * Changes the text dictionary for the current instance.
   */
  public async changeTextDictionary(
    dictionary: ArrayBuffer | string,
  ): Promise<void> {
    this.log("Changing text dictionary...");
    const dictBuffer = await this._loadResource(
      dictionary,
      `${GITHUB_BASE_URL}ppocrv5_en_dict.txt`,
    );

    const dictionaryContent = new TextDecoder("utf-8").decode(dictBuffer);
    const charactersDictionary = dictionaryContent.split("\n");

    if (charactersDictionary.length === 0) {
      throw new Error("Character dictionary is empty or could not be loaded.");
    }

    this.options.model!.charactersDictionary = dictBuffer;
    this.options.recognition!.charactersDictionary = charactersDictionary;
    this.log(
      `Character dictionary changed successfully with ${charactersDictionary.length} entries.`,
    );
  }

  /**
   * Runs OCR and returns a flattened list of recognized text boxes.
   */
  public recognize(
    image: ArrayBuffer | CanvasLike,
    options: RecognizeOptions & { flatten: true },
  ): Promise<FlattenedPaddleOcrResult>;

  /**
   * Runs OCR and returns recognized text grouped into lines.
   */
  public recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions & { flatten?: false },
  ): Promise<PaddleOcrResult>;

  /**
   * Runs object detection on the provided image, then performs
   * recognition on the detected regions.
   */
  public async recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions,
  ): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
    if (!this.isInitialized()) {
      throw new Error(
        "PaddleOcrService is not initialized. Call initialize() first.",
      );
    }
    await ImageProcessor.initRuntime();

    let imageBuffer: ArrayBuffer;
    if (image instanceof ArrayBuffer) {
      imageBuffer = image;
    } else {
      imageBuffer = await ImageProcessor.prepareBuffer(image);
    }

    const cacheKey = ImageCache.generateKey(imageBuffer);

    const cacheResult =
      !options?.noCache && !options?.dictionary
        ? globalImageCache.get(cacheKey)
        : undefined;
    if (cacheResult) {
      this.log("Using cached OCR result");

      if (options?.flatten) {
        return {
          text: cacheResult.text,
          results: this.getFlattenedResults(cacheResult.lines),
          confidence: cacheResult.confidence,
        };
      }

      return cacheResult;
    }

    let charactersDictionary: string[] | undefined;
    if (options?.dictionary) {
      const dictBuffer = await this._loadResource(options.dictionary, "");
      const dictionaryContent = new TextDecoder("utf-8").decode(dictBuffer);
      charactersDictionary = dictionaryContent.split("\n");

      if (charactersDictionary.length === 0) {
        throw new Error(
          "Custom character dictionary is empty or could not be loaded.",
        );
      }
    }

    const detection = await this.detector!.run(image);
    const recognition = await this.recognitor!.run(
      image,
      detection,
      charactersDictionary,
    );

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

    return result;
  }

  private getFlattenedResults(
    lines: RecognitionResult[][],
  ): RecognitionResult[] {
    return lines.flat();
  }

  private processRecognition(
    recognition: RecognitionResult[],
  ): PaddleOcrResult {
    const result: PaddleOcrResult = {
      text: "",
      lines: [],
      confidence: 0,
    };

    if (!recognition.length) {
      return result;
    }

    const totalConfidence = recognition.reduce(
      (sum, r) => sum + r.confidence,
      0,
    );
    result.confidence = totalConfidence / recognition.length;

    let currentLine: RecognitionResult[] = [recognition[0]];
    let fullText = recognition[0].text;
    let avgHeight = recognition[0].box.height;

    for (let i = 1; i < recognition.length; i++) {
      const current = recognition[i];
      const previous = recognition[i - 1];

      const verticalGap = Math.abs(current.box.y - previous.box.y);
      const threshold = avgHeight * 0.5;

      if (verticalGap <= threshold) {
        currentLine.push(current);
        fullText += ` ${current.text}`;

        avgHeight =
          currentLine.reduce((sum, r) => sum + r.box.height, 0) /
          currentLine.length;
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
   * Runs deskew algorithm on the provided image
   */
  public async deskewImage(
    image: ArrayBuffer | CanvasLike,
  ): Promise<CanvasLike> {
    if (!this.isInitialized()) {
      throw new Error(
        "PaddleOcrService is not initialized. Call initialize() first.",
      );
    }
    await ImageProcessor.initRuntime();

    const detection = await this.detector!.deskew(image);
    return detection;
  }

  /**
   * Releases the onnx runtime session for both
   * detection and recognition model.
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
