---
name: skill-ppu-paddle-ocr
description: Use this skill whenever the user is writing TypeScript/JavaScript code that imports `ppu-paddle-ocr`, `ppu-paddle-ocr/web`, or `ppu-paddle-ocr/mobile`, or asks about PaddleOCR / PP-OCRv6 / PP-OCRv5 in JavaScript runtimes — text detection, text recognition, OCR on receipts/invoices/documents, ONNX Runtime OCR, multilingual OCR (Latin, Cyrillic, Arabic, Indic, CJK, Thai), WebGPU OCR in browsers, browser-extension OCR, React Native / Expo OCR on iOS and Android (Skia + onnxruntime-react-native), INT8-quantized recognition, custom dictionaries, recognition strategies (`per-box` / `per-line` / `cross-line`), or processing engines (`opencv` / `canvas-native`). Trigger even when the user says "PaddleOCR in Node", "OCR library that runs in Bun and the browser", or "OCR in React Native" without naming the package, as long as the codebase imports it. This skill encodes the three entry points (`ppu-paddle-ocr`, `ppu-paddle-ocr/web`, and `ppu-paddle-ocr/mobile`), the lifecycle (`new` → `initialize` → `recognize` → `destroy`), detection-only inference (`detect()` — bounding boxes, optional PNG crops), the strategy/engine trade-offs, the model-cache behaviour on Node/Bun, the WebGPU fallback path on web, and the Skia / native-JSI path on React Native. Also covers running OCR as a dockerized REST API via the `apps/serve` service (Hono + Bun) when the user wants OCR-as-a-service or a deployable container instead of embedding the SDK.
---

# Writing code with `ppu-paddle-ocr`

`ppu-paddle-ocr` is a TypeScript SDK around the PP-OCR ONNX models (PP-OCRv6 by default; v3–v5 presets available). One package, one API, every JavaScript runtime — Node.js, Bun, Deno, browsers, browser extensions, and React Native (iOS/Android). It pairs a text-detection model with a text-recognition model and decodes them with a character dictionary; the package ships the PP-OCRv6 small unified multilingual models by default and downloads them on first run.

The two things that bite people first are (1) picking the right entry point for the runtime, and (2) understanding that the service has a real lifecycle — you must `await initialize()` before `recognize()`, and call `destroy()` to free ONNX sessions. Everything else is configuration.

## The three entry points

| Import path             | Runtime                                 | Canvas backend                                           | Processing engine                                                              | Model loading                                                      |
| ----------------------- | --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `ppu-paddle-ocr`        | **Node.js, Bun, Deno** servers and CLIs | `@napi-rs/canvas` via `ppu-ocv`                          | `"opencv"` (default, more accurate) or `"canvas-native"`                       | Cached on disk under `~/.cache/ppu-paddle-ocr`                     |
| `ppu-paddle-ocr/web`    | **Browsers and browser extensions**     | `HTMLCanvasElement` / `OffscreenCanvas`                  | Always `"canvas-native"` — OpenCV.js is **not bundled** in the web entry point | Fetched via `fetch()` every page load (relies on HTTP cache)       |
| `ppu-paddle-ocr/mobile` | **React Native (iOS / Android)**        | `@shopify/react-native-skia` via `ppu-ocv/canvas-mobile` | Always `"canvas-native"` — no OpenCV on RN                                     | Fetched via `fetch()` each `initialize()` (no built-in disk cache) |

Hard rules:

- The peer dependency depends on the entry point: install `onnxruntime-node` for `ppu-paddle-ocr`, `onnxruntime-web` for `ppu-paddle-ocr/web`, and `onnxruntime-react-native` **+ `@shopify/react-native-skia`** for `ppu-paddle-ocr/mobile`. All are **optional** peer deps so the install only pulls what you actually use.
- Setting `processing.engine = "opencv"` on the `/web` or `/mobile` import is silently ignored — `canvas-native` is the only available backend off Node/Bun.
- `PaddleOcrService.downloadModels()` and `service.clearModelCache()` are Node/Bun-only (they touch the filesystem). On the web and mobile builds they are not defined.
- The `/mobile` entry needs native modules, so it requires a **dev client or `expo prebuild` — not Expo Go**. Targets RN ≥ 0.74 / Expo SDK ≥ 51 (Hermes). Inference is CPU by default; pass `session: { executionProviders: ["nnapi"] }` (Android) or `["coreml"]` (iOS) to opt into hardware acceleration. There is no WebGPU on RN.

