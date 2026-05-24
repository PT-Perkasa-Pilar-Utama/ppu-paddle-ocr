// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type * as ort from "onnxruntime-node";
import { BaseRecognitionService } from "../core/base-recognition.service.js";
import type { RecognitionResult } from "../core/base-recognition.service.js";
import type { DebuggingOptions, ProcessingEngine, RecognitionOptions } from "../interface.js";
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
    engine: ProcessingEngine = "opencv"
  ) {
    super(new NodePlatformProvider(), session, options, debugging, engine);
  }
}
