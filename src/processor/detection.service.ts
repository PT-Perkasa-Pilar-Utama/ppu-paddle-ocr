// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type * as ort from "onnxruntime-node";
import { BaseDetectionService } from "../core/base-detection.service.js";
import type { DebuggingOptions, DetectionOptions, ProcessingEngine } from "../interface.js";
import { NodePlatformProvider } from "./platform.node.js";

/**
 * Service for detecting text regions in images using Node.js implementation
 */
export class DetectionService extends BaseDetectionService {
  /**
   * Creates a Node detection service bound to a loaded ONNX session.
   *
   * @param session - Loaded ONNX detection model session.
   * @param options - Detection tuning options.
   * @param debugging - Logging and image-dump options.
   * @param engine - Image processing engine; falls back to `canvas-native` when OpenCV is unavailable.
   */
  constructor(
    session: ort.InferenceSession,
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
    engine: ProcessingEngine = "opencv"
  ) {
    super(new NodePlatformProvider(), session, options, debugging, engine);
  }
}
