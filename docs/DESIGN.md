# Design

This document describes what ppu-paddle-ocr does, the actors it interacts with,
and how data flows through it. It complements the API reference in the
[README](../README.md).

## What it is

ppu-paddle-ocr is a library (with an optional CLI and HTTP service) that runs
PaddleOCR ONNX models for text detection and recognition. A developer imports
it into their own Node, Bun, Deno, or browser code and calls it in-process.
Inference runs locally through ONNX Runtime. The library does not phone home;
the only outbound traffic is the one-time default model download from pinned
PaddlePaddle upstream URLs (or none, if models are supplied locally).

## Lifecycle

```ts
const ocr = new PaddleOcrService();
await ocr.initialize(); // load models + ONNX session
const result = await ocr.recognize(image);
await ocr.destroy(); // free sessions and native memory
```

## Actors

| Actor                                  | Role                                             | Trust                                                                                      |
| :------------------------------------- | :----------------------------------------------- | :----------------------------------------------------------------------------------------- |
| Consuming application                  | Calls the API, supplies image data and options   | Trusted (it is the host)                                                                   |
| Image input                            | Bytes or a path the application passes in        | **Untrusted** (may be malformed)                                                           |
| Model files                            | Detection / recognition ONNX models + dictionary | Trusted if from the bundled defaults; **caller-controlled** if a custom path/URL is passed |
| JavaScript runtime                     | Node, Bun, Deno, or a browser engine             | Trusted                                                                                    |
| `onnxruntime-node` / `onnxruntime-web` | Runs ONNX inference (native or WASM/WebGPU)      | Third-party, pinned                                                                        |
| `ppu-ocv`                              | Image preprocessing (OpenCV or canvas-native)    | First-party sibling, pinned                                                                |

## Entry points

| Import               | Inference backend                               | Runtime   |
| :------------------- | :---------------------------------------------- | :-------- |
| `ppu-paddle-ocr`     | `onnxruntime-node`                              | Node, Bun |
| `ppu-paddle-ocr/web` | `onnxruntime-web` (WASM, WebGPU when available) | Browser   |

A CLI ships as the package `bin` (`npx ppu-paddle-ocr …`), and `apps/serve`
wraps the library as an HTTP service.

## Components

- **Detection** locates text boxes in the image.
- **Recognition** reads the text in each box, using a character dictionary.
- **Strategies** (`per-box` / `per-line` / `cross-line`) decide how boxes are
  grouped before recognition.
- **Processing engine** (`opencv` / `canvas-native`) selects how preprocessing
  is done, delegating to `ppu-ocv`.
- **Model cache** stores downloaded models on disk (Node/Bun) so later runs
  skip the download.

## Data flow

```
image bytes / path
        │
        ▼
  decode + preprocess (ppu-ocv)
        │
        ▼
  detection model (ONNX)  ──►  text boxes
        │
        ▼
  recognition model (ONNX) per box/line  ──►  text + scores
        │
        ▼
  assembled result returned to the caller
```

The library reads its input, runs inference in memory, and returns structured
text. On Node/Bun it may read model files from disk and, on first run, download
them. It makes no other network requests and writes only the model cache.

## Why it is split this way

Detection and recognition are separate ONNX sessions so each can be swapped,
quantized, or sized independently. The strategy and engine choices are explicit
options rather than hidden defaults, so callers can trade accuracy for speed.
Keeping `onnxruntime-node` and `onnxruntime-web` behind the two entry points
lets the same API run server-side and in the browser without bundling the
wrong runtime.