When the user describes their runtime in any concrete way ("Bun CLI", "Cloudflare Workers", "Chrome MV3 service worker", "Vite frontend", "Expo app"), bind the import path to that constraint immediately rather than echoing a generic snippet.

## The lifecycle contract

Every program follows the same four beats:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr"; // or "ppu-paddle-ocr/web" / "ppu-paddle-ocr/mobile"

const service = new PaddleOcrService(/* PaddleOptions? */);
await service.initialize(); // 1. download/load models, build ONNX sessions
const result = await service.recognize(image); // 2. run detection → recognition
// ...possibly more recognize() calls reusing the same service...
await service.destroy(); // 3. release ONNX sessions
```

`initialize()` is what fetches the models, parses the dictionary, and builds the detection + recognition `InferenceSession`s. Until it resolves, `recognize()` will lazy-init on the first call (it's safe but slower and harder to reason about — prefer to await `initialize()` explicitly at startup).

`destroy()` calls `release()` on both ONNX sessions and nulls them out. In a long-lived server, **do not destroy after every request** — instantiate one `PaddleOcrService` per process, keep it warm, share it across requests, and only destroy on graceful shutdown. Each `initialize()` re-downloads the model from disk into the WASM/native ONNX runtime, which is expensive.

`isInitialized()` is available as a cheap "is this service ready?" check before sending it to a request handler.

## What `recognize()` accepts and returns

`recognize(image, options?)` accepts:

- `string` — must be either an absolute filesystem path (Node/Bun) or an `http(s)://` URL. Relative paths are rejected with an explicit error. On web and React Native, only URLs work.
- `ArrayBuffer` — raw image bytes (PNG/JPEG/WEBP, anything `ppu-ocv` can decode). The most universal input, and the usual one on React Native (a captured/bundled frame).
- A canvas — `@napi-rs/canvas` `Canvas` on Node/Bun, `HTMLCanvasElement` / `OffscreenCanvas` on web, or a Skia-backed canvas on React Native. Useful when you've already preprocessed the image and want to skip a re-decode.

Returns one of:

```ts
type PaddleOcrResult = {
  text: string; // full text, lines joined by "\n"
  lines: RecognitionResult[][]; // grouped by visual line, each line sorted left-to-right
  confidence: number; // mean confidence across all items, 0..1
};

type FlattenedPaddleOcrResult = {
  text: string; // all items joined by " "
  results: RecognitionResult[]; // flat, in reading order
  confidence: number;
};

type RecognitionResult = {
  text: string;
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
};
```

Pass `{ flatten: true }` to get the flat shape — useful for search indexing or when you don't care about line structure. Default is grouped (`lines`).

If detection finds zero boxes, `recognize()` returns an empty result (`text: ""`, `lines: []` or `results: []`, `confidence: 0`) — it does not throw. Callers should branch on `result.lines.length === 0` (or `result.text === ""`) rather than wrapping in try/catch.

## Detection-only inference: `detect()`

When the user only needs layout — where the text is, not what it says — point them at `detect(image, options?)` instead of `recognize()`. It runs just the detection model and returns `{ boxes: Box[] }` in original image coordinates. Same accepted inputs as `recognize()`, available on all three entry points, and also exposed as the CLI `detect` command and the serve app's `POST /v1/detect`.

```ts
const { boxes } = await service.detect(imageBuffer);

// PNG crops of each region, index-aligned with boxes
const { crops } = await service.detect(imageBuffer, { crop: true });

// Write crops to disk as crop_000.png, crop_001.png, ... (Node/Bun only)
await service.detect(imageBuffer, { saveCropsTo: "./regions" });
```

