// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type * as ort from "onnxruntime-react-native";
import { BaseRecognitionService } from "../core/base-recognition.service.js";
import type { RecognitionResult } from "../core/base-recognition.service.js";
import type { DebuggingOptions, RecognitionOptions } from "../interface.js";
import { MobilePlatformProvider } from "./platform.mobile.js";

export type { RecognitionResult };

/**
 * Service for detecting and recognizing text in images using the React Native implementation.
 * Mobile always uses the canvas-native engine (no OpenCV available on RN).
 */
export class RecognitionService extends BaseRecognitionService {
  /**
   * Creates a mobile recognition service bound to a loaded ONNX session.
   *
   * @param session - Loaded ONNX recognition model session (`onnxruntime-react-native`).
   * @param options - Recognition tuning options.
   * @param debugging - Logging and image-dump options.
   */
  constructor(
    session: ort.InferenceSession,
    options: Partial<RecognitionOptions> = {},
    debugging: Partial<DebuggingOptions> = {}
  ) {
    super(new MobilePlatformProvider(), session, options, debugging, "canvas-native");
  }
}
