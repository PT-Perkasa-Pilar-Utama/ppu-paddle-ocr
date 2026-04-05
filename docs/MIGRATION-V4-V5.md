## Migration Guide: v4.x to v5.0

### Overview of Breaking Changes

In v5.0.0, we've moved the deskew functionality to the [ppu-ocv](https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocv) library to keep ppu-paddle-ocr focused on OCR functionality. This change affects:

1. The `autoDeskew` option in `DetectionOptions`
2. The `deskewImage()` method on `PaddleOcrService`

### Why This Change?

- **Better Separation of Concerns**: Deskewing is an image preprocessing operation, while ppu-paddle-ocr focuses on OCR
- **Reduced Bundle Size**: Users who don't need deskewing won't have to include that code
- **More Flexibility**: ppu-ocv provides more advanced image processing capabilities beyond just deskewing

### Installation

If you were using deskew features, you'll need to install ppu-ocv (v3.0.0 or later):

```bash
npm install ppu-ocv
# or
bun add ppu-ocv
# or
yarn add ppu-ocv
```

**Note about ppu-ocv v3**: The examples below use ppu-ocv v3 API where `CanvasProcessor` is used for canvas preparation. If you're using ppu-ocv v2, use `ImageProcessor.prepareCanvas()` and `ImageProcessor.prepareBuffer()` instead.

### Migration Steps

#### 1. Migrating from `autoDeskew: true`

**Before (v4.x):**

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const service = new PaddleOcrService({
  detection: {
    autoDeskew: true, // This option no longer exists
  },
});

await service.initialize();
const result = await service.recognize("./image.jpg");
```

**After (v5.0):**

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";
import { DeskewService, CanvasProcessor } from "ppu-ocv";

// Create services
const ocrService = new PaddleOcrService();
const deskewService = new DeskewService();

await ocrService.initialize();

// Load and deskew the image first
const imgFile = Bun.file("./image.jpg"); // or use fs.readFile in Node.js
const fileBuffer = await imgFile.arrayBuffer();
const canvas = await CanvasProcessor.prepareCanvas(fileBuffer);

// Deskew the image
const deskewedCanvas = await deskewService.deskewImage(canvas);

// Convert back to buffer for OCR
const deskewedBuffer = await CanvasProcessor.prepareBuffer(deskewedCanvas);

// Perform OCR on the deskewed image
const result = await ocrService.recognize(deskewedBuffer);
```

**For Node.js environments:**

```ts
import { readFile } from "fs/promises";
import { PaddleOcrService } from "ppu-paddle-ocr";
import { DeskewService, CanvasProcessor } from "ppu-ocv";

const ocrService = new PaddleOcrService();
const deskewService = new DeskewService();

await ocrService.initialize();

// Load image
const imageBuffer = await readFile("./image.jpg");
const canvas = await CanvasProcessor.prepareCanvas(imageBuffer.buffer);

// Deskew
const deskewedCanvas = await deskewService.deskewImage(canvas);
const deskewedBuffer = await CanvasProcessor.prepareBuffer(deskewedCanvas);

// OCR
const result = await ocrService.recognize(deskewedBuffer);
```

**For Web/Browser environments:**

```ts
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import { DeskewService, ImageProcessor, CanvasProcessor } from "ppu-ocv/web";

const ocrService = new PaddleOcrService();
const deskewService = new DeskewService();

await ocrService.initialize();

// Load image from file input or create canvas
const canvas = document.getElementById("myCanvas"); // HTMLCanvasElement

// Deskew
const deskewedCanvas = await deskewService.deskewImage(canvas);

// OCR
const result = await ocrService.recognize(deskewedCanvas);
```

#### 2. Migrating from `deskewImage()` Method

**Before (v4.x):**

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const service = new PaddleOcrService();
await service.initialize();

// Standalone deskew operation
const deskewedCanvas = await service.deskewImage("./tilted-image.jpg");
// ... save or process deskewedCanvas
```

**After (v5.0):**

```ts
import { DeskewService, ImageProcessor, CanvasProcessor } from "ppu-ocv";
import { writeFileSync } from "fs";

const deskewService = new DeskewService({
  verbose: true, // Optional: enable logging
  minimumAreaThreshold: 20, // Optional: customize detection
});

// Load image
const imgFile = Bun.file("./tilted-image.jpg");
const fileBuffer = await imgFile.arrayBuffer();
const canvas = await CanvasProcessor.prepareCanvas(fileBuffer);

// Deskew
const deskewedCanvas = await deskewService.deskewImage(canvas);

// Save the result
const buffer = await CanvasProcessor.prepareBuffer(deskewedCanvas);
writeFileSync("./deskewed-output.png", new Uint8Array(buffer));
```

#### 3. Creating a Reusable Helper Function

To simplify migration, you can create a helper function that wraps the deskew + OCR workflow:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";
import { DeskewService, ImageProcessor, CanvasProcessor } from "ppu-ocv";

const ocrService = new PaddleOcrService();
const deskewService = new DeskewService();
await ocrService.initialize();

async function recognizeWithDeskew(
  imagePath: string | ArrayBuffer,
  options?: { flatten?: boolean },
) {
  // Load image
  let buffer: ArrayBuffer;
  if (typeof imagePath === "string") {
    const file = Bun.file(imagePath);
    buffer = await file.arrayBuffer();
  } else {
    buffer = imagePath;
  }

  // Prepare canvas
  const canvas = await CanvasProcessor.prepareCanvas(buffer);

  // Deskew
  const deskewedCanvas = await deskewService.deskewImage(canvas);

  // Convert back to buffer
  const deskewedBuffer = await CanvasProcessor.prepareBuffer(deskewedCanvas);

  // OCR
  return await ocrService.recognize(deskewedBuffer, options);
}

// Usage (similar to v4.x with autoDeskew)
const result = await recognizeWithDeskew("./image.jpg");
console.log(result.text);
```

### Additional Notes

- **Performance**: The deskew operation in ppu-ocv uses the same algorithm as v4.x, so performance should be equivalent
- **Options**: `DeskewService` supports `verbose` and `minimumAreaThreshold` options for customization
- **Manual Angle Calculation**: You can also use `calculateSkewAngle()` if you only need the angle without rotating:

```ts
const angle = await deskewService.calculateSkewAngle(canvas);
console.log(`Detected skew angle: ${angle} degrees`);
```

### Need Help?

If you encounter issues during migration, please:

1. Check the [ppu-ocv documentation](https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocv)
2. Review the [deskew example](https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocv/blob/main/examples/deskew.ts)
3. Open an issue on [GitHub](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues)
