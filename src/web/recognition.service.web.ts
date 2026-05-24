// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type * as ort from "onnxruntime-web";
import { BaseRecognitionService } from "../core/base-recognition.service.js";
import type { RecognitionResult } from "../core/base-recognition.service.js";
import type { DebuggingOptions, RecognitionOptions } from "../interface.js";
import { WebPlatformProvider } from "./platform.web.js";

export type { RecognitionResult };

/**
 * Service for detecting and recognizing text in images using Web implementation.
 * Web always uses canvas-native engine (no OpenCV available in browser).
 */
export class RecognitionService extends BaseRecognitionService {
  constructor(
    session: ort.InferenceSession,
    options: Partial<RecognitionOptions> = {},
    debugging: Partial<DebuggingOptions> = {}
  ) {
    super(new WebPlatformProvider(), session, options, debugging, "canvas-native");
  }
}
