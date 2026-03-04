import { BaseDeskewService } from "../core/base-deskew.service.js";
import type { DebuggingOptions, DetectionOptions } from "../interface.js";
import { NodePlatformProvider } from "./platform.node.js";

/**
 * Service for calculating the skew angle of an image containing text.
 */
export class DeskewService extends BaseDeskewService {
  constructor(
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
  ) {
    super(new NodePlatformProvider(), options, debugging);
  }
}