`DetectOptions` extends `DetectionOptions`, so any tuning field (`maxSideLength`, `minimumAreaThreshold`, paddings, `mean`, `stdDeviation`) can be overridden per call without touching the service defaults. Platform limits: `saveCropsTo` is ignored on web/mobile (no filesystem); `crop: true` throws on React Native (the Skia canvas has no PNG encoder). `detect()` results are not cached — the result cache only covers `recognize()`.

## The result cache

`recognize()` caches results in-memory keyed by a hash of the input image bytes. This means calling `recognize()` twice with the same `ArrayBuffer` (or the same canvas serialised the same way) returns the cached result instantly — including the same `flatten`/grouped shape.

Cache is bypassed in two cases:

- `options.noCache === true`
- `options.dictionary` is set (custom dictionary always re-runs)

Custom dictionaries disable the cache because the cache key only hashes the image, not the decoding alphabet — re-using a cached entry decoded with a different dict would return wrong text.

When benchmarking or iterating on detection/recognition options, set `noCache: true` or you'll see suspiciously fast "second runs" that are actually just cache hits.

## Recognition strategies — the speed/accuracy lever

Three strategies control how detected boxes are batched into recognition inferences:

| Strategy     | Inferences                  | Best for                                                                      |
| :----------- | :-------------------------- | :---------------------------------------------------------------------------- |
| `per-box`    | One per box (most)          | **Default.** Highest accuracy; recognizes each region in isolation.           |
| `per-line`   | One per visual line (fewer) | Dense, multi-word-per-line documents — fewer inferences, line context.        |
| `cross-line` | Bin-packed batches (fewest) | Throughput-sensitive workloads with dense text. Slight accuracy hit possible. |

On sparse receipts the three strategies are within ~1% on speed (inference count only dominates wall-clock on dense pages), so `per-box` defaults to the most accurate. Switch to `per-line` / `cross-line` when a page has many words per line and throughput matters.

Set globally on construction, or override per call:

```ts
// global
const service = new PaddleOcrService({
  recognition: { strategy: "cross-line", crossLineWidthFactor: 1.2 },
});

// per call — overrides for this recognize() only
const result = await service.recognize(buffer, { strategy: "per-box" });
```

`crossLineWidthFactor` only matters for `cross-line` — it's a width multiplier on the bin-pack target. Larger packs more lines per batch (faster, slight accuracy loss); smaller keeps lines isolated (slower, closer to `per-line` accuracy). Default `1.0` is a sane starting point.

When the user says "make it faster" without naming a strategy, suggest `per-line` first (then `cross-line` for dense pages); `per-box` is already the default. When they say "make it more accurate", they're already on `per-box` — point them at a server/larger model (see below) or detection tuning instead.

## Processing engines — `opencv` vs `canvas-native`

`processing.engine` controls the image-processing backend used for detection preprocessing and recognition crop resizing.

- `"opencv"` (default on Node/Bun): uses `ppu-ocv` with OpenCV.js. More accurate box geometry, especially around tilted/rotated text. Requires OpenCV.js WASM (loaded via `ppu-ocv`).
- `"canvas-native"`: pure canvas operations via `ppu-ocv/canvas`. Lighter weight, no OpenCV dependency. Slight accuracy loss on the detection side (~1–2% on receipts).

```ts
const service = new PaddleOcrService({
  processing: { engine: "canvas-native" },
});
```

The `/web` entry point always uses `canvas-native` regardless of this flag — OpenCV.js is not in the web bundle. If a user is on the web build and asks for OpenCV-grade accuracy, the answer is "preprocess upstream with `ppu-ocv/web`" (which does ship OpenCV), then pass the cleaned canvas into `recognize()`.

## Default models, the cache, and how to warm it

By default, `initialize()` fetches three files from `media.githubusercontent.com` and caches them under `~/.cache/ppu-paddle-ocr` (Node/Bun only):

| Component   | File                     | Purpose                         |
| :---------- | :----------------------- | :------------------------------ |
| Detection   | `PP-OCRv6_small_det.ort` | Finds text bounding boxes       |
| Recognition | `PP-OCRv6_small_rec.ort` | Decodes each crop to a string   |
| Dictionary  | `ppocrv6_dict.txt`       | Character alphabet for decoding |

