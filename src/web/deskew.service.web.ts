import { BaseDeskewService } from "../core/base-deskew.service.js";
import type { DebuggingOptions, DetectionOptions } from "../interface.js";
import { WebPlatformProvider } from "./platform.web.js";

/**
 * Service for calculating the skew angle of an image containing text (Web implementation).
 */
export class DeskewService extends BaseDeskewService {
  constructor(
    options: Partial<DetectionOptions> = {},
    debugging: Partial<DebuggingOptions> = {},
  ) {
    super(new WebPlatformProvider(), options, debugging);
  }
}
