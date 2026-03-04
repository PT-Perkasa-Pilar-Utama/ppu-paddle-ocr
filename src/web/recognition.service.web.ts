import * as ort from "onnxruntime-web";
import {
  BaseRecognitionService,
  type RecognitionResult,
} from "../core/base-recognition.service.js";
import type { DebuggingOptions, RecognitionOptions } from "../interface.js";
import { WebPlatformProvider } from "./platform.web.js";

export type { RecognitionResult };

/**
 * Service for detecting and recognizing text in images using Web implementation
 */
export class RecognitionService extends BaseRecognitionService {
  constructor(
    session: ort.InferenceSession,
    options: Partial<RecognitionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
  ) {
    super(new WebPlatformProvider(), session, options, debugging);
  }
}