The `.ort` format is ONNX Runtime's FlatBuffers serialization — 3–5× faster session creation than `.onnx`. You only need `.onnx` when you're targeting a runtime that lacks `.ort` support, or when you've manually quantized.

In CI, Docker builds, or test suites, warm the cache up-front with the static method so first-run download latency doesn't dominate test time:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

await PaddleOcrService.downloadModels({ verbose: true });
// later, possibly in a different process:
const service = new PaddleOcrService();
await service.initialize(); // hits the cache, no network
```

`downloadModels` is a **static** method — call it on the class, not an instance. It also takes `{ verbose: true }` to log each download.

To clear the cache (e.g. after a model upgrade): `service.clearModelCache()`.

In the browser (and on React Native), there is no on-disk cache. Models are fetched on every page load / `initialize()` and rely on HTTP caching. For real offline support, the user should download the model once with `fetch`, persist the `ArrayBuffer` (IndexedDB on web, the filesystem on RN), and then pass it explicitly via `model.detection` / `model.recognition` / `model.charactersDictionary`.

## Custom and multilingual models

The default PP-OCRv6 small bundle is a single unified model covering 50+ languages (Simplified/Traditional Chinese, English, Japanese, 46+ Latin-script languages, Arabic, Indic, …) — for most multilingual workloads you don't need to switch models at all.

Prefer the exported preset constants over hand-written URLs — they autocomplete and are validated by the type system. Import from `ppu-paddle-ocr` (or `ppu-paddle-ocr/web`):

```ts
import {
  PaddleOcrService,
  V6_SMALL_MODEL,
  V6_TINY_MODEL,
  V5_EN_MOBILE_MODEL,
} from "ppu-paddle-ocr";

const fast = new PaddleOcrService({ model: V6_TINY_MODEL }); // fastest, smaller dict
const english = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL }); // English-specialized, higher Latin-only accuracy
```

The catalogue covers PP-OCRv6 (`V6_SMALL_MODEL` default, `V6_MEDIUM_MODEL`, `V6_TINY_MODEL`), PP-OCRv5 (English/server/INT8 + per-script: `V5_THAI_MOBILE_MODEL`, `V5_ARABIC_MOBILE_MODEL`, `V5_CYRILLIC_MOBILE_MODEL`, …), PP-OCRv4, and PP-OCRv3. `DEFAULT_MODEL` aliases the current default. The pre-converted ONNX/`.ort` files behind every preset live in [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models). To use a script-specific v5 model (or any custom export), point all three model paths at the files:

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

For best accuracy at the cost of latency, swap the mobile recognition/detection models for `_server_` variants from the same repo. For best CPU throughput on x86-64 with VNNI or for WebAssembly, swap the recognition model for an INT8 quantized variant — measured accuracy stays at 99.22% on receipt benchmarks while inference speeds up 20–50%. **Do not use INT8 on Apple Silicon** — FP32 NEON outperforms the INT8 MLAS path there.

Three formats for any model/dictionary path:

```ts
new PaddleOcrService({
  model: {
    detection: "./models/det.onnx", // local file path
    recognition: "https://example.com/rec.onnx", // http(s) URL
    charactersDictionary: customDictArrayBuffer, // ArrayBuffer (already in memory)
  },
});
```

If the user is shipping a custom dictionary, **leave a trailing newline** at the end of the dictionary file. Missing it drops the last character.

## Changing models on a live service

Sometimes you want to keep the service warm and just swap one component — e.g. recognize Thai for one batch and English for the next without rebuilding the detection session. Three runtime swappers exist:

```ts
await service.changeDetectionModel("./models/new-det.onnx");
await service.changeRecognitionModel("./models/new-rec.onnx");
await service.changeTextDictionary("./models/new-dict.txt");
```

Each releases the old session/dictionary and rebuilds just that component. For one-off custom dictionaries on a single call, prefer `recognize(image, { dictionary: ... })` — it doesn't disturb the service-wide config.

## The web entry point and WebGPU

```ts
import {
  PaddleOcrService,
  isWebGpuAvailable,
  getDefaultWebExecutionProviders,
} from "ppu-paddle-ocr/web";

if (await isWebGpuAvailable()) console.log("WebGPU enabled");

