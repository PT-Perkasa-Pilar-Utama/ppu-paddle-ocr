---
title: "Deterministic OCR in JavaScript: PaddleOCR for Node, Bun, Deno, and the Browser"
published: false
description: "A fast, lightweight PaddleOCR SDK that runs in every JavaScript runtime. Built on PP-OCRv5 and ONNX Runtime, with WebGPU acceleration, INT8 quantization, and 40+ languages."
tags: ocr, javascript, webdev, ai
cover_image: https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/main/assets/article-cover.svg
canonical_url:
series: ppu-paddle-ocr
---

![ppu-paddle-ocr cover](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/main/assets/article-cover.svg)

LLMs read text from images now. So why ship a 30 MB OCR model?

Because the receipt your reconciliation job processed last night will be processed again next quarter, and the totals had better match. A GPT-class vision model can hallucinate a `5` into an `8`, drop a decimal, or reorder line items the second time you ask. Cloud OCR also costs money per page, leaks the document outside your network, and breaks the moment the vendor deprecates a model id.

I maintain [`ppu-paddle-ocr`](https://www.npmjs.com/package/ppu-paddle-ocr), an open-source TypeScript SDK for PaddleOCR. It runs the PP-OCRv5 family directly on ONNX Runtime in Node.js, Bun, Deno, the browser, and browser extensions, with the same package and the same API. This post walks through what that buys you, how it compares against the official PaddleOCR JS SDK, Tesseract.js, and LLM OCR, and what is shipping next.

## Why deterministic OCR still matters in the LLM era

Production pipelines need three properties that LLM OCR fights against:

1. **Reproducibility.** Run the same image through the same code on Monday and Friday and get the same string. PP-OCRv5 detection plus recognition is a pair of fixed convolutional and transformer graphs. The output of `recognize("./receipt.jpg")` does not drift between calls.
2. **Auditability.** When a downstream system extracts `$42.50` from a receipt, a finance team can point at the model version, the input image, and the bounding box that produced that string. LLMs give you a paragraph of free-form text and no box geometry.
3. **Latency and cost.** A single receipt takes roughly 190 ms on an M1 with no GPU and zero network calls. The equivalent vision-LLM round trip is two orders of magnitude slower and costs real money per thousand pages.

LLM OCR is great for one-off semantic extraction (give me the vendor name, summarize this contract). It is the wrong tool for "ingest a million invoices a month and never disagree with yourself."

## How the JavaScript OCR landscape compares

![OCR comparison](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/main/assets/article-comparison.svg)

A quick tour of the alternatives:

- **The official PaddleOCR JS SDK** ([`@paddlejs-models/ocr`](https://www.npmjs.com/package/@paddlejs-models/ocr)) runs only in the browser, uses an older PP-OCRv4 graph through paddlejs, and was last touched years ago. You cannot drop it into a Node service.
- **Tesseract.js** ships LSTM-based models from a 20-year-old engine. Accuracy on receipts and modern fonts trails PP-OCRv5 by 5 to 15 character points, and there is no per-line batching, no WebGPU, and no built-in support for non-Latin scripts beyond pre-baked language packs.
- **Vision LLMs** (GPT-4 class, Gemini, Claude with vision) are accurate but stochastic, expensive, and require your image to leave the device. The same image submitted twice can produce different field orderings.
- **`ppu-paddle-ocr`** runs the current PP-OCRv5 graphs through ONNX Runtime, hits 99.22% character accuracy on the receipt benchmark, ships with a single production dependency (`ppu-ocv`), and works in every JavaScript host you are likely to target.

The official SDK and Tesseract.js are not bad pieces of software. They just stop where modern JavaScript starts: server runtimes, edge workers, mobile shells, browser extensions.

## One package, every runtime

![Runtime support](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/main/assets/article-runtimes.svg)

The same `PaddleOcrService` class works in:

| Runtime           | Install                                                              |
| ----------------- | -------------------------------------------------------------------- |
| Node.js           | `npm install ppu-paddle-ocr onnxruntime-node`                        |
| Bun               | `bun add ppu-paddle-ocr onnxruntime-node`                            |
| Deno              | `deno add jsr:@snowfluke/ppu-paddle-ocr`                             |
| Browser           | `npm install ppu-paddle-ocr onnxruntime-web` (import `/web` subpath) |
| Browser extension | Bundle `ppu-paddle-ocr/web` with your MV3 extension                  |
| React Native      | Shipping next (see roadmap below)                                    |

Server runs swap `onnxruntime-node` for native ORT bindings. The browser entry point swaps to `onnxruntime-web` and quietly enables WebGPU when the browser supports it. There is no per-runtime fork of the code: I publish one source tree and two entry points (`ppu-paddle-ocr` for native, `ppu-paddle-ocr/web` for canvas-native).

A receipt-scanner browser extension I ship uses the same `recognize()` call as the Bun-based ingestion pipeline that backs it. That alone removed a class of "works on my laptop, not in the extension" bugs.

## One production dependency

Look at the `dependencies` block in `package.json`:

```json
"dependencies": {
  "ppu-ocv": "^3.1.0"
},
"peerDependencies": {
  "onnxruntime-node": "^1.23.2",
  "onnxruntime-web": "^1.23.2"
}
```

That is the entire runtime footprint. `ppu-ocv` is my own chainable image-processing wrapper (OpenCV.js plus a canvas-native backend). The two ONNX Runtime packages are optional peers; you install whichever one matches the target you ship to, never both.

What that buys you in practice:

- **Predictable bundles.** The browser entry point pulls `onnxruntime-web` and the canvas-native preprocessor. No OpenCV.js in the web bundle, no transitive Tesseract worker scripts, no polyfills you did not ask for.
- **Lockfile sanity.** `npm install ppu-paddle-ocr onnxruntime-node` adds 2 top-level packages and a handful of transitive ones. Compare that to the Tesseract.js install which pulls in WASM core, language data loaders, and a worker bootstrap.
- **No vendor SDK lock-in.** The whole library talks to a documented `InferenceSession` interface. If a future ONNX Runtime build adds a faster execution provider, you upgrade the peer and keep your code.
- **Auditable supply chain.** One prod dep means one transitive tree to review when your security team asks. The smaller that tree, the fewer surprises in a `npm audit` report at 4pm on a Friday.

## What the API looks like

The whole surface is three calls:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const ocr = new PaddleOcrService();
await ocr.initialize();

const { text, lines } = await ocr.recognize("./receipt.jpg");

await ocr.destroy();
```

`initialize()` downloads PP-OCRv5 mobile English by default and caches it under `~/.cache/ppu-paddle-ocr`. `recognize()` accepts a file path, URL, `ArrayBuffer`, `HTMLCanvasElement`, or `OffscreenCanvas`. `destroy()` releases the ONNX sessions.

For browsers, swap one import:

```ts
import { PaddleOcrService } from "ppu-paddle-ocr/web";

const ocr = new PaddleOcrService();
await ocr.initialize();

const result = await ocr.recognize(document.querySelector("canvas")!);
```

## The four-stage pipeline

![Pipeline](https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/main/assets/article-pipeline.svg)

Each `recognize()` call walks four stages:

1. **Decode and normalize** the input image through either OpenCV.js (`ppu-ocv`) or canvas-native preprocessing. Browsers default to canvas-native to keep bundles lean; servers default to OpenCV for tighter bounding boxes.
2. **Run text detection** with `PP-OCRv5_mobile_det_infer.ort`. Output: a set of quadrilateral boxes around every text region.
3. **Choose a recognition strategy.** `per-box` runs one inference per region. `per-line` (the default) merges regions on the same line into one strip. `cross-line` bin-packs strips across lines into uniform batches, which is the fastest option when you have a dense document.
4. **Decode characters** with `en_PP-OCRv5_mobile_rec_infer.ort` against the language dictionary.

The strategy knob exists because reducing inference calls dominates wall-clock time more than any micro-optimization. On the Apple M1 benchmark in the README, `per-line` lands at 188 ms per receipt with 99.22% character accuracy.

## The Paddle model ecosystem you get for free

PP-OCRv5 is not one model. It is a family, and every member has an ONNX export.

- **Mobile vs server.** Mobile models fit in a few megabytes and run on a CPU. Server models trade size for two extra accuracy points on dense or low-quality documents. Swap the URL in your config; the rest of the code is unchanged.
- **40+ languages across five script systems.** Latin (English, French, German, Italian, Spanish, Portuguese, and 40+ others), Cyrillic (Russian, Ukrainian, Bulgarian, Kazakh, Serbian), Arabic (Arabic, Persian, Urdu, Kurdish), Indic (Hindi, Tamil, Telugu), East Asian (Korean, Japanese), and Thai. Each ships as a separate recognition model plus dictionary file. Pre-converted ONNX builds live in [`ppu-paddle-ocr-models`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models).
- **INT8 quantization.** The recognition transformer's MatMul ops quantize to INT8 with no measured accuracy loss (99.22% before, 99.22% after) and a 20 to 50 percent speedup on x86-64 CPUs with VNNI and on WebAssembly. The repo ships a one-line Python script that does the conversion.
- **PP-DocLayout, PP-Structure, PP-FormulaNet.** Layout, table, and formula models from the same Paddle family export the same way. The library loads any ONNX model whose I/O contract matches.

The PaddlePaddle team keeps shipping new versions. Because the runtime is plain ONNX, picking up the next bump is a URL change, not a library upgrade.

## Switching to Thai (or Russian, or Arabic) in five lines

```ts
const MODEL_BASE =
  "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";
const DICT_BASE =
  "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";

const ocr = new PaddleOcrService({
  model: {
    detection: `${MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    recognition: `${MODEL_BASE}/recognition/multi/thai/v5/th_PP-OCRv5_mobile_rec_infer.onnx`,
    charactersDictionary: `${DICT_BASE}/recognition/multi/thai/v5/ppocrv5_th_dict.txt`,
  },
});
```

Detection is script-agnostic. Only the recognition head and dictionary change between languages.

## WebGPU when you can get it, WASM when you can't

In Chrome and Edge on Windows, Linux, and macOS, ORT-Web routes inference through WebGPU on its own. Numbers from the library's demo page: 2 to 5 times faster than WebAssembly on the same hardware, no code changes. When WebGPU is unavailable or a kernel falls back, the library reuses the WASM path without restarting the session.

```ts
import { isWebGpuAvailable } from "ppu-paddle-ocr/web";

if (await isWebGpuAvailable()) {
  console.log("GPU path active");
}
```

Browser extensions feel this difference the most. A receipt-scanner popup that returns text in 300 ms is usable; one that takes 1.5 seconds is not.

## Performance numbers

Benchmarks from the repo, Apple M1, Bun 1.3.13:

```
benchmark                            avg (min … max)
[per-line][opencv][noCache]          188.75 ms/iter
[cross-line][opencv][noCache]        193.43 ms/iter
[per-box][opencv][noCache]           206.60 ms/iter

[per-line][canvas-native][noCache]   200.04 ms/iter
[cross-line][canvas-native][noCache] 198.32 ms/iter
[per-box][canvas-native][noCache]    212.86 ms/iter

Accuracy on receipt.jpg (ground truth: 383 chars):
  [opencv]        per-box=97.91%  per-line=99.22%  cross-line=96.34%
  [canvas-native] per-box=97.65%  per-line=98.43%  cross-line=97.65%
```

Run the same benchmark on your own hardware with `bun task bench`. I also publish a side-by-side comparison against the official SDK at [paddle-ocr-comparison](https://snowfluke.github.io/paddle-ocr-comparison/).

## What's next: React Native and beyond

I'm working on a React Native entry point. ONNX Runtime ships a React Native binding (`onnxruntime-react-native`), so the path is the same approach used for the web build: route the canvas and tensor adapters through a new entry point and reuse the shared pipeline. The target is feature parity with the web build, including WebGPU on Android where the driver supports it.

After that:

- A worker-pool helper for Node so multi-page PDFs fan out across cores without you wiring up `worker_threads`.
- Built-in support for the PP-Structure family for table extraction.
- Streaming results as detection completes, so the first lines render while later regions are still recognizing.

## Get started

```bash
npm install ppu-paddle-ocr onnxruntime-node
```

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";

const ocr = new PaddleOcrService();
await ocr.initialize();
console.log((await ocr.recognize("./your-image.jpg")).text);
await ocr.destroy();
```

Repo: <https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr>
npm: <https://www.npmjs.com/package/ppu-paddle-ocr>
Slack: [PPU PaddleOCR community](https://join.slack.com/t/ppupaddleocrcommunity/shared_invite/zt-3uzp1uuma-lrkEq8OYBYhGdUtzRoVmUg)

If you ship OCR in JavaScript today, give it a run on one of your own samples and open an issue with the result. The roadmap moves on what users actually hit, not what looks good on paper.
