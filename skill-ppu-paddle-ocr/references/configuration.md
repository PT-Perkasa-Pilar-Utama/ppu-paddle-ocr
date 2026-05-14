# `PaddleOptions` — full configuration reference

This is the complete option surface of `PaddleOcrService`. Every field is optional; defaults are calibrated for receipts and printed documents at typical phone-camera resolutions.

## Top-level shape

```ts
type PaddleOptions = {
  model?: ModelPathOptions;
  detection?: DetectionOptions;
  recognition?: RecognitionOptions;
  debugging?: DebuggingOptions;
  session?: SessionOptions;
  processing?: ProcessingOptions;
};
```

Constructor merges your options into the defaults via deep-merge — partial overrides work as expected (`{ recognition: { strategy: "per-box" } }` does not wipe the rest of the recognition defaults).

---

## `ModelPathOptions`

| Property               | Type                    | Default                           | Notes                                                               |
| ---------------------- | ----------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `detection`            | `string \| ArrayBuffer` | English mobile `.ort` from GitHub | Path, URL, or buffer. `.ort` is faster to load than `.onnx`.        |
| `recognition`          | `string \| ArrayBuffer` | English mobile `.ort` from GitHub | Same. INT8 quantized variants accepted.                             |
| `charactersDictionary` | `string \| ArrayBuffer` | English `ppocrv5_en_dict.txt`     | **Leave a trailing newline** in the file or you drop the last char. |

If you switch language, you must replace **at minimum** the `recognition` model and the `charactersDictionary`. The detection model is largely language-agnostic and the same checkpoint works across most scripts (Arabic and CJK have language-specific detection variants in the model repo if you need them).

---

## `DetectionOptions`

Controls preprocessing and post-filtering for the detection model.

| Property               | Type                       | Default                 | Notes                                                                            |
| ---------------------- | -------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `mean`                 | `[number, number, number]` | `[0.485, 0.456, 0.406]` | Per-channel mean for input normalization (R, G, B). Don't change without reason. |
| `stdDeviation`         | `[number, number, number]` | `[0.229, 0.224, 0.225]` | Per-channel std dev. Same — these match PP-OCRv5's training distribution.        |
| `maxSideLength`        | `number`                   | `640`                   | Longest input side in px. Larger images get scaled down before inference.        |
| `paddingVertical`      | `number`                   | `0.4`                   | Fractional padding added to each detected box vertically.                        |
| `paddingHorizontal`    | `number`                   | `0.6`                   | Same, horizontally.                                                              |
| `minimumAreaThreshold` | `number`                   | `50`                    | Drop detected boxes smaller than this area (px²). Filters noise.                 |

**When to tune:**

- `maxSideLength`: raise to `960` or `1280` for high-res scans where small text is being missed; lower (e.g. `480`) for throughput-critical pipelines on low-res inputs.
- `paddingHorizontal` / `paddingVertical`: increase if recognition is clipping the first/last character of lines (a sign the box is too tight). Decrease if neighbouring lines are merging.
- `minimumAreaThreshold`: raise if you're getting spurious boxes on noise; lower if you're missing single-character or punctuation-only boxes.
- `mean` / `stdDeviation`: don't touch unless you're using a custom-trained model with different normalization stats.

---

## `RecognitionOptions`

Controls the recognition stage's preprocessing and batching strategy.

| Property               | Type                                      | Default      | Notes                                                                          |
| ---------------------- | ----------------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| `imageHeight`          | `number`                                  | `48`         | Fixed height (px) for resized text-line crops; widths are proportional.        |
| `strategy`             | `"per-box" \| "per-line" \| "cross-line"` | `"per-line"` | Batching strategy. See SKILL.md for trade-offs.                                |
| `crossLineWidthFactor` | `number`                                  | `1.0`        | Width multiplier for `cross-line` bin-packing. Only used with `cross-line`.    |
| `charactersDictionary` | `string[]`                                | `[]`         | Loaded dict for decoding. Set automatically by `initialize()`; don't override. |

**When to tune:**