const service = new PaddleOcrService();
await service.initialize();

const file = (document.getElementById("upload") as HTMLInputElement).files![0];
const img = new Image();
img.src = URL.createObjectURL(file);
await new Promise((r) => (img.onload = r));

const canvas = document.createElement("canvas");
canvas.width = img.width;
canvas.height = img.height;
canvas.getContext("2d")!.drawImage(img, 0, 0);

const result = await service.recognize(canvas);
```

On WebGPU-capable browsers (Chrome/Edge on Windows/Linux/macOS, Firefox Nightly), inference automatically runs on the GPU — typically 2–5× faster — with no code change. The library silently falls back to WASM if WebGPU isn't available or fails at session-build time.

To force WASM (e.g. to make benchmarks comparable, or because WebGPU is misbehaving on a target):

```ts
const service = new PaddleOcrService({
  session: {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  },
});
```

The WASM binaries are still required even when WebGPU is the primary provider — they're used for graph optimization and fallback ops. If the user is self-hosting onnxruntime-web's WASM files, they must set `ort.env.wasm.wasmPaths` **before** `initialize()`.

For CDN / no-bundler setups, point at the published ESM build directly (see the live demo at https://ppu-paddle-ocr.snowfluke.workers.dev/ for a complete reference).

## The React Native (mobile) entry point

`ppu-paddle-ocr/mobile` runs the same pipeline on iOS/Android via `onnxruntime-react-native` (native JSI) and `ppu-ocv/canvas-mobile` (Skia). Install `onnxruntime-react-native` and `@shopify/react-native-skia`, and use a dev client / `expo prebuild` (Expo Go can't load the native modules). Feed `recognize()` an `ArrayBuffer` — e.g. a bundled asset or a frame from `expo-camera` / `react-native-vision-camera`:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr/mobile";
import { Asset } from "expo-asset";

const service = new PaddleOcrService(); // CPU by default; { session: { executionProviders: ["nnapi"] } } on Android
await service.initialize();

const asset = Asset.fromModule(require("./assets/receipt.jpg"));
await asset.downloadAsync();
const bytes = await (await fetch(asset.localUri ?? asset.uri)).arrayBuffer();

const result = await service.recognize(bytes, { flatten: true });
console.log(result.text, result.confidence);

await service.destroy();
```

Camera capture is out of scope — the user passes a decoded frame. There is no on-disk model cache on mobile (like web, models are fetched each `initialize()`); pass a lighter preset such as `V5_EN_MOBILE_INT8_MODEL` if first-run download size matters. A runnable Expo example lives at https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-mobile-react-native-demo.

## Configuration cheat sheet

The full `PaddleOptions` shape — everything you can pass into the constructor:

```ts
type PaddleOptions = {
  model?: {
    detection?: string | ArrayBuffer;
    recognition?: string | ArrayBuffer;
    charactersDictionary?: string | ArrayBuffer;
  };
  detection?: {
    mean?: [n, n, n];
    stdDeviation?: [n, n, n];
    maxSideLength?: number;
    paddingVertical?: number;
    paddingHorizontal?: number;
    minimumAreaThreshold?: number;
  };
  recognition?: {
    imageHeight?: number;
    strategy?: "per-box" | "per-line" | "cross-line";
    crossLineWidthFactor?: number;
  };
  debugging?: { verbose?: boolean; debug?: boolean; debugFolder?: string };
  session?: InferenceSession.SessionOptions; // any onnxruntime SessionOptions
  processing?: { engine?: "opencv" | "canvas-native" };
};
```

Don't reach for the detection/recognition tuning options unless the user has a concrete accuracy or performance issue and a reproducible image. Defaults are tuned for receipts/documents at typical resolutions. Full reference with defaults and tuning notes is in [`references/configuration.md`](references/configuration.md).

