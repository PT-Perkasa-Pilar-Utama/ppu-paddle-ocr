import * as ort from "onnxruntime-node";
import {
  BaseRecognitionService,
  type RecognitionResult,
} from "../core/base-recognition.service.js";
import type { DebuggingOptions, RecognitionOptions } from "../interface.js";
import { NodePlatformProvider } from "./platform.node.js";

export type { RecognitionResult };

/**
 * Service for detecting and recognizing text in images using Node.js implementation
 */
export class RecognitionService extends BaseRecognitionService {
  constructor(
    session: ort.InferenceSession,
    options: Partial<RecognitionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
  ) {
    super(new NodePlatformProvider(), session, options, debugging);
  }
}