- `imageHeight`: larger (e.g. `64`) can help on very small/dense text at the cost of latency. Most users should leave it at `48`.
- `strategy`: pick based on workload — see the strategy table in SKILL.md.
- `crossLineWidthFactor`: only meaningful with `cross-line`. Try `1.2`–`1.5` for slight throughput wins; `2.0+` starts to hurt accuracy on receipts.
- `charactersDictionary`: this is set internally from `model.charactersDictionary` during `initialize()`. Setting it directly is a footgun — use `model.charactersDictionary` instead, or `recognize(image, { dictionary })` for one-off overrides.

---

## `DebuggingOptions`

| Property      | Type      | Default | Notes                                                                                              |
| ------------- | --------- | ------- | -------------------------------------------------------------------------------------------------- |
| `verbose`     | `boolean` | `false` | Logs each pipeline step to console with `[PaddleOcrService:*]` tags.                               |
| `debug`       | `boolean` | `false` | Writes intermediate frames (preprocessed input, detection mask, crops) to disk. **Node/Bun only.** |
| `debugFolder` | `string`  | `"out"` | Output directory for debug frames, relative to `process.cwd()`.                                    |

`verbose` is cheap and great for first-time setup. `debug` writes a lot of files — only enable when investigating a specific image's accuracy issue, then turn back off.

---

## `SessionOptions`

This is `InferenceSession.SessionOptions` from `onnxruntime-common`, plus a couple of typed convenience defaults. Anything ONNX Runtime accepts works here.

| Property                 | Type                                                       | Default                                  | Notes                                              |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `executionProviders`     | `string[] \| ExecutionProviderConfig[]`                    | `["cpu"]` (Node), auto WebGPU→WASM (web) | Override only with reason.                         |
| `graphOptimizationLevel` | `"disabled" \| "basic" \| "extended" \| "layout" \| "all"` | `"all"`                                  | Leave at `"all"` unless debugging an ORT bug.      |
| `enableCpuMemArena`      | `boolean`                                                  | `true`                                   | Memory arena allocator. Disable only on tight RAM. |
| `enableMemPattern`       | `boolean`                                                  | `true`                                   | Reuse memory patterns across runs.                 |
| `executionMode`          | `"sequential" \| "parallel"`                               | `"sequential"`                           | Parallel rarely helps for OCR-shaped graphs.       |
| `interOpNumThreads`      | `number`                                                   | `0`                                      | `0` = ORT picks. Set explicitly only when pinning. |
| `intraOpNumThreads`      | `number`                                                   | `0`                                      | Same.                                              |

**Common patterns:**

- **Force WASM in browsers** (e.g. for benchmark parity or to debug a WebGPU regression):

  ```ts
  new PaddleOcrService({
    session: { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
  });
  ```

- **CUDA on Node** (requires `onnxruntime-node` built with CUDA):

  ```ts
  new PaddleOcrService({
    session: { executionProviders: [{ name: "cuda", deviceId: 0 }] },
  });
  ```

- **CoreML on macOS Node**:

  ```ts
  new PaddleOcrService({
    session: { executionProviders: ["coreml", "cpu"] },
  });
  ```

---

## `ProcessingOptions`

| Property | Type                          | Default    | Notes                                                      |
| -------- | ----------------------------- | ---------- | ---------------------------------------------------------- |
| `engine` | `"opencv" \| "canvas-native"` | `"opencv"` | OpenCV is more accurate; canvas-native skips the WASM dep. |

The `/web` build always uses `canvas-native` — this flag is silently ignored there.

---

## `RecognizeOptions` (per-call)

These are passed as the second argument to `recognize()`, not on the constructor.

| Property     | Type                                      | Default | Notes                                                       |
| ------------ | ----------------------------------------- | ------- | ----------------------------------------------------------- |
| `flatten`    | `boolean`                                 | `false` | Return `FlattenedPaddleOcrResult` instead of grouped lines. |
| `strategy`   | `"per-box" \| "per-line" \| "cross-line"` | service | Override the recognition strategy for this call only.       |
| `dictionary` | `string \| ArrayBuffer`                   | service | Custom dictionary for this call. **Disables result cache.** |
| `noCache`    | `boolean`                                 | `false` | Bypass the in-memory result cache.                          |

`strategy` and `dictionary` overrides do **not** mutate the service's defaults — they only apply to that single call. To swap the service-wide config, use `changeRecognitionModel` / `changeTextDictionary`.
