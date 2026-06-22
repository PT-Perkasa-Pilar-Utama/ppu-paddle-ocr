// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type * as ort from "onnxruntime-react-native";
import { BaseDetectionService } from "../core/base-detection.service.js";
import type { DebuggingOptions, DetectionOptions } from "../interface.js";
import { MobilePlatformProvider } from "./platform.mobile.js";

/**
 * Service for detecting text regions in images using the React Native implementation.
 * Mobile always uses the canvas-native engine (no OpenCV available on RN).
 */
export class DetectionService extends BaseDetectionService {
  /**
   * Creates a mobile detection service bound to a loaded ONNX session.
   *
   * @param session - Loaded ONNX detection model session (`onnxruntime-react-native`).
   * @param options - Detection tuning options.
   * @param debugging - Logging and image-dump options.
   */
  constructor(
    session: ort.InferenceSession,
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {}
  ) {
    super(new MobilePlatformProvider(), session, options, debugging, "canvas-native");
  }
}
