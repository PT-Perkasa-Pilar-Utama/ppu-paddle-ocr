# Design

This document describes what ppu-paddle-ocr does, the actors it interacts with,
and how data flows through it. It complements the API reference in the
[README](../README.md).

## What it is

ppu-paddle-ocr is a library (with an optional CLI and HTTP service) that runs
PaddleOCR PP-OCRv5 models for text detection and recognition. A developer
imports it into their own Node, Bun, Deno, or browser code and calls it
in-process. Inference runs locally through ONNX Runtime. The library does not
phone home; the only outbound traffic is the one-time model download (or none,
if models are supplied locally).

## Lifecycle

```ts
const ocr = new PaddleOcrService();
await ocr.initialize(); // load models + ONNX session
const result = await ocr.recognize(image);
await ocr.destroy(); // free sessions and native memory
```

## Actors

| Actor                                  | Role                                                                                    | Trust                                                                                      |
| :------------------------------------- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| Consuming application                  | Calls the API, supplies image data and options                                          | Trusted (it is the host)                                                                   |
| Image input                            | Bytes or a path the application passes in                                               | **Untrusted** (may be malformed)                                                           |
| Model files                            | Detection / recognition ONNX models + dictionary, plus the unwarping model when enabled | Trusted if from the bundled defaults; **caller-controlled** if a custom path/URL is passed |
| JavaScript runtime                     | Node, Bun, Deno, or a browser engine                                                    | Trusted                                                                                    |
| `onnxruntime-node` / `onnxruntime-web` | Runs ONNX inference (native or WASM/WebGPU)                                             | Third-party, pinned                                                                        |
| `ppu-ocv`                              | Image preprocessing (OpenCV or canvas-native)                                           | First-party sibling, pinned                                                                |

## Entry points

| Import               | Inference backend                               | Runtime   |
| :------------------- | :---------------------------------------------- | :-------- |
| `ppu-paddle-ocr`     | `onnxruntime-node`                              | Node, Bun |
| `ppu-paddle-ocr/web` | `onnxruntime-web` (WASM, WebGPU when available) | Browser   |

A CLI ships as the package `bin` (`npx ppu-paddle-ocr ...`), and `apps/serve`
wraps the library as an HTTP service.

## Components

- **Unwarping** (opt-in, off by default) flattens a photo of a curled, folded,
  or tilted page before detection, so text lines are straight when they are
  detected and read. It is a third ONNX session. The model is PaddleOCR's UVDoc
  cut so that it outputs a 45 x 31 deformation grid instead of a corrected
  image; the library checks the grid, redraws the page in one bilinear pass,
  and maps boxes back to the input photo.
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
        |
        v
  decode + preprocess (ppu-ocv)
        |
        v
  [optional] unwarping model (ONNX)  -->  flattened page, or the input
        |                                 unchanged when the stage skips
        v
  detection model (ONNX)  -->  text boxes  (detect() returns here)
        |
        v
  recognition model (ONNX) per box/line  -->  text + scores
        |
        v
  [if unwarped] boxes mapped back to the input photo
        |
        v
  assembled result returned to the caller
```

The library reads its input, runs inference in memory, and returns structured
text. On Node/Bun it may read model files from disk and, on first run, download
them. With unwarping on, it also downloads the unwarping model once (about
30 MB). It makes no other network requests and writes only the model cache.

### Unwarping stage

The stage runs when `unwarping.enabled` is set, unless a call passes
`unwarp: false`. A call that passes `unwarp: true` on a service built without
`unwarping.enabled` throws, because that option is what loads the model. The
model input is always a fixed 488 x 712 copy of the photo,
so memory does not grow with photo size. The model is asked twice: the second
prediction runs on the page corrected by the first, and the correction is kept
only when the second prediction measures at most 95% of the first one's
distortion. In that case both grids are chained into one. Otherwise the stage
skips and returns the input unchanged, with a reason: `flat` (under 1 degree of
distortion), `no-gain`, `folded` (the grid crosses itself), or `out-of-frame`
(most of the page lies outside the photo).

`recognize()` and `detect()` always return boxes in the coordinates of the
image the caller passed in. Each box found on the flattened page leaves the
pipeline through the stage's mapping, and a box is the smallest upright
rectangle around the mapped outline. The result cache key names the unwarping
session, so a flattened and an unflattened result for one image never collide.

## Why it is split this way

Detection, recognition, and unwarping are separate ONNX sessions so each can be
swapped, quantized, or sized independently, and the unwarping session loads only
when a caller asks for it. The strategy and engine choices are explicit
options rather than hidden defaults, so callers can trade accuracy for speed.
Keeping `onnxruntime-node` and `onnxruntime-web` behind the two entry points
lets the same API run server-side and in the browser without bundling the
wrong runtime.
