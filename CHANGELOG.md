# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`batchRecognize()` and `batchRecognizeStream()`** — run `recognize()` over an array or (async) iterable of images with bounded concurrency, so peak memory stays bounded regardless of batch size. Results are index-aligned to the inputs; supports per-item error isolation (`settle`), `AbortSignal` cancellation, and `onProgress`. Concurrency defaults to `"auto"` — `1` when an accelerator execution provider (CUDA/WebGPU) is configured, a small CPU default otherwise. Inherited by both the Node and Web builds. See the new "Batch Recognition" section in the README.

### Developer experience

- **Test files are now isolated in worker processes** via `bun test --parallel=N` (where N is the number of `*.test.ts` files under `tests/` and `private-tests/`). Sequential `bun test` on Bun 1.3.13 segfaulted when multiple test files each loaded `@techstark/opencv-js` together with the newly upgraded `@napi-rs/canvas@1.0.0` — an Emscripten/embind multi-load issue that previously surfaced as a recoverable warning under `@napi-rs/canvas@0.1.x`. The workaround is also ~2.4× faster (11s vs 26s on the local suite).
- **Upstream fix landed.** Bun 1.3.14 (likely via [oven-sh/bun#30412](https://github.com/oven-sh/bun/pull/30412)) no longer crashes on the same suite without the workaround. Tracking issue: [oven-sh/bun#30716](https://github.com/oven-sh/bun/issues/30716). The `--parallel=N` flag is kept anyway for the speedup and to protect contributors still on 1.3.13.
- **`bun.lock` is now committed.** Previously gitignored; now part of the repo so CI and contributors install the exact set the maintainers test against. Has no effect on the published package (the publish workflow only ships `./lib`).

## [5.4.4] - 2026-05-14

### Security

- **Prototype pollution fix in `deepMerge`** (`src/utils.ts`). The recursive merge used to walk every own-enumerable key of the source object without filtering, so a crafted input containing `__proto__`, `constructor`, or `prototype` could write through to `Object.prototype` and affect unrelated objects in the process. `deepMerge` now skips those three keys explicitly. Users who pass untrusted JSON into any options object should upgrade.

### Developer experience

- Added `.github/dependabot.yml` so npm dependencies and GitHub Actions are kept current automatically (weekly schedule).
- Hardened CI: tightened `permissions:` on the quality-check workflow.
- Bumped CI actions to current majors: `actions/checkout` v4 → v6, `actions/setup-node` v4 → v6, `oven-sh/setup-bun` v1 → v2.
- Bumped `oxfmt` 0.48.0 → 0.49.0 (dev dependency, formatter).

## [5.4.3] - 2026-05-14

### Fixed

- **Browser bundlers no longer need to alias `ppu-ocv/canvas`** ([#18](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues/18)). Core services previously imported `ppu-ocv/canvas` (the Node variant) at module top level, which forced every browser consumer — including the `web` subpath — to alias or `pnpm patch` the specifier. Canvas access is now routed through `PlatformProvider.canvas` (`prepareCanvas` / `createProcessor` / `getToolkit`); `NodePlatformProvider` wires it to `ppu-ocv/canvas`, `WebPlatformProvider` wires it to `ppu-ocv/canvas-web`. Webpack / Vite / Next.js / esbuild consumers of `ppu-paddle-ocr/web` should now work out of the box.

### Developer experience

- New `CanvasOps<TCanvas>` type on `PlatformProvider` for platforms that want to plug in custom canvas backends.
- `core/base-{detection,recognition,paddle-ocr}.service.ts` no longer import `ppu-ocv/canvas` at runtime (type-only imports remain).
- Demo (`index.html`) refreshed: full config surface (recognition strategy, cross-line factor, mean/std-dev, execution provider) is now editable from the sidebar; sticky "Apply Configuration" button with dirty-state pulse; loading overlay during inference; paper-and-ink theme.

## [5.4.0] - 2026-05-10

### Performance

- **Safe execution provider fallback for Node.js**: Session creation now gracefully handles failures from preferred providers (CUDA, DirectML, TensorRT) by falling back to CPU. Prevents initialization crashes on systems without GPU acceleration.
- **Default to `.ort` models**: The library now defaults to using pre-optimized ONNX Runtime (`.ort`) models instead of standard ONNX files, providing **~5× faster cold start** time.
- **Parallel model loading**: Model file download and session creation now run concurrently during `initialize()`, further reducing initialization latency.

### Developer experience

- Added `src/core/session-factory.ts` with `createSession()` that encapsulates EP selection and fallback logic, making it reusable across Node.js environments.
- New tests in `tests/session-factory.test.ts` covering EP fallback scenarios.

## [5.3.0] - 2026-05-09

### Added

- **WebGPU execution provider** (web build). `PaddleOcrService` imported from `ppu-paddle-ocr/web` now probes `navigator.gpu` during `initialize()` and prefers `["webgpu", "wasm"]` when available, falling back silently to `["wasm"]` otherwise. WebGPU session creation that errors out (e.g. a model uses an op WebGPU does not support) triggers a transparent retry on WebAssembly. Typical speedup on Chrome/Edge with a compatible GPU is **2–5× faster recognition** with no code changes.
- `isWebGpuAvailable()` and `getDefaultWebExecutionProviders()` exported from `ppu-paddle-ocr/web` for conditional UI ("GPU-accelerated" indicators) and explicit provider selection.
- `examples/quantize-onnx.py` — helper script for producing INT8 dynamic quantized recognition models from the FP32 ONNX files in [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models). Quantizes `MatMul` / `Gemm` only (`Conv` is skipped because `ConvInteger` is not implemented in `onnxruntime-node`'s CPU backend). Typically 20–50% faster recognition on x86-64 CPUs with VNNI and on WebAssembly, with no measurable accuracy loss on the receipt sample.

### Changed

- Bumped internal `onnxruntime-web` CDN URL and the `ort.env.wasm.wasmPaths` default from 1.24.2 to 1.26.0 (so WebGPU is available out-of-the-box).

### Documentation

- README now documents the model-cache folder location per OS (macOS, Linux, Windows).
- New README section **"WebGPU Acceleration"** covering auto-detection, how to override the provider preference, and how to probe support from user code.
- New README section **"INT8 Quantized Recognition Models (advanced)"** with platform-specific guidance — explicitly calls out that INT8 is **slower** than FP32 on Apple Silicon, so users on macOS ARM64 should stick with FP32.

### Developer experience

- Pre-commit hook now runs `bun run fmt:fix` and `bun run lint:fix` across the whole repo before delegating strict lint + type-check to lint-staged, and restages the fixer output via `git add -u`. Commits land clean without a follow-up "fix: apply formatter" commit.
- `package.json` now has a `"prepare": "husky"` script so `bun install` reliably activates husky on fresh clones (previously missing, which is why hooks silently did nothing).
- GitHub issue templates (bug, accuracy, performance, install, feature, documentation) and a pull request template with What/Why/How sections.
- CI pinned to Bun 1.2.23 until the Bun 1.3.x test-runner SIGILL on exit is fixed upstream.

## [5.2.1] - 2026-05-09

### Performance

- **Detection preprocessing**: Replaced the OpenCV resize + separate padded-canvas step with a single `drawImage` that scales and places the image into the padded target in one call. Eliminates a `Mat ↔ Canvas` round trip for the OpenCV engine; neutral for canvas-native.
- **Detection normalization hot loop**: Pre-computed `scale = 1/(255·std)` and `shift = mean/std` so each pixel costs one multiply + one subtract per channel instead of divide → subtract → multiply.
- **Recognition tensor creation**: `createImageTensorFromCanvas` now fills channel 0 once from the grayscale input and uses `Float32Array.copyWithin` to memcpy the block into channels 1 and 2, instead of writing each pixel three times.
- **CTC decoding**: Inlined the per-timestep argmax and character-append helpers, and replaced the per-character confidence array + final `reduce` with a running sum + count. Largest measurable gain in `cross-line` (longer CTC output sequences).

Net result on the M1 receipt benchmark (vs. v5.2.0, clean machine): 1–3.5% faster across all six (strategy × engine) variants, with identical recognition accuracy on every variant.

## [5.2.0] - 2026-05-09

### Added

- **Recognition strategies** (`recognition.strategy` option and per-call `recognize(..., { strategy })` override): Choose how detected boxes are fed into the recognition model. Each strategy works by cropping detected regions from the canvas and stitching them side-by-side before running inference, so the number of recognition inferences can be reduced.
  - `"per-box"` — each detected box produces one separate inference (previous behavior, most accurate).
  - `"per-line"` (default) — boxes on the same line are merged into a single crop and a single inference.
  - `"cross-line"` — short lines are bin-packed across batches to minimise total inference calls, improving throughput on images with many text regions.
- `RecognitionStrategy` type, `RecognitionOptions.strategy`, `RecognitionOptions.crossLineWidthFactor`, and `RecognizeOptions.strategy` in the public API.
- `PaddleOcrService.downloadModels()` static method to pre-download and cache the default model files (useful for CI/CD and warm-up).
- Multi-engine × multi-strategy benchmark suite under `bench/`.

### Changed

- **Default recognition strategy is `"per-line"`**: ~10% throughput improvement over `"per-box"` on typical receipts while keeping accuracy within 1 edit-distance. Users who need strict per-box behavior can pass `{ strategy: "per-box" }` per call or configure it at service creation.
- Migrated linting toolchain from Prettier/ESLint to [oxlint](https://oxc.rs/docs/guide/usage/linter) + [oxfmt](https://oxc.rs/).
- Updated internal documentation and README to describe the recognition strategies, including the strategy diagram.

### Fixed

- Benchmark memory accounting and output formatting.
- Several `oxlint` findings across `src/` and `examples/` (no behavior changes).

### Build / CI

- Added a GitHub Actions CI workflow and wired npm + jsr publishing to GitHub releases.
- Added husky pre-commit + lint-staged hooks for commit-message validation and automatic formatting.

## [5.1.1] - 2026-04-12

### Fixed

- **Performance regression fix**: Restored eager `ImageProcessor.initRuntime()` call during `initialize()` when using the OpenCV engine. In v5.0.0 this call was removed when OpenCV was dropped; v5.1.0 restored the OpenCV code path but not the runtime initialization, causing the OpenCV WASM module to be lazily compiled on first use — resulting in 3-6x slower first inference and high variance in subsequent calls.

## [5.1.0] - 2026-04-11

### Added

- **Processing engine selection** (`processing.engine` option): Choose between `"opencv"` (default) and `"canvas-native"` for the image preprocessing pipeline.
- `ProcessingEngine` type, `ProcessingOptions` interface, `DEFAULT_PROCESSING_ENGINE` and `DEFAULT_PROCESSING_OPTIONS` exports.
- Engine parity regression tests (`tests/engine-parity.test.ts`) to detect divergence between the two engines.

### Changed

- **Default processing engine restored to OpenCV**: v5.0.0 switched entirely to canvas-native processing, which caused regressions in bounding box accuracy for some images (boxes appearing ~8px narrower). The default is now `"opencv"` again, matching v4 behavior. Users who prefer the lighter canvas-native engine can still opt in via `processing: { engine: "canvas-native" }`.
- `BaseDetectionService` and `BaseRecognitionService` now accept an `engine` parameter to dynamically select the processing backend.
- Node `DetectionService` / `RecognitionService` constructors accept an optional `engine` parameter.
- Web services always use `canvas-native` (no OpenCV available in browser).

### Fixed

- Fixed bounding box width regression (issue [#8](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues/8)) where canvas-native `findRegions` produced narrower boxes compared to OpenCV `findContours`.

## [5.0.0] - 2026-04-05

### BREAKING CHANGES

- **Removed deskew functionality**: The `autoDeskew` option and `deskewImage()` method have been removed from ppu-paddle-ocr
- Deskew functionality has been moved to [ppu-ocv](https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocv) library
- Users who need image deskewing should now use `DeskewService` from `ppu-ocv`
- Canvas operation such as `resize`, `getContours`, `grayscale` are migrate from `opencv` to native canvas operation.

### Migration Guide

See the [Migration Guide](README.md#migration-guide-v4x-to-v50) in the README for detailed step-by-step instructions on upgrading from v4.x to v5.0.

### Removed

- `DetectionOptions.autoDeskew` option
- `PaddleOcrService.deskewImage()` method
- Internal deskew service implementations (`BaseDeskewService`, `DeskewService`, `DeskewServiceWeb`)
- Deskew example file
- Deskew-related tests

### Why This Change?

- **Better Separation of Concerns**: Deskewing is an image preprocessing operation, while ppu-paddle-ocr focuses specifically on OCR
- **Reduced Bundle Size**: Users who don't need deskewing won't have to include that code in their bundles
- **More Flexibility**: ppu-ocv provides more advanced image processing capabilities beyond just deskewing, including grayscale conversion, thresholding, blurring, and more

### Dependencies

- Updated `ppu-ocv` to v3.0.0 (compatible with both v2 and v3)

### Documentation

- Updated migration guide examples to use ppu-ocv v3 API (`CanvasProcessor` instead of `ImageProcessor` for canvas operations)
- Added comprehensive "Models and Language Support" section clarifying:
  - Default model is PP-OCRv5 mobile (English)
  - Available model versions (v3, v4, v5) and types (mobile, server)
  - Support for 40+ languages through [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models)
  - How to switch between models and languages
  - Model output capabilities (text-only, not tables/formulas)
- Added migration guide with before/after code examples
- Enhanced usage examples with model switching instructions

## [4.1.1] - Previous release

See git history for changes prior to v5.0.0.
