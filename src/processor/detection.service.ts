import * as ort from "onnxruntime-node";
import { BaseDetectionService } from "../core/base-detection.service.js";
import type { DebuggingOptions, DetectionOptions } from "../interface.js";
import { NodePlatformProvider } from "./platform.node.js";

/**
 * Service for detecting text regions in images using Node.js implementation
 */
export class DetectionService extends BaseDetectionService {
  constructor(
    session: ort.InferenceSession,
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
  ) {
    super(new NodePlatformProvider(), session, options, debugging);
  }
}
