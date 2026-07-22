import { PaddleOcrService } from "../src";
// import { PaddleOcrService } from "ppu-paddle-ocr";

/**
 * Example: Choosing between OpenCV and canvas-native processing engines.
 *
 * - "opencv" (default) - uses OpenCV.js for image preprocessing.
 *   More accurate region detection via contour analysis.
 *
 * - "canvas-native" - pure HTML Canvas operations; no OpenCV dependency.
 *   Lighter weight, suitable for browser extensions or minimal setups.
 */

const imagePath = `${import.meta.dir}/../assets/receipt.jpg`;
const imgFile = Bun.file(imagePath);
const fileBuffer = await imgFile.arrayBuffer();

// --- OpenCV engine (default, recommended) ---
console.log("=== OpenCV engine (default) ===\n");

const opencvService = new PaddleOcrService({
  processing: { engine: "opencv" },
  debugging: { verbose: true },
});
await opencvService.initialize();

const opencvStart = Date.now();
const opencvResult = await opencvService.recognize(fileBuffer);
const opencvTime = Date.now() - opencvStart;

console.log(`Text:\n${opencvResult.text}`);
console.log(`\nConfidence: ${opencvResult.confidence.toFixed(4)}`);
console.log(`Lines: ${opencvResult.lines.length}`);
console.log(`Items: ${opencvResult.lines.flat().length}`);
console.log(`Time: ${opencvTime} ms\n`);

await opencvService.destroy();

// --- Canvas-native engine ---
console.log("=== Canvas-native engine ===\n");

const canvasService = new PaddleOcrService({
  processing: { engine: "canvas-native" },
  debugging: { verbose: true },
});
await canvasService.initialize();

const canvasStart = Date.now();
const canvasResult = await canvasService.recognize(fileBuffer, {
  noCache: true,
});
const canvasTime = Date.now() - canvasStart;

console.log(`Text:\n${canvasResult.text}`);
console.log(`\nConfidence: ${canvasResult.confidence.toFixed(4)}`);
console.log(`Lines: ${canvasResult.lines.length}`);
console.log(`Items: ${canvasResult.lines.flat().length}`);
console.log(`Time: ${canvasTime} ms\n`);

await canvasService.destroy();

// --- Summary ---
console.log("=== Summary ===");
console.log(
  `OpenCV:        ${opencvTime} ms, ${opencvResult.lines.flat().length} items, confidence ${opencvResult.confidence.toFixed(4)}`
);
console.log(
  `Canvas-native: ${canvasTime} ms, ${canvasResult.lines.flat().length} items, confidence ${canvasResult.confidence.toFixed(4)}`
);
