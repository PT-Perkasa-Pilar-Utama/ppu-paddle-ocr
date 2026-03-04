import * as ort from "onnxruntime-web";
import { BaseDetectionService } from "../core/base-detection.service.js";
import type { DebuggingOptions, DetectionOptions } from "../interface.js";
import { WebPlatformProvider } from "./platform.web.js";

/**
 * Service for detecting text regions in images using Web implementation
 */
export class DetectionService extends BaseDetectionService {
  constructor(
    session: ort.InferenceSession,
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
  ) {
    super(new WebPlatformProvider(), session, options, debugging);
  }
}
