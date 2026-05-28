// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type * as ort from "onnxruntime-web";
import { BaseDetectionService } from "../core/base-detection.service.js";
import type { DebuggingOptions, DetectionOptions } from "../interface.js";
import { WebPlatformProvider } from "./platform.web.js";

/**
 * Service for detecting text regions in images using Web implementation.
 * Web always uses canvas-native engine (no OpenCV available in browser).
 */
export class DetectionService extends BaseDetectionService {
  /**
   * Creates a web detection service bound to a loaded ONNX session.
   *
   * @param session - Loaded ONNX detection model session (`onnxruntime-web`).
   * @param options - Detection tuning options.
   * @param debugging - Logging and image-dump options.
   */
  constructor(
    session: ort.InferenceSession,
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {}
  ) {
    super(new WebPlatformProvider(), session, options, debugging, "canvas-native");
  }
}
