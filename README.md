# ppu-paddle-ocr

[![Slack](https://img.shields.io/badge/Slack-Community-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/ppupaddleocrcommunity/shared_invite/zt-3uzp1uuma-lrkEq8OYBYhGdUtzRoVmUg) [![NPM](https://img.shields.io/npm/dw/ppu-paddle-ocr)](https://www.npmjs.com/package/ppu-paddle-ocr)

Lightweight, probably the fastest PaddleOCR SDK in TypeScript. Runs anywhere JavaScript runs: Node.js, Bun, Deno, web browsers, and browser extensions. The official SDK is browser-only and significantly slower. [Compare it for yourself](https://snowfluke.github.io/paddle-ocr-comparison/).

![ppu-paddle-ocr demo](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/refs/heads/main/assets/ppu-paddle-ocr-demo.jpg)

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const service = new PaddleOcrService();
await service.initialize();

const result = await service.recognize("./receipt.jpg");
console.log(result.text);

await service.destroy();
```

## Table of Contents

- [Quick Start](#quick-start)
- [Why ppu-paddle-ocr?](#why-ppu-paddle-ocr)
- [Runtime Support](#runtime-support)
- [Installation](#installation)
- [Core Usage](#core-usage)
  - [Basic Recognition](#basic-recognition)
  - [Custom Models](#custom-models)
  - [Changing Models at Runtime](#changing-models-at-runtime)
  - [Per-Call Options](#per-call-options)
- [Recognition Strategies](#recognition-strategies)
- [Image Preprocessing](#image-preprocessing)
- [Processing Engine](#processing-engine)
- [Web / Browser Support](#web--browser-support)
  - [Using a Bundler](#using-a-bundler-vite-webpack-etc)
  - [CDN (No Bundler)](#cdn-no-bundler)
  - [WebGPU Acceleration](#webgpu-acceleration)
- [Models and Language Support](#models-and-language-support)
  - [Default Models](#default-models)
  - [Cache Location](#cache-location-node--bun)
  - [Multilingual Support](#multilingual-support)
  - [Switching Languages](#switching-languages)
  - [Server Models](#server-models-higher-accuracy)
  - [INT8 Quantization](#int8-quantization)
  - [Model Output Limitations](#model-output-limitations)
  - [Converting Custom Models](#converting-custom-paddlepaddle-models)
- [Configuration Reference](#configuration-reference)
  - [PaddleOptions](#paddleoptions)
  - [RecognizeOptions](#recognizeoptions)
  - [ModelPathOptions](#modelpathoptions)
  - [DetectionOptions](#detectionoptions)
  - [RecognitionOptions](#recognitionoptions)
  - [DebuggingOptions](#debuggingoptions)
  - [SessionOptions](#sessionoptions)
  - [ProcessingOptions](#processingoptions)
- [Benchmark](#benchmark)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)
- [Scripts](#scripts)

## Why ppu-paddle-ocr?

- **Lightweight** — minimal dependencies, optimized for performance.
- **Pre-packed models** — PP-OCRv5 mobile models (English) are fetched and cached automatically on first run. Supports 40+ languages via [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models).
- **Runs everywhere** — Node.js, Bun, Deno, web browsers, and browser extensions. The official SDK is browser-only.
- **Customizable** — custom models, dictionaries, and per-call overrides.
- **TypeScript** — full type definitions.

## Runtime Support

The same package, the same API, every JavaScript runtime:

| Runtime               | How to install                                                          | Try it                                                                                       |
| --------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Node.js**           | `npm install ppu-paddle-ocr onnxruntime-node`                           | [npm package](https://www.npmjs.com/package/ppu-paddle-ocr)                                  |
| **Bun**               | `bun add ppu-paddle-ocr onnxruntime-node`                               | [npm package](https://www.npmjs.com/package/ppu-paddle-ocr)                                  |
| **Deno**              | `deno add jsr:@snowfluke/ppu-paddle-ocr`                                | [JSR package](https://jsr.io/@snowfluke/ppu-paddle-ocr)                                      |
| **Web browser**       | `npm install ppu-paddle-ocr onnxruntime-web` (import `/web` subpath)    | [Live demo](https://pt-perkasa-pilar-utama.github.io/ppu-paddle-ocr/)                        |
| **Browser extension** | Same as web; bundle `ppu-paddle-ocr/web` with your extension's bundler. | [Example extension repo](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-extension) |

## Installation

```bash
npm install ppu-paddle-ocr onnxruntime-node onnxruntime-web
```

Omit `onnxruntime-node` or `onnxruntime-web` depending on your target environment (Node/Bun vs browser).

## Core Usage

### Basic Recognition

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const service = new PaddleOcrService({
  debugging: {
    debug: false,
    verbose: true,
  },
});

await service.initialize();

const result = await service.recognize("./assets/receipt.jpg");
console.log(result.text);

await service.destroy();
```

### Custom Models

Pass file paths, URLs, or `ArrayBuffer`s for the detection model, recognition model, and dictionary:

```ts
const service = new PaddleOcrService({
  model: {
    detection: "./models/custom-det.onnx",
    recognition: "https://example.com/models/custom-rec.onnx",
    charactersDictionary: customDictArrayBuffer,
  },
});

await service.initialize();
```

### Changing Models at Runtime

```ts
const service = new PaddleOcrService();
await service.initialize();

await service.changeDetectionModel("./models/new-det.onnx");
await service.changeRecognitionModel("./models/new-rec.onnx");
await service.changeTextDictionary("./models/new-dict.txt");
```

### Per-Call Options

Each `recognize()` call accepts `RecognizeOptions` for fine-grained control:

```ts
// Custom dictionary for one-off recognition
const result = await service.recognize("./assets/receipt.jpg", {
  dictionary: "./models/new-dict.txt",
});

// Disable caching for fresh processing
const fresh = await service.recognize("./assets/receipt.jpg", {
  noCache: true,
});

// Combine options
const result = await service.recognize("./assets/receipt.jpg", {
  noCache: true,
  flatten: true,
  strategy: "per-box",
});
```

## Recognition Strategies

Recognition strategies control how detected text regions are cropped from the canvas and fed into the recognition model. Fewer inference calls means faster throughput.

| Strategy     | Description                                                                  |
| :----------- | :--------------------------------------------------------------------------- |
| `per-box`    | Each detected box is recognized individually — _n_ boxes, _n_ inferences.    |
| `per-line`   | Boxes on the same line are merged into a single crop — fewer inferences.     |
| `cross-line` | Crops are bin-packed across lines into uniform-width batches — fewest calls. |

**Default**: `per-line` (best accuracy/speed trade-off).

Strategies are set in `RecognitionOptions`:

```ts
const service = new PaddleOcrService({
  recognition: { strategy: "cross-line" },
});
await service.initialize();
```

![recognition strategies](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/refs/heads/main/assets/recognition-strategies.jpg)

## Image Preprocessing

PaddleOCR works best with grayscale or thresholded images. Use [ppu-ocv](https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocv) for preprocessing before recognition:

```ts
import { ImageProcessor, CanvasProcessor } from "ppu-ocv";
const processor = new ImageProcessor(bodyCanvas);

// For non-OpenCV environments (e.g. browser extensions)
// const processor = new CanvasProcessor(bodyCanvas)

processor.grayscale().blur();
const canvas = processor.toCanvas();
processor.destroy();
```

## Processing Engine

Two image processing backends are available for detection preprocessing and recognition resizing:

| Engine            | Default | OpenCV Required | Notes                                               |
| :---------------- | :-----: | :-------------: | :-------------------------------------------------- |
| `"opencv"`        |   Yes   |       Yes       | Uses OpenCV.js from `ppu-ocv`. More accurate boxes. |
| `"canvas-native"` |   No    |       No        | Pure canvas from `ppu-ocv/canvas`. Lighter weight.  |

The browser build (`ppu-paddle-ocr/web`) always uses `canvas-native` — OpenCV.js is not bundled in the web entry point.

```ts
// OpenCV (default, recommended)
const service = new PaddleOcrService();

// Canvas-native (no OpenCV dependency)
const service = new PaddleOcrService({
  processing: { engine: "canvas-native" },
});
```

## Web / Browser Support

Import from `ppu-paddle-ocr/web` for browser-native capabilities (`HTMLCanvasElement`, `OffscreenCanvas`, `fetch` buffering).

### Using a Bundler (Vite, Webpack, etc.)

```ts
import { PaddleOcrService } from "ppu-paddle-ocr/web";

const service = new PaddleOcrService();
await service.initialize();

const file = document.getElementById("upload").files[0];

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

### CDN (No Bundler)

See the [live demo](https://pt-perkasa-pilar-utama.github.io/ppu-paddle-ocr/) for a complete ESM/CDN setup.

### WebGPU Acceleration

On WebGPU-capable browsers (Chrome/Edge on Windows/Linux/macOS, Firefox Nightly), ONNX inference automatically runs on the GPU — typically **2–5× faster** with no code changes. The library silently falls back to WASM if WebGPU is unavailable or fails.

Detection runs once during `initialize()` and is fully transparent.

```ts
import { isWebGpuAvailable, getDefaultWebExecutionProviders } from "ppu-paddle-ocr/web";

if (await isWebGpuAvailable()) {
  console.log("WebGPU supported");
}
```

#### Override Provider Preference

```ts
// Force WASM-only
const service = new PaddleOcrService({
  session: {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  },
});
```

> The WASM binaries are still required even when WebGPU is the primary provider (used for graph optimization and fallback ops). Set `ort.env.wasm.wasmPaths` before `initialize()` if you self-host them.

## Models and Language Support

### Default Models

The default **PP-OCRv5 mobile** models are optimized for English and served in ONNX Runtime's `.ort` FlatBuffers format (3–5× faster session creation than `.onnx`):

| Component   | File                               |
| :---------- | :--------------------------------- |
| Detection   | `PP-OCRv5_mobile_det_infer.ort`    |
| Recognition | `en_PP-OCRv5_mobile_rec_infer.ort` |
| Dictionary  | `ppocrv5_en_dict.txt`              |

Portable `.onnx` variants are available at [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models) — point `model.detection` / `model.recognition` at the `.onnx` URLs.

### Cache Location (Node / Bun)

Models are cached under `~/.cache/ppu-paddle-ocr`:

| OS      | Path                                        |
| :------ | :------------------------------------------ |
| macOS   | `~/.cache/ppu-paddle-ocr`                   |
| Linux   | `~/.cache/ppu-paddle-ocr`                   |
| Windows | `C:\Users\<username>\.cache\ppu-paddle-ocr` |

```ts
// Warm the cache (e.g. in CI or Docker builds)
PaddleOcrService.downloadModels();

// Clear the cache
service.clearModelCache();
```

> In the browser, model files are fetched via `fetch()` on every page load and rely on the browser's HTTP cache. For persistent offline caching, use a Service Worker or store the `ArrayBuffer` in IndexedDB.

### Multilingual Support

PP-OCRv5 supports 40+ languages across different script systems. Pre-converted ONNX models are available at [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models):

- **Latin**: English, French, German, Italian, Spanish, Portuguese, and 40+ others
- **Cyrillic**: Russian, Ukrainian, Bulgarian, Kazakh, Serbian, and 30+ related
- **Arabic**: Arabic, Persian, Urdu, Kurdish
- **Indic**: Hindi (Devanagari), Tamil, Telugu
- **East Asian**: Korean, Japanese
- **Southeast Asian**: Thai

### Switching Languages

```ts
const MODEL_BASE =
  "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";
const DICT_BASE =
  "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";

// Thai
const service = new PaddleOcrService({
  model: {
    detection: `${MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    recognition: `${MODEL_BASE}/recognition/multi/thai/v5/th_PP-OCRv5_mobile_rec_infer.onnx`,
    charactersDictionary: `${DICT_BASE}/recognition/multi/thai/v5/ppocrv5_th_dict.txt`,
  },
});
```

### Server Models (Higher Accuracy)

PP-OCRv5 is available in mobile and server variants:

```ts
const service = new PaddleOcrService({
  model: {
    detection: `${MODEL_BASE}/detection/PP-OCRv5_server_det_infer.onnx`,
    recognition: `${MODEL_BASE}/recognition/multi/en/v5/en_PP-OCRv5_server_rec_infer.onnx`,
    charactersDictionary: `${DICT_BASE}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
  },
});
```

### INT8 Quantization

The recognition model's transformer MatMul operations can be dynamically quantized to INT8 with **no accuracy loss** (measured 99.22% → 99.22%) and a 20–50% speedup on **x86-64 CPUs with VNNI** and **WebAssembly**.

> On Apple Silicon (M-series), INT8 is **not faster** — the FP32 NEON/Accelerate kernels outperform the INT8 MLAS path. Stick with FP32 on macOS ARM64.

Run the quantization helper:

```bash
pip install onnxruntime onnx sympy
python examples/quantize-onnx.py /path/to/en_PP-OCRv5_mobile_rec_infer.onnx
# -> produces en_PP-OCRv5_mobile_rec_infer_int8.onnx
```

Use the quantized model via `model.recognition`:

```ts
const service = new PaddleOcrService({
  model: {
    recognition: "https://example.com/en_PP-OCRv5_mobile_rec_infer_int8.onnx",
  },
});
```

INT8 `.ort` variants are also available in the [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models) repo.

### Model Output Limitations

- **Tables**: Text within table cells is detected, but table structure is not preserved.
- **Math formulas**: Not optimized for mathematical notation.
- **Document layout**: For layout detection, see PP-DocLayoutV2/V3 models in [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models).

### Converting Custom PaddlePaddle Models

See the [ONNX conversion guide](./examples/convert-onnx.ipynb).

## Configuration Reference

### `PaddleOptions`

```ts
import type { PaddleOptions } from "ppu-paddle-ocr";

export type PaddleOptions = {
  model?: ModelPathOptions;
  detection?: DetectionOptions;
  recognition?: RecognitionOptions;
  debugging?: DebuggingOptions;
  session?: SessionOptions;
  processing?: ProcessingOptions;
};
```

### `RecognizeOptions`

Per-call options for `recognize()`.

| Property     |                   Type                    |     Default     | Description                                      |
| :----------- | :---------------------------------------: | :-------------: | :----------------------------------------------- |
| `flatten`    |                 `boolean`                 |     `false`     | Return flat results instead of grouped by lines. |
| `strategy`   | `"per-box" \| "per-line" \| "cross-line"` | service default | Override strategy for this call.                 |
| `dictionary` |          `string \| ArrayBuffer`          |     `null`      | Custom character dictionary (disables caching).  |
| `noCache`    |                 `boolean`                 |     `false`     | Bypass the result cache.                         |

### `ModelPathOptions`

| Property               |          Type           |             Default / Required             | Description                                     |
| :--------------------- | :---------------------: | :----------------------------------------: | :---------------------------------------------- |
| `detection`            | `string \| ArrayBuffer` |       Optional (uses default model)        | Path, URL, or buffer for the detection model.   |
| `recognition`          | `string \| ArrayBuffer` |       Optional (uses default model)        | Path, URL, or buffer for the recognition model. |
| `charactersDictionary` | `string \| ArrayBuffer` | Optional (uses default English dictionary) | Path, URL, or buffer of the dictionary file.    |

> Leave a trailing newline in your dictionary file.

### `DetectionOptions`

Controls preprocessing and filtering during text detection.

| Property               |            Type            |         Default         | Description                                             |
| :--------------------- | :------------------------: | :---------------------: | :------------------------------------------------------ |
| `mean`                 | `[number, number, number]` | `[0.485, 0.456, 0.406]` | Per-channel mean for input normalization [R, G, B].     |
| `stdDeviation`         | `[number, number, number]` | `[0.229, 0.224, 0.225]` | Per-channel std dev for input normalization.            |
| `maxSideLength`        |          `number`          |          `640`          | Longest side limit (px); larger images are scaled down. |
| `paddingVertical`      |          `number`          |          `0.4`          | Fractional vertical padding per detected box.           |
| `paddingHorizontal`    |          `number`          |          `0.6`          | Fractional horizontal padding per detected box.         |
| `minimumAreaThreshold` |          `number`          |          `50`           | Minimum box area (px²); smaller boxes are discarded.    |

### `RecognitionOptions`

Controls recognition preprocessing and strategy.

| Property               |                   Type                    |   Default    | Description                                       |
| :--------------------- | :---------------------------------------: | :----------: | :------------------------------------------------ |
| `imageHeight`          |                 `number`                  |     `48`     | Fixed height for resized text line images (px).   |
| `strategy`             | `"per-box" \| "per-line" \| "cross-line"` | `"per-line"` | Recognition strategy (see above).                 |
| `crossLineWidthFactor` |                 `number`                  |    `1.0`     | Batch width multiplier for `cross-line` strategy. |
| `charactersDictionary` |                `string[]`                 |     `[]`     | Loaded character dictionary for result decoding.  |

### `DebuggingOptions`

| Property      |   Type    | Default | Description                                    |
| :------------ | :-------: | :-----: | :--------------------------------------------- |
| `verbose`     | `boolean` | `false` | Detailed console logs of each processing step. |
| `debug`       | `boolean` | `false` | Write intermediate image frames to disk.       |
| `debugFolder` | `string`  | `"out"` | Output directory for debug images.             |

### `SessionOptions`

Any valid ONNX Runtime `InferenceSession.SessionOptions` property is accepted. ppu-paddle-ocr sets these defaults:

| Property                 |                            Type                            |    Default     | Description                                                           |
| :----------------------- | :--------------------------------------------------------: | :------------: | :-------------------------------------------------------------------- |
| `executionProviders`     |          `string[] \| ExecutionProviderConfig[]`           |   `['cpu']`    | Execution providers for inference. Accepts strings or config objects. |
| `graphOptimizationLevel` | `'disabled' \| 'basic' \| 'extended' \| 'layout' \| 'all'` |    `'all'`     | ONNX graph optimization level.                                        |
| `enableCpuMemArena`      |                         `boolean`                          |     `true`     | Enable CPU memory arena for better memory management.                 |
| `enableMemPattern`       |                         `boolean`                          |     `true`     | Enable memory pattern optimization.                                   |
| `executionMode`          |                `'sequential' \| 'parallel'`                | `'sequential'` | Execution mode for the session.                                       |
| `interOpNumThreads`      |                          `number`                          |      `0`       | Inter-op threads (0 = ONNX decides).                                  |
| `intraOpNumThreads`      |                          `number`                          |      `0`       | Intra-op threads (0 = ONNX decides).                                  |

```ts
const service = new PaddleOcrService({
  session: {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  },
});
```

### `ProcessingOptions`

| Property |             Type              |  Default   | Description                           |
| :------- | :---------------------------: | :--------: | :------------------------------------ |
| `engine` | `"opencv" \| "canvas-native"` | `"opencv"` | Image processing backend (see above). |

## Benchmark

Run `bun task bench`. Results on Apple M1 / Bun 1.3.13:

```bash
benchmark                           avg (min … max) p75 / p99    (min … top 1%)
--------------------------------------------------- -------------------------------
[per-line][opencv][noCache]          188.75 ms/iter 188.89 ms
[cross-line][opencv][noCache]        193.43 ms/iter 190.81 ms
[per-box][opencv][noCache]           206.60 ms/iter 207.79 ms

[per-line][canvas-native][noCache]   200.04 ms/iter 199.92 ms
[cross-line][canvas-native][noCache] 198.32 ms/iter 198.70 ms
[per-box][canvas-native][noCache]    212.86 ms/iter 212.75 ms

=== Accuracy on receipt.jpg (ground truth: 383 chars) ===
  [opencv]       per-box=97.91%  per-line=99.22%  cross-line=96.34%
  [canvas-native] per-box=97.65% per-line=98.43%  cross-line=97.65%
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code-quality requirements, and the pull request process.

## License

MIT — see [LICENSE](LICENSE).

## Support

[Open an issue](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues) or join our [Slack community](https://join.slack.com/t/ppupaddleocrcommunity/shared_invite/zt-3uzp1uuma-lrkEq8OYBYhGdUtzRoVmUg).

## Scripts

Recommended development environment is Linux-based. Library template: https://github.com/aquapi/lib-template

| Script                        | Command                                         | Description                                               |
| :---------------------------- | :---------------------------------------------- | :-------------------------------------------------------- |
| `bun task build`              | `bun run scripts/build.ts`                      | Emit `.js` and `.d.ts` to `lib/`.                         |
| `bun task publish`            | `bun run scripts/publish.ts`                    | Stage `package.json` + `README.md` to `lib/` and publish. |
| `bun task bench`              | `bun run scripts/bench.ts`                      | Run `*.bench.ts` files.                                   |
| `bun task bench --node index` | Run benchmark with Node.js for a specific file. |

To run a specific benchmark file:

```bash
bun task bench index     # Run bench/index.bench.ts
bun task bench --node    # Run all benchmarks with Node.js
```
