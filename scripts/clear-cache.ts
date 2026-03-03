/// <reference types='bun-types' />
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

// Clear the model cache
const ocr = new PaddleOcrService();
ocr.clearModelCache();