`debugging.debug = true` writes intermediate frames to `debugging.debugFolder` (default `"out"`). It only works on Node/Bun (browsers can't write to disk). Use it when accuracy is off and you want to see what detection actually saw.

## Common mistakes to flag

When reviewing or writing ppu-paddle-ocr code, watch for these:

- **Calling `recognize()` without awaiting `initialize()` first.** It will lazy-init, but you lose the chance to surface model-download failures at startup. Always `await service.initialize()` once before serving traffic.
- **Calling `service.destroy()` after every request in a server.** This destroys the warm ONNX sessions; the next request pays the full re-initialize cost. One service per process, destroyed only on shutdown.
- **Passing a relative path string to `recognize()`.** Strings must be absolute paths or `http(s)://` URLs — the SDK explicitly checks. Read the file into an `ArrayBuffer` first, or resolve the path with `path.resolve()`.
- **Importing `PaddleOcrService` from `ppu-paddle-ocr` in a browser bundle.** That entry point pulls in `@napi-rs/canvas` and OpenCV.js Node bindings — bundlers will choke. Use `ppu-paddle-ocr/web`.
- **Setting `processing.engine = "opencv"` on the web build.** Silently ignored. If OpenCV-grade preprocessing matters, do it upstream with `ppu-ocv/web` and feed the result canvas into `recognize()`.
- **Using INT8 quantization on Apple Silicon.** It's _slower_ than FP32 there. INT8 is for x86-64 with VNNI and for WebAssembly.
- **Forgetting the trailing newline in a custom dictionary.** Drops the last character of the alphabet — silently corrupts recognition for any text containing it.
- **Benchmarking without `noCache: true`.** The result cache will return cached hits for repeated identical images, making the second run look impossibly fast.
- **Treating "zero text detected" as an error.** `recognize()` returns an empty result (`text: ""`) — branch on the result shape, don't wrap in try/catch.
- **Calling `PaddleOcrService.downloadModels()` on the web build.** It's a Node-only static method; it doesn't exist in `ppu-paddle-ocr/web`.

## Canonical Node / Bun pipeline

Single-shot CLI on Bun:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const service = new PaddleOcrService({
  recognition: { strategy: "per-line" },
  debugging: { verbose: true },
});

await service.initialize();

const buffer = await Bun.file("./assets/receipt.jpg").arrayBuffer();
const result = await service.recognize(buffer);

console.log(result.text);
console.log(`mean confidence: ${(result.confidence * 100).toFixed(1)}%`);

await service.destroy();
```

Long-running server (Express/Hono/Elysia/etc.) — initialize once at boot, share the instance:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const ocr = new PaddleOcrService();
await ocr.initialize();

app.post("/ocr", async (req, res) => {
  const buf = await readBody(req); // ArrayBuffer
  const result = await ocr.recognize(buf, { flatten: true });
  res.json(result);
});

process.on("SIGTERM", async () => {
  await ocr.destroy();
  process.exit(0);
});
```

## Canonical browser pipeline (with bundler)

```ts
import { PaddleOcrService } from "ppu-paddle-ocr/web";

const service = new PaddleOcrService();
await service.initialize();

input.addEventListener("change", async () => {
  const file = input.files![0];
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);

  const result = await service.recognize(canvas);
  output.textContent = result.text;
});
```

## Browser-extension pipeline (Chrome MV3)

In a Manifest V3 extension, bundle `ppu-paddle-ocr/web` with the extension's bundler. WebGPU is generally available in extension service workers but verify with `isWebGpuAvailable()`. If models need to be served from the extension package itself (rather than fetched from GitHub), pass `chrome.runtime.getURL("models/...")` as the model paths — they're just URLs.

A complete reference extension is at https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-extension.

## Pairing with `ppu-ocv` for preprocessing

PaddleOCR works best on grayscale or thresholded inputs. For low-quality scans, dim photos, or skewed receipts, preprocess with `ppu-ocv` first, then pass the cleaned canvas into `recognize()`:

```ts
import { ImageProcessor, CanvasProcessor } from "ppu-ocv";
import { PaddleOcrService } from "ppu-paddle-ocr";

await ImageProcessor.initRuntime();

const buffer = await Bun.file("./assets/receipt.jpg").arrayBuffer();
const canvas = await CanvasProcessor.prepareCanvas(buffer);

const processor = new ImageProcessor(canvas);
const cleaned = processor
  .grayscale()
  .blur({ size: [3, 3] })
  .toCanvas();

const service = new PaddleOcrService();
await service.initialize();
const result = await service.recognize(cleaned);

processor.destroy();
await service.destroy();
```

If you're already using `ppu-ocv` extensively, the `skill-ppu-ocv` skill covers the preprocessing pipeline in depth — perspective warp, deskew, contour-based receipt extraction, and the OpenCV memory model.

## OCR as an HTTP service (don't embed the SDK)

If the user wants OCR-as-a-service — a running endpoint to POST images to, rather than embedding the SDK in their own process — point them at **`apps/serve`** in the repo: a production-grade REST API (Hono + Bun, dockerized) that wraps this library. It's the right answer when the consumer isn't a JS/TS program, when they want a language-agnostic HTTP boundary, or when they ask for "an OCR API / a docker image".

```bash
docker run -p 8080:8080 ghcr.io/pt-perkasa-pilar-utama/ppu-paddle-ocr/serve:latest
curl -F file=@receipt.jpg http://localhost:8080/v1/ocr
```

What it provides on top of the raw SDK: one warmed `PaddleOcrService` behind a bounded inference queue (backpressure, no OOM/VRAM blow-up), sync / batch / SSE-stream / async-task OCR endpoints, a consistent response envelope with a request id, optional bearer auth + rate limiting + IP rules, Prometheus `/metrics`, and an OpenAPI spec rendered at `/docs`. Config is via env vars; models are pre-baked into the image (zero cold start). Use the standalone SDK (the rest of this skill) when you're building a JS/TS app; use the serve API when you want a deployable service. See [`apps/serve/README.md`](../../apps/serve/README.md).

## The command-line interface (don't write a script)

When the user just wants text out of an image — a one-shot, a shell pipeline, a
quick check — point them at the bundled CLI instead of writing a `new → initialize
→ recognize → destroy` script. It ships as a `bin` in the package, so `bunx`/`npx`
run it with no install:

```bash
bunx ppu-paddle-ocr recognize receipt.jpg            # text → stdout
bunx ppu-paddle-ocr recognize page.png --json --pretty
bunx ppu-paddle-ocr batch "scans/*.png" --strategy cross-line --json -o out.json
bunx ppu-paddle-ocr stream "scans/*.png"             # prints each result as it finishes
bunx ppu-paddle-ocr download-models                  # warm the cache
bunx ppu-paddle-ocr clear-cache
bunx ppu-paddle-ocr models --json                    # active models / defaults / providers
```

Rules to remember:

- It's **Node/Bun only** — the `bin` is the `ppu-paddle-ocr` entry point, not `/web`.
- Every constructor / per-call option has a flag: `--strategy`, `--engine`,
  `--flatten`, `--no-cache`, `--model <preset>` (catalogue key like `v6-tiny` /
  `v5-thai-mobile`; `models --json` lists them), `--model-detection/-recognition/-dict`
  (raw paths/URLs that override the preset), detection tuning (`--max-side-length`,
  `--mean`, `--std`, …), `--execution-providers`, and `--concurrency` for
  batch/stream. Defaults match the SDK (v6 small models, `per-box`, `opencv`).
- **Recognized text → stdout; progress and logs → stderr.** Pipe stdout safely;
  add `-q` to silence stderr. `--json` emits the full result object (NDJSON for
  `stream`); `-o <file>` writes to disk.
- Exit codes: `0` success, `1` runtime error, `2` usage error. An image with no
  detected text still exits `0` with empty output.
- `recognize` is strictly one image; use `batch` (index-aligned JSON) or `stream`
  (results in completion order) for many. Both isolate per-image failures and
  exit `1` if any image failed.

Reach for the CLI for ad-hoc/scripting use, the SDK when embedding in a JS/TS
program, and `apps/serve` when you need a long-running HTTP service.

## Further reading

- [`references/configuration.md`](references/configuration.md) — every option in `PaddleOptions`, defaults, and when to tune them.
- [`references/recipes.md`](references/recipes.md) — copy-pasteable recipes: warming the cache in CI, swapping languages mid-process, INT8 quantization, WebGPU benchmarking, and graceful shutdown patterns.
