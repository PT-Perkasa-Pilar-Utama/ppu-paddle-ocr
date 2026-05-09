# ppu-paddle-ocr

[![Slack](https://img.shields.io/badge/Slack-Community-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/ppupaddleocrcommunity/shared_invite/zt-3uzp1uuma-lrkEq8OYBYhGdUtzRoVmUg)

A lightweight, type-safe, PaddleOCR implementation in Bun/Node.js for text detection and recognition in JavaScript environments.

![ppu-paddle-ocr demo](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/refs/heads/main/assets/ppu-paddle-ocr-demo.jpg)

OCR should be as easy as:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const service = new PaddleOcrService();
await service.initialize();

const result = await service.recognize(fileBufferOrCanvas);
await service.destroy();
```

You can combine it further by using open-cv https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocv for more improved accuracy.

> **New in v5.2.0**: Recognition strategies `per-box` (default), `per-line`, and `cross-line`

Control how detected boxes are fed into the recognition model. Each strategy works by cropping detected regions from the canvas and stitching them side-by-side before running inference.

The goal is to reduce the number of recognition inferences:

- `per-box` strategy, _n_ detected boxes produce _n_ separate inferences.
- `per-line` (default) merges boxes on the same line into a single crop, and
- `cross-line` bin-packs crops across lines to minimize total inference calls, improving throughput on images with many text regions.

![recognition strategies](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/refs/heads/main/assets/recognition-strategies.jpg)

#### Paddle works best with grayscale/thresholded image

```ts
import { ImageProcessor, CanvasProcessor } from "ppu-ocv";
const processor = new ImageProcessor(bodyCanvas);

// For non-opencv environment like browser extension
// const processor = new CanvasProcessor(bodyCanvas)
processor.grayscale().blur();

const canvas = processor.toCanvas();
processor.destroy();
```

For other languages beyond English, pre-converted ONNX models for 40+ languages (including Thai, Arabic, Chinese, Korean, Japanese, and many European languages) are available at [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models). See the [Models and Language Support](#models-and-language-support) section for details on how to use them.

## Description

ppu-paddle-ocr brings the powerful PaddleOCR optical character recognition capabilities to JavaScript environments. This library simplifies the integration of ONNX models with Node.js applications, offering a lightweight solution for text detection and recognition without complex dependencies.

Built on top of `onnxruntime-node` and `onnxruntime-web`, ppu-paddle-ocr handles all the complexity of model loading, preprocessing, and inference, providing a clean and simple API for developers to extract text from images with minimal setup.

### Why use this library?

1.  **Lightweight**: Optimized for performance with minimal dependencies
2.  **Easy Integration**: Simple API to detect and recognize text in images
3.  **Cross-Platform**: Works in Node.js and Bun environments
4.  **Customizable**: Support for custom models and dictionaries
5.  **Pre-packed Models**: Defaults to optimized PP-OCRv5 mobile models (English) ready for immediate use, with automatic fetching and caching on the first run. Supports 40+ languages via [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models).
6.  **TypeScript Support**: Full TypeScript definitions for enhanced developer experience
7.  **Web Support**: Supports running directly in the browser

- **Upgrading from v4.x?** See the [Migration Guide](/docs/MIGRATION-V4-V5.md) below for step-by-step instructions.
- **New in v5.1.0**: The default image processing engine is now **OpenCV** (restored from v4 behavior). You can still opt into the lighter canvas-native engine via `processing: { engine: "canvas-native" }`. See [Processing Engine](#processing-engine) for details.

## Benchmark

Run `bun task bench`. Current result:

```bash
> bun run bench/index.bench.ts
clk: ~3.03 GHz
cpu: Apple M1
runtime: bun 1.3.13 (arm64-darwin)

benchmark                           avg (min … max) p75 / p99    (min … top 1%)
--------------------------------------------------- -------------------------------
[per-box][opencv][noCache]           206.60 ms/iter 207.79 ms    █
                            (204.07 ms … 210.91 ms) 209.55 ms █  █
                            (  1.41 mb …  29.34 mb)   9.13 mb █▁▁█▁▁██▁▁▁▁█▁█▁▁▁█▁█

[per-line][opencv][noCache]          188.75 ms/iter 188.89 ms    █
                            (187.91 ms … 191.31 ms) 189.30 ms    █
                            (  0.00  b …   5.92 mb)   1.74 mb █▁▁█▁▁█▁█▁▁▁████▁▁▁▁█

[cross-line][opencv][noCache]        193.43 ms/iter 190.81 ms █  █
                            (187.26 ms … 216.95 ms) 208.64 ms ██ █
                            (  0.00  b …   6.56 mb)   1.47 mb ████▁▁▁█▁▁▁▁▁▁▁▁▁▁▁▁█

summary
  [per-line][opencv][noCache]
   1.02x faster than [cross-line][opencv][noCache]
   1.09x faster than [per-box][opencv][noCache]

--------------------------------------------------- -------------------------------
[per-box][canvas-native][noCache]    212.86 ms/iter 212.75 ms    █  █
                            (211.40 ms … 215.12 ms) 214.95 ms ▅ ▅█ ▅█▅▅          ▅▅
                            (  0.00  b …  17.11 mb)   1.52 mb █▁██▁████▁▁▁▁▁▁▁▁▁▁██

[per-line][canvas-native][noCache]   200.04 ms/iter 199.92 ms    █
                            (199.17 ms … 202.50 ms) 201.70 ms    █
                            (  0.00  b … 144.00 kb)  29.09 kb ▇▇▁█▇▇▇▇▁▁▁▁▁▁▁▁▁▁▁▁▇

[cross-line][canvas-native][noCache] 198.32 ms/iter 198.70 ms    █  █
                            (196.81 ms … 201.58 ms) 200.92 ms ▅▅▅█▅ █  ▅▅         ▅
                            (  0.00  b …   2.34 mb) 436.00 kb █████▁█▁▁██▁▁▁▁▁▁▁▁▁█

summary
  [cross-line][canvas-native][noCache]
   1.01x faster than [per-line][canvas-native][noCache]
   1.07x faster than [per-box][canvas-native][noCache]

=== Accuracy on /Users/vexeee/Documents/project/paddle-ocr.js/bench/../assets/receipt.jpg ===
  ground truth length: 383 chars

  [opencv]
    per-box        accuracy=97.91%  dist=8
    per-line       accuracy=99.22%  dist=3
    cross-line     accuracy=96.34%  dist=14

  [canvas-native]
    per-box        accuracy=97.65%  dist=9
    per-line       accuracy=98.43%  dist=6
    cross-line     accuracy=97.65%  dist=9
```

## Installation

Install using your preferred package manager:

```bash
npm install ppu-paddle-ocr
yarn add ppu-paddle-ocr
bun add ppu-paddle-ocr
```

## Usage

#### Basic Usage

To get started, create an instance of `PaddleOcrService` and call the `initialize()` method. This will download and cache the default **PP-OCRv5 mobile** models (English) on the first run.

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

// Create a new instance of the service
const service = new PaddleOcrService({
  debugging: {
    debug: false,
    verbose: true,
  },
});

// Initialize the service (this will download models on the first run)
await service.initialize();

const result = await service.recognize("./assets/receipt.jpg");
console.log(result.text);

// It's important to destroy the service when you're done to release resources.
await service.destroy();

// If you're updating ppu-paddle-ocr to the new release and wants to change/redownload the model
service.clearModelCache();
```

#### Using Custom Models

You can provide custom models via file paths, URLs, or `ArrayBuffer`s during initialization. If no models are provided, the default PP-OCRv5 mobile models for English will be fetched from the [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models) repository.

For available models and languages, see the [Models and Language Support](#models-and-language-support) section below.

```ts
const service = new PaddleOcrService({
  model: {
    detection: "./models/custom-det.onnx",
    recognition: "https://example.com/models/custom-rec.onnx",
    charactersDictionary: customDictArrayBuffer,
  },
});

// Don't forget to initialize the service
await service.initialize();
```

#### Changing Models and Dictionaries at Runtime

You can dynamically change the models or dictionary on an initialized instance.

```ts
// Initialize the service first
const service = new PaddleOcrService();
await service.initialize();

// Change the detection model
await service.changeDetectionModel("./models/new-det-model.onnx");

// Change the recognition model
await service.changeRecognitionModel("./models/new-rec-model.onnx");

// Change the dictionary
await service.changeTextDictionary("./models/new-dict.txt");
```

See: [Example usage](./examples)

#### Using a Custom Dictionary for a Single Recognition

You can provide a custom dictionary for a single `recognize` call without changing the service's default dictionary. This is useful for one-off recognitions with special character sets.

```ts
// Initialize the service first
const service = new PaddleOcrService();
await service.initialize();

// Use a custom dictionary for this specific call
const result = await service.recognize("./assets/receipt.jpg", {
  dictionary: "./models/new-dict.txt",
});

// The service's default dictionary remains unchanged for subsequent calls
const anotherResult = await service.recognize("./assets/another-image.jpg");
```

#### Disabling Cache for Specific Calls

You can disable caching for individual OCR calls if you need fresh processing each time:

```ts
// Initialize the service first
const service = new PaddleOcrService();
await service.initialize();

// Process with caching (default behavior)
const cachedResult = await service.recognize("./assets/receipt.jpg");

// Process without caching for this specific call
const freshResult = await service.recognize("./assets/receipt.jpg", {
  noCache: true,
});

// You can also combine noCache with other options
const result = await service.recognize("./assets/receipt.jpg", {
  noCache: true,
  flatten: true,
});
```

#### Optimizing Performance with Session Options

You can fine-tune the ONNX Runtime session configuration for optimal performance:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

// Create a service with optimized session options
const service = new PaddleOcrService({
  session: {
    executionProviders: ["cpu"], // Use CPU-only for consistent performance
    graphOptimizationLevel: "all", // Enable all optimizations
    enableCpuMemArena: true, // Better memory management
    enableMemPattern: true, // Memory pattern optimization
    executionMode: "sequential", // Better for single-threaded performance
    interOpNumThreads: 0, // Let ONNX decide optimal thread count
    intraOpNumThreads: 0, // Let ONNX decide optimal thread count
  },
});

await service.initialize();

const result = await service.recognize("./assets/receipt.jpg");
console.log(result.text);

await service.destroy();
```

## Web / Browser Support

Starting from `4.0.0`, ppu-paddle-ocr supports running directly in the browser! Import from `ppu-paddle-ocr/web` instead of the root package to use browser-native capabilities (`HTMLCanvasElement`, `OffscreenCanvas`, and `fetch` buffering) instead of the Node APIs.

Note that the browser build depends on `onnxruntime-web` rather than `onnxruntime-node`.

### Using a Bundler (Vite, Webpack, etc)

```ts
import { PaddleOcrService } from "ppu-paddle-ocr/web";

const service = new PaddleOcrService();
await service.initialize();

// If you have a file input:
// <input type="file" id="upload" />
const file = document.getElementById("upload").files[0];

// Convert to an HTMLImageElement or an offscreen Canvas
const img = new Image();
img.src = URL.createObjectURL(file);
await new Promise((r) => (img.onload = r));

const canvas = document.createElement("canvas");
canvas.width = img.width;
canvas.height = img.height;
canvas.getContext("2d").drawImage(img, 0, 0);

const result = await service.recognize(canvas);
console.log(result.text);
```

### Direct CDN Usage (No Bundler)

You can check out our live `index.html` demo to see how to include the dependencies directly via CDN using ESM modules, and how to configure fallback model loading.

See the interactive demo implementation here: [Web Demo](https://pt-perkasa-pilar-utama.github.io/ppu-paddle-ocr/)

### WebGPU Acceleration

Starting from `5.3.0`, the web build automatically detects WebGPU support and uses it for ONNX inference when available, falling back transparently to WebAssembly otherwise. On WebGPU-capable browsers (Chrome/Edge on Windows/Linux/macOS, and Firefox Nightly with the flag enabled) this typically gives **2–5× faster recognition** with no code changes.

The detection runs once during `initialize()` and is completely transparent — no flags to set, no opt-in needed. If WebGPU session creation fails (for example because a particular model uses an operator WebGPU does not support), the library silently falls back to WASM.

#### Overriding the provider preference

If you want to force a specific provider (e.g. WASM-only for deterministic CPU behaviour, or to work around a WebGPU driver bug), pass explicit `executionProviders` via `session`:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr/web";

// Force WebAssembly (disables WebGPU even when available)
const service = new PaddleOcrService({
  session: {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  },
});
await service.initialize();
```

#### Probing for WebGPU

Both helpers used internally are exported if you want to show a "GPU-accelerated" indicator or branch on provider support in your own UI:

```ts
import { isWebGpuAvailable, getDefaultWebExecutionProviders } from "ppu-paddle-ocr/web";

if (await isWebGpuAvailable()) {
  console.log("WebGPU detected — inference will run on the GPU");
}

// Resolved provider list ppu-paddle-ocr will use by default (if no override is set):
console.log(await getDefaultWebExecutionProviders());
// -> ["webgpu", "wasm"]   on WebGPU-capable browsers
// -> ["wasm"]              on browsers without WebGPU (Safari today, older Firefox, etc.)
```

> [!NOTE]
> `onnxruntime-web` still needs to load its WASM binaries even when WebGPU is selected as the primary provider (they are used for graph optimization and fallback ops). The library sets a sensible `ort.env.wasm.wasmPaths` default; override it via `ort.env.wasm.wasmPaths = "/path/to/"` before `initialize()` if you self-host the WASM files.

## Models and Language Support

### Default Models

By default, ppu-paddle-ocr uses **PP-OCRv5 mobile** models optimized for English text:

- **Detection Model**: `PP-OCRv5_mobile_det_infer.onnx`
- **Recognition Model**: `en_PP-OCRv5_mobile_rec_infer.onnx`
- **Dictionary**: `ppocrv5_en_dict.txt`

These models are automatically downloaded and cached on the first run. PP-OCRv5 provides excellent accuracy for general text recognition while maintaining fast inference speeds.

#### Cache location (Node / Bun)

Downloaded models are stored under the user's home directory, in a fixed
`.cache/ppu-paddle-ocr` subfolder (resolved via `os.homedir()`):

| OS      | Resolved path                                 |
| :------ | :-------------------------------------------- |
| macOS   | `~/.cache/ppu-paddle-ocr`                     |
| Linux   | `~/.cache/ppu-paddle-ocr`                     |
| Windows | `C:\Users\<username>\.cache\ppu-paddle-ocr`   |

The path is the same per-user across runs, so the first `initialize()` is slow (network download) and every subsequent run re-uses the cached `.onnx` files.

Two ways to inspect / manage the cache:

- `PaddleOcrService.downloadModels()` — pre-populates the cache with the default model set. Useful to warm the cache in CI, Docker image builds, or to avoid a cold-start download on the first user request.
- `service.clearModelCache()` — removes the entire `ppu-paddle-ocr` cache folder. Use this when upgrading to a new release that changes model files, or to free disk space.

> [!NOTE]
> The web build (`ppu-paddle-ocr/web`) does not use this filesystem cache. In the browser, model files are fetched via `fetch()` on every page load and rely on the browser's own HTTP cache. If you want persistent offline caching, wire up a Service Worker or store the `ArrayBuffer` in IndexedDB and pass it via the `model:` option.

### Available Model Versions

The library supports multiple PaddleOCR model versions from the [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models) repository:

- **PP-OCRv3**: Legacy models with basic accuracy
- **PP-OCRv4**: Improved accuracy over v3, available in mobile and server variants
- **PP-OCRv5**: Latest models with the best accuracy (recommended), available in mobile and server variants

**Model Types**:

- **Mobile**: Optimized for speed and smaller size, suitable for most use cases
- **Server**: Larger models with higher accuracy, better for accuracy-critical applications

### Multilingual Support

PP-OCRv5 supports 40+ languages across different script systems. Pre-converted ONNX models are available for:

**Latin Scripts**: English, French, German, Italian, Spanish, Portuguese, and 40+ other languages

**Cyrillic**: Russian, Ukrainian, Bulgarian, Kazakh, Serbian, and 30+ related languages

**Asian Languages**:

- Arabic script: Arabic, Persian, Urdu, Kurdish
- Indic scripts: Hindi (Devanagari), Tamil, Telugu
- East Asian: Korean, Japanese
- Southeast Asian: Thai

All available models can be found in the [ppu-paddle-ocr-models repository](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models).

### Switching Models

#### Using a Different Language

To use a different language model, specify the model URLs in the configuration:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const MODEL_BASE =
  "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";
const DICT_BASE =
  "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";

// Example: Using Thai models
const service = new PaddleOcrService({
  model: {
    detection: `${MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    recognition: `${MODEL_BASE}/recognition/multi/thai/v5/th_PP-OCRv5_mobile_rec_infer.onnx`,
    charactersDictionary: `${DICT_BASE}/recognition/multi/thai/v5/ppocrv5_th_dict.txt`,
  },
});

await service.initialize();
```

#### Using Server Models for Higher Accuracy

```ts
// Example: Using PP-OCRv5 server models for English
const service = new PaddleOcrService({
  model: {
    detection: `${MODEL_BASE}/detection/PP-OCRv5_server_det_infer.onnx`,
    recognition: `${MODEL_BASE}/recognition/multi/en/v5/en_PP-OCRv5_server_rec_infer.onnx`,
    charactersDictionary: `${DICT_BASE}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
  },
});

await service.initialize();
```

#### Using Local Models

You can also use locally downloaded models:

```ts
const service = new PaddleOcrService({
  model: {
    detection: "./models/custom-det.onnx",
    recognition: "./models/custom-rec.onnx",
    charactersDictionary: "./models/custom-dict.txt",
  },
});

await service.initialize();
```

### Model Output Support

PaddleOCR models are designed for **text-only recognition**. They detect and recognize plain text characters in images. For specialized use cases:

- **Tables**: Models detect text within table cells but do not preserve table structure. You'll need additional post-processing to reconstruct table layouts.
- **Math Formulas**: Standard PaddleOCR models are not optimized for mathematical notation. Consider specialized OCR models for LaTeX/math formula recognition.
- **Document Layout**: For complex document analysis including layout detection, consider using PP-DocLayoutV2/V3 models available in the [ppu-paddle-ocr-models repository](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models).

### Converting Custom Models

If you need to convert PaddlePaddle models to ONNX format, see our [conversion guide](./examples/convert-onnx.ipynb).

### INT8 Quantized Recognition Models (advanced)

The PP-OCRv5 recognition model is dominated by transformer MatMul operations, which can be dynamically quantized from FP32 to INT8 with **no accuracy loss** on typical inputs (measured 99.22% → 99.22% on the receipt sample) and a 20–50% speedup on **x86-64 CPUs with VNNI** (Intel 10th-gen+, AMD Zen 3+) and on **WebAssembly** in older browsers.

> [!NOTE]
> On Apple Silicon (M-series), INT8 is currently **not faster** than FP32 because ONNX Runtime Node uses highly tuned FP32 NEON/Accelerate kernels that beat the INT8 MLAS path. Stick with FP32 on macOS ARM64.

A quantization helper script is provided at [`examples/quantize-onnx.py`](./examples/quantize-onnx.py):

```bash
pip install onnxruntime onnx sympy
python examples/quantize-onnx.py /path/to/en_PP-OCRv5_mobile_rec_infer.onnx
# -> produces en_PP-OCRv5_mobile_rec_infer_int8.onnx
```

The script quantizes only `MatMul` / `Gemm` ops (not `Conv`) because `ConvInteger` is not implemented in the CPU backend of `onnxruntime-node`. For recognition this covers the dominant compute path. Detection models don't benefit significantly from dynamic quantization and are skipped.

Use the quantized model via the `model.recognition` option:

```ts
const service = new PaddleOcrService({
  model: {
    recognition: "https://example.com/en_PP-OCRv5_mobile_rec_infer_int8.onnx",
  },
});
await service.initialize();
```

## Processing Engine

Starting from v5.1.0, you can choose between two image processing engines for the detection and recognition preprocessing pipeline:

| Engine            | Default | OpenCV Required | Description                                                                                    |
| :---------------- | :-----: | :-------------: | :--------------------------------------------------------------------------------------------- |
| `"opencv"`        |   Yes   |       Yes       | Uses OpenCV.js (`ImageProcessor` / `Contours` from `ppu-ocv`). More accurate region detection. |
| `"canvas-native"` |   No    |       No        | Pure HTML Canvas operations (`CanvasProcessor` from `ppu-ocv/canvas`). Lighter, no OpenCV dep. |

The **OpenCV** engine is the default because it produces more accurate bounding boxes during text detection using proper contour analysis. The **canvas-native** engine is a good alternative for environments where OpenCV is unavailable (e.g., browser extensions) or when minimizing dependencies is a priority.

> [!NOTE]
> The Web/browser build (`ppu-paddle-ocr/web`) always uses `canvas-native` regardless of this setting, since OpenCV.js is not bundled in the web entry point.

```ts
// Use the default OpenCV engine (recommended)
const service = new PaddleOcrService();

// Or explicitly choose canvas-native for lighter processing
const service = new PaddleOcrService({
  processing: { engine: "canvas-native" },
});

await service.initialize();
```

## Configuration

All options are grouped under the `PaddleOptions` interface:

```ts
export interface PaddleOptions {
  /** File paths, URLs, or buffers for the OCR model components. */
  model?: ModelPathOptions;

  /** Controls parameters for text detection. */
  detection?: DetectionOptions;

  /** Controls parameters for text recognition. */
  recognition?: RecognitionOptions;

  /** Controls logging and image dump behavior for debugging. */
  debugging?: DebuggingOptions;

  /** ONNX Runtime session configuration options. */
  session?: SessionOptions;

  /** Controls the image processing backend. */
  processing?: ProcessingOptions;
}
```

#### `RecognizeOptions`

Options for individual `recognize()` calls.

| Property     |          Type           | Default | Description                                           |
| :----------- | :---------------------: | :-----: | :---------------------------------------------------- |
| `flatten`    |        `boolean`        | `false` | Return flattened results instead of grouped by lines. |
| `dictionary` | `string \| ArrayBuffer` | `null`  | Custom character dictionary for this specific call.   |
| `noCache`    |        `boolean`        | `false` | Disable caching for this specific call.               |

#### `ModelPathOptions`

Specifies paths, URLs, or buffers for the OCR models and dictionary files.

| Property               |          Type           |             Required             | Description                                           |
| :--------------------- | :---------------------: | :------------------------------: | :---------------------------------------------------- |
| `detection`            | `string \| ArrayBuffer` |   **No** (uses default model)    | Path, URL, or buffer for the text detection model.    |
| `recognition`          | `string \| ArrayBuffer` |   **No** (uses default model)    | Path, URL, or buffer for the text recognition model.  |
| `charactersDictionary` | `string \| ArrayBuffer` | **No** (uses default dictionary) | Path, URL, buffer, or content of the dictionary file. |

> [!NOTE]
> If you omit model paths, the library will automatically fetch the default models from the official GitHub repository.
> Don't forget to add a space and a blank line at the end of the dictionary file.

#### `DetectionOptions`

Controls preprocessing and filtering parameters during text detection.

| Property               |            Type            |         Default         | Description                                                      |
| :--------------------- | :------------------------: | :---------------------: | :--------------------------------------------------------------- |
| `mean`                 | `[number, number, number]` | `[0.485, 0.456, 0.406]` | Per-channel mean values for input normalization [R, G, B].       |
| `stdDeviation`         | `[number, number, number]` | `[0.229, 0.224, 0.225]` | Per-channel standard deviation values for input normalization.   |
| `maxSideLength`        |          `number`          |          `960`          | Maximum dimension (longest side) for input images (px).          |
| `paddingVertical`      |          `number`          |          `0.4`          | Fractional padding added vertically to each detected text box.   |
| `paddingHorizontal`    |          `number`          |          `0.6`          | Fractional padding added horizontally to each detected text box. |
| `minimumAreaThreshold` |          `number`          |          `20`           | Discard boxes with area below this threshold (px²).              |

#### `RecognitionOptions`

Controls parameters for the text recognition stage.

| Property      |   Type   | Default | Description                                           |
| :------------ | :------: | :-----: | :---------------------------------------------------- |
| `imageHeight` | `number` |  `48`   | Fixed height for resized input text line images (px). |

#### `DebuggingOptions`

Enable verbose logs and save intermediate images to help debug OCR pipelines.

| Property      |   Type    | Default | Description                                            |
| ------------- | :-------: | :-----: | :----------------------------------------------------- |
| `verbose`     | `boolean` | `false` | Turn on detailed console logs of each processing step. |
| `debug`       | `boolean` | `false` | Write intermediate image frames to disk.               |
| `debugFolder` | `string`  |  `out`  | Output directory for debug images.                     |

#### `SessionOptions`

Controls ONNX Runtime session configuration for optimal performance.

| Property                 |                            Type                            |    Default     | Description                                                                      |
| :----------------------- | :--------------------------------------------------------: | :------------: | :------------------------------------------------------------------------------- |
| `executionProviders`     |                         `string[]`                         |   `['cpu']`    | Execution providers to use (e.g., `['cpu']`, `['cuda', 'cpu']`).                 |
| `graphOptimizationLevel` | `'disabled' \| 'basic' \| 'extended' \| 'layout' \| 'all'` |    `'all'`     | Graph optimization level for better performance.                                 |
| `enableCpuMemArena`      |                         `boolean`                          |     `true`     | Enable CPU memory arena for better memory management.                            |
| `enableMemPattern`       |                         `boolean`                          |     `true`     | Enable memory pattern optimization.                                              |
| `executionMode`          |                `'sequential' \| 'parallel'`                | `'sequential'` | Execution mode for the session (`'sequential'` for single-threaded performance). |
| `interOpNumThreads`      |                          `number`                          |      `0`       | Number of inter-op threads (0 lets ONNX decide).                                 |
| `intraOpNumThreads`      |                          `number`                          |      `0`       | Number of intra-op threads (0 lets ONNX decide).                                 |

## Contributing

Contributions are welcome! If you would like to contribute, please follow these steps:

1. **Fork the Repository:** Create your own fork of the project.
2. **Create a Feature Branch:** Use a descriptive branch name for your changes.
3. **Implement Changes:** Make your modifications, add tests, and ensure everything passes.
4. **Submit a Pull Request:** Open a pull request to discuss your changes and get feedback.

### Running Tests

This project uses Bun for testing. To run the tests locally, execute:

```bash
bun test
bun build:test
bun lint
bun lint:fix
```

Ensure that all tests pass before submitting your pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have suggestions, please open an issue in the repository.

Join our community on [Slack](https://join.slack.com/t/ppupaddleocrcommunity/shared_invite/zt-3uzp1uuma-lrkEq8OYBYhGdUtzRoVmUg) to get help, share feedback, or discuss features.

## Scripts

Recommended development environment is in linux-based environment. Library template: https://github.com/aquapi/lib-template

All script sources and usage.

### [Build](./scripts/build.ts)

Emit `.js` and `.d.ts` files to [`lib`](./lib).

### [Publish](./scripts/publish.ts)

Move [`package.json`](./package.json), [`README.md`](./README.md) to [`lib`](./lib) and publish the package.

### [Bench](./scripts/bench.ts)

Run files that ends with `.bench.ts` extension.

To run a specific file.

```bash
bun task bench index # Run bench/index.bench.ts
```

To run the benchmark in `node`, add a `--node` parameter

```bash
bun task bench --node

bun task bench --node index # Run bench/index.bench.ts with node
```
