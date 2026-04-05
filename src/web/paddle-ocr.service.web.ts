import * as ort from "onnxruntime-web";
import { type CanvasLike } from "ppu-ocv/web";

import type {
  FlattenedPaddleOcrResult,
  PaddleOcrResult,
} from "../core/base-paddle-ocr.service.js";
import {
  BasePaddleOcrService,
  DICT_BASE_URL,
  MODEL_BASE_URL,
} from "../core/base-paddle-ocr.service.js";
import type { PaddleOptions, RecognizeOptions } from "../interface.js";
import { DetectionService } from "./detection.service.web.js";
import { WebPlatformProvider } from "./platform.web.js";
import { RecognitionService } from "./recognition.service.web.js";

export type { FlattenedPaddleOcrResult, PaddleOcrResult };

const DEFAULT_WEB_SESSION_OPTIONS: any = {
  executionProviders: ["wasm"],
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
    if (
      this.options.session === undefined ||
      Object.keys(this.options.session).length === 0
    ) {
      this.options.session = DEFAULT_WEB_SESSION_OPTIONS;
    }
  }

  protected async initSessions(): Promise<void> {
    throw new Error(
      "Initialization is handled proactively in PaddleOcrService. Call initialize() instead.",
    );
  }

  /**
   * Loads a resource from a URL string, or the default URL.
   */
  private async _loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string,
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

  /**
   * Initialize the OCR service by loading models, dictionary, and the OpenCV runtime.
   *
   * Must be called before `recognize()`.
   */
  public async initialize(): Promise<void> {
    try {
      this.log("Initializing PaddleOcrService (Web)...");

      const detModelBuffer = await this._loadResource(
        this.options.model?.detection,
        `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
      );

      this.detectionSession = await ort.InferenceSession.create(
        new Uint8Array(detModelBuffer),
        this.options.session!,
      );
      this.options.model!.detection = detModelBuffer;
      this.log(
        `Detection ONNX model loaded successfully\n\tinput: ${this.detectionSession.inputNames}\n\toutput: ${this.detectionSession.outputNames}`,
      );

      const recModelBuffer = await this._loadResource(
        this.options.model?.recognition,
        `${MODEL_BASE_URL}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.onnx`,
      );
      this.recognitionSession = await ort.InferenceSession.create(
        new Uint8Array(recModelBuffer),
        this.options.session!,
      );
      this.options.model!.recognition = recModelBuffer;
      this.log(
        `Recognition ONNX model loaded successfully\n\tinput: ${this.recognitionSession.inputNames}\n\toutput: ${this.recognitionSession.outputNames}`,
      );

      const dictBuffer = await this._loadResource(
        this.options.model?.charactersDictionary,
        `${DICT_BASE_URL}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
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

      this.detector = new DetectionService(
        this.detectionSession!,
        this.options.detection,
        this.options.debugging,
      ) as any;
      this.recognitor = new RecognitionService(
        this.recognitionSession!,
        this.options.recognition,
        this.options.debugging,
      ) as any;

      this.options.model!.detection = undefined;
      this.options.model!.recognition = undefined;
    } catch (error) {
      console.error("Failed to initialize PaddleOcrService Web:", error);
      throw error;
    }
  }

  public isInitialized(): boolean {
    return this.detectionSession !== null && this.recognitionSession !== null;
  }

  public async changeDetectionModel(
    model: ArrayBuffer | string,
  ): Promise<void> {
    this.log("Changing detection model...");
    const modelBuffer = await this._loadResource(
      model,
      `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    );

    await this.detectionSession?.release();
    this.detectionSession = await ort.InferenceSession.create(
      new Uint8Array(modelBuffer),
      this.options.session!,
    );
    this.options.model!.detection = modelBuffer;
    this.log("Detection model changed successfully.");
  }

  public async changeRecognitionModel(
    model: ArrayBuffer | string,
  ): Promise<void> {
    this.log("Changing recognition model...");
    const modelBuffer = await this._loadResource(
      model,
      `${MODEL_BASE_URL}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.onnx`,
    );

    await this.recognitionSession?.release();
    this.recognitionSession = await ort.InferenceSession.create(
      new Uint8Array(modelBuffer),
      this.options.session!,
    );
    this.options.model!.recognition = modelBuffer;
    this.log("Recognition model changed successfully.");
  }

  public async changeTextDictionary(
    dictionary: ArrayBuffer | string,
  ): Promise<void> {
    this.log("Changing text dictionary...");
    const dictBuffer = await this._loadResource(
      dictionary,
      `${DICT_BASE_URL}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
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

  public override recognize(
    image: ArrayBuffer | CanvasLike,
    options: RecognizeOptions & { flatten: true },
  ): Promise<FlattenedPaddleOcrResult>;

  public override recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions & { flatten?: false },
  ): Promise<PaddleOcrResult>;

  public override async recognize(
    image: ArrayBuffer | CanvasLike,
    options?: RecognizeOptions,
  ): Promise<PaddleOcrResult | FlattenedPaddleOcrResult> {
    return super.recognize(image as any, options);
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
