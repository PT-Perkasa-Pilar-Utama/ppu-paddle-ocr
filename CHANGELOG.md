# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`per-line`/`cross-line` now hand each box its own text instead of dumping
  the whole line into the first box.** `mergeLineCrop` stitched same-line
  crops flush against each other, so the recognizer returned the line as one
  unspaced token and the word-based redistribution gave everything to the
  first box and empty strings to the rest. Merged crops now get a white
  separator gap between boxes (a word boundary the model can see), and the
  recognized text maps back to boxes by each crop's pixel-width share, with
  cuts snapping to nearby spaces instead of slicing words. The same snapping
  fixes cross-line batch splits that previously bled characters between
  lines (e.g. `...AlbumsRe` / `centl`).

### Added

- **Playground: model preset selector and warm-up option.** The Models
  section now lists every catalogue preset (`v6-small` ... `v3-mobile`);
  custom URLs override the chosen preset per file. A new checkbox runs the
  hidden warm-up inference after Apply Configuration, so the first real
  recognize on a freshly applied model is not paying WASM/WebGPU
  compilation cost.

## [6.1.1] - 2026-07-20

### Changed

- README: added an Ecosystem section linking the sibling PPU libraries
  (ppu-ocv, ppu-pdf, ppu-doclayout, ppu-doc-correction,
  ppu-orientation-corrector, ppu-uniface, ppu-yolo-onnx-inference).
- **Playground mobile experience and recovery.** Small screens now use dedicated
  Configuration, Image, and Results views instead of one long stacked page. The
  configuration panel groups advanced settings, preserves edits made during
  asynchronous reloads, and reports incomplete model loads with a retry action.

### Fixed

- **Cloudflare playground now ships the complete browser build dependency tree.**
  Shared modules imported by `lib/web` are copied into the deployment, preventing
  local module MIME errors and unnecessary CDN fallback.
- **`per-line`/`cross-line` no longer crash on dense pages with thin detected
  regions ([#72](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues/72)).**
  `mergeLineCrop` stretches every box on a line to the
  line's height; a degenerate box (an underline or table rule a few px tall)
  multiplied its width by that stretch and the merged canvas width could
  exceed the platform's maximum surface size, making `createCanvas` throw
  `Create skia surface failed`. The per-box stretch is now clamped (max 4x)
  and the merged width is capped at 16384px, shrinking proportionally when
  exceeded. `run()` also awaits the strategy result inside its try/catch, so
  a strategy failure degrades to an empty result instead of rejecting
  `recognize()`.

## [6.1.0] - 2026-07-13

### Added

- **`detect()` - detection-only inference.** Runs the detection model without
  recognition and returns the bounding boxes (`{ boxes: Box[] }`). Available on
  all entry points (Node/Bun, web, mobile) and as the CLI `detect` command and
  the serve app's `POST /v1/detect`. Per-call `DetectOptions` extends
  `DetectionOptions`, so every tuning field (`maxSideLength`,
  `minimumAreaThreshold`, paddings, `mean`, `stdDeviation`) can be overridden
  per call, plus:
  - `crop: true` returns each region PNG-encoded as `ArrayBuffer`,
    index-aligned with `boxes` (not supported on React Native - the Skia
    canvas has no encoder).
  - `saveCropsTo: "some/folder"` writes each crop as `crop_NNN.png` into the
    folder (Node/Bun only; ignored on web/mobile).

### Fixed

- **Install size back to ~45MB (was ~317MB since 5.7.1).** `onnxruntime-node` is no
  longer in `optionalDependencies`, so a plain `npm install ppu-paddle-ocr` stops
  pulling its ~258MB of all-platform native binaries. It stays an optional peer
  dependency: Node/Bun users install it explicitly alongside the package
  (`npm install ppu-paddle-ocr onnxruntime-node`); web/mobile/Deno installs no
  longer pay for it. The CLI now detects the missing backend and prints install
  instructions instead of a module resolution stack trace - zero-install runs
  become `npx -p onnxruntime-node -p ppu-paddle-ocr ppu-paddle-ocr <args>`.

### Changed

- Bumped `ppu-ocv` to `^4.0.0` (OpenCV 5.0 via `@techstark/opencv-js` 5.0.0). No API
  changes; `ImageProcessor.initRuntime()` handles the new Promise-based runtime init
  internally.
- Improve docs (README.md) readability
- Bumped dev dependencies (`oxfmt` 0.58, `oxlint` 1.73, `onnxruntime-*` 1.27,
  `fast-check` 4.9, `@napi-rs/canvas` 1.0.2, `lint-staged` 17.0.8, `tsx` 4.23).
  Refreshed GitHub Actions pins (`docker/login-action` v4.4.0,
  `github/codeql-action` v4.37.0).
- **Moved to TypeScript 7 (native).** `typescript@7` drops the
  `transpileDeclaration` JS API the build used, so `scripts/build.ts` now emits
  all declarations in one native `tsc -p tsconfig.build.json` pass (output is
  byte-identical). The `@typescript/native-preview` (tsgo) dev dependency is
  gone - `type-check` uses the same native `tsc --noEmit`.
- **CI bun pin bumped from 1.2.23 to 1.3.14.** bun 1.2.23 on Linux can hang
  `@techstark/opencv-js` 5's Promise-based runtime init when the node and web
  entries load in the same process; 1.3.14 handles it, and the 1.3.13
  SIGILL-on-exit that originally forced the 1.2.23 pin no longer reproduces.
- **Fixed a test-suite bug that emptied all opencv-engine OCR when file order
  changed.** `tests/canvas-compatibility.test.ts` stubbed
  `ImageProcessor.initRuntime` with a no-op but its `afterAll` restore omitted
  the `value` in `defineProperty`, which keeps the stub in place - on runners
  whose filesystem ordered that file first (CI's ext4), OpenCV never
  initialized and every later opencv OCR silently returned empty results. The
  restore now puts the real `initRuntime` back.

## [6.0.0] - 2026-06-19

### Changed

- **Default models upgraded from PP-OCRv5 mobile (English) to PP-OCRv6 small (unified
  multilingual).** On first run after upgrading, the new v6 model files are downloaded and
  cached; previously cached v5 files remain on disk and are not removed.
  Pass `model: V5_EN_MOBILE_MODEL` to keep the previous behaviour without any other code
  changes.
- Version bumped to **6.0.0** to signal the default-model generation change and align with
  the upstream PP-OCRv6 release series. Existing options and API surface are fully backwards
  compatible.
- Bumped `ppu-ocv` to `^3.3.0` for its new `canvas-mobile` (Skia) entry, and added
  `onnxruntime-react-native` and `@shopify/react-native-skia` as optional peer dependencies
  (for the new mobile entry below).
- **Default recognition strategy changed from `per-line` to `per-box`.** On PP-OCRv6 small,
  `per-box` is the most accurate on the receipt benchmark (96.61% vs 95.56% for `per-line`)
  while the three strategies are within ~1% on speed for sparse pages. Set
  `recognition: { strategy: "per-line" }` (or `"cross-line"`) to cut inference calls on
  dense, multi-word-per-line documents.
- Improve OCR line grouping scalability by avoiding repeated average-height recomputation.

### Added

- **React Native support via a new `ppu-paddle-ocr/mobile` entry.** Runs the same OCR
  pipeline on iOS and Android using `onnxruntime-react-native` (native JSI) and
  `ppu-ocv/canvas-mobile` (Skia-backed canvas), mirroring the web entry's platform-provider
  pattern. Always uses the canvas-native engine (no OpenCV on RN); CPU inference by default
  with opt-in NNAPI/CoreML. Install with
  `npm install ppu-paddle-ocr onnxruntime-react-native @shopify/react-native-skia` and import
  from `ppu-paddle-ocr/mobile`. Requires a dev client / `expo prebuild` (not Expo Go). A
  runnable Expo example lives in a separate repo, `ppu-paddle-ocr-mobile-react-native-demo`.
  Closes #17.
- **Model catalogue** - 27 named preset constants covering PP-OCRv6 (`V6_SMALL_MODEL`,
  `V6_MEDIUM_MODEL`, `V6_TINY_MODEL`), PP-OCRv5 (English, server, multilingual, INT8),
  PP-OCRv4, and PP-OCRv3, each bundling detection + recognition + dictionary URLs. Use them
  to switch models with autocomplete instead of hand-writing URLs, e.g.
  `new PaddleOcrService({ model: V6_SMALL_MODEL })`. See `src/model-catalogue.ts` for the
  full list.
- `DEFAULT_MODEL` - points to the current default (PP-OCRv6 small). `DEFAULT_MODEL_URLS` is
  retained as a deprecated alias.
- `ModelUrls` type, plus `MODEL_BASE_URL` / `DICT_BASE_URL` constants, for building custom
  model configurations.
- **CLI `--model <preset>` flag** for selecting a catalogue preset by name (e.g. `v6-tiny`,
  `v5-thai-mobile`); the granular `--model-detection/-recognition/-dict` flags override parts
  of it. `models --json` lists the available preset keys. Backed by the new exported
  `MODEL_PRESETS` map and `ModelPreset` type.
- All catalogue exports are available from `ppu-paddle-ocr`, `ppu-paddle-ocr/web`, and
  `ppu-paddle-ocr/mobile`.

### Fixed

- **Model download timeout raised from 30 s to 300 s per attempt.** The PP-OCRv6 small
  models are ~30 MB combined (vs ~12 MB for PP-OCRv5 mobile), causing the previous
  30-second `AbortSignal.timeout` to fire on slower connections before the body finished
  downloading. The new default matches a conservative 1 Mb/s floor across three attempts.

## [5.8.3] - 2026-05-28

### Fixed

- **Model downloads no longer hang on a stalled connection.** Both the Node
  (`fetchAndCacheResource`) and Web (`_loadResource`) model fetches used a bare
  `fetch()` with no timeout, so a stalled GitHub connection during
  `initialize()` would hang until the caller's timeout (and flaked CI). Both now
  go through a shared `fetchArrayBufferWithRetry` helper with a per-attempt
  abort deadline (30s) and bounded retries.
- **Restored the JSR score (regressed to 58% in 5.8.2).** Exposing
  `coi-serviceworker.js` as a JSR module export forced a plain-JS file to be
  treated as a scored entrypoint - JSR can't derive types from it, so it flagged
  the whole public API as using "slow types" and as missing module docs. The
  file is now removed from `jsr.json` `exports` but kept in the publish
  allowlist, so it still ships and is fetchable at its JSR file URL (and the npm
  `ppu-paddle-ocr/coi-serviceworker.js` export is unchanged) - it is simply no
  longer scored as a documented module.
- Documented every remaining exported symbol - the Node/Web service
  constructors and the Web `PaddleOcrService` public methods (`isInitialized`,
  `changeDetectionModel`, `changeRecognitionModel`, `changeTextDictionary`,
  `recognize`) - bringing `deno doc --lint` to zero `missing-jsdoc` (100%
  documented-symbol coverage).

## [5.8.2] - 2026-05-25

### Fixed

- **JSR was missing the `coi-serviceworker.js` export.** The npm package exposed
  `ppu-paddle-ocr/coi-serviceworker.js`, but `jsr.json` declared neither the
  export nor the file in its publish allowlist, so the JSR build omitted it. Both
  are now added.

## [5.8.1] - 2026-05-25

### Added

- **Opt-in COOP/COEP service worker.** The package now ships
  `coi-serviceworker.js` and exposes it via the `ppu-paddle-ocr/coi-serviceworker.js`
  export. On static hosts that can't set headers (e.g. GitHub Pages), copy it to
  the served root and load it before anything else to unlock cross-origin
  isolation -> `SharedArrayBuffer` -> multithreaded WASM inference. Not registered
  automatically and not needed when WebGPU is used or headers are set
  server-side. See the README's "Multithreaded WASM" section.
- Update outdated link to Cloudflare deployment

## [5.8.0] - 2026-05-25

### Added

- **Signed release artifacts.** The publish workflow signs the published tarball
  keyless with cosign (Sigstore, via OIDC) and attaches the `.sigstore.json`
  bundle to the GitHub release, satisfying OpenSSF Scorecard's Signed-Releases
  check. Release tags are SSH-signed.
- **Reproducible-build verification.** CI builds twice and fails unless `lib/`
  is byte-identical; `docs/REPRODUCIBLE_BUILD.md` documents how to verify.
- **Fuzz testing (dynamic analysis).** `tests/fuzz.test.ts` uses `fast-check` to
  feed random and malformed input to the OCR decode boundary on every CI run.
- **300-line-of-code cap.** A `max-lines` oxlint rule (error, `.ts` only) caps
  files at 300 lines of code; documented in `CONTRIBUTING.md`.
- **Web OCR test coverage.** The `ppu-paddle-ocr/web` path runs under the test
  runner via an `@napi-rs/canvas` polyfill harness (`tests/web-canvas-polyfill.ts`).

### Changed

- **The whole suite runs in one `bun test`.** Bumped `ppu-ocv` to `^3.2.2` (its
  structural canvas/Mat detection) and isolated the web suite's platform, so the
  node, web, CLI, and `apps/serve` tests run in a single process - no split
  runner. Combined coverage ~94%, gated at 90% via `bunfig.toml`. Removed the
  `scripts/test.ts` / `scripts/coverage.ts` two-pass runner.
- **Service layer split under the 300-LOC cap.** The recognition, detection, and
  processor services were split into focused internal modules
  (`src/core/recognition/`, `src/core/detection/`, `src/processor/model-cache.ts`).
  Public class APIs are unchanged.
- **`type` over `interface`** is now a lint error; pre-commit formatting is
  scoped to staged files (no whole-repo reformat sweep).
- **`apps/serve`** bumped to 0.1.3 with `API_VERSION` synced.

### Fixed

- **Demo (`index.html`) pins an exact package version.** The `ppu-paddle-ocr@5`
  CDN range could resolve to a stale build; it now pins the released version.
- **`changeDetectionModel` / `changeRecognitionModel` used a disposed session.**
  Both the node and web services swapped the ONNX session at runtime without
  rebuilding the detector/recognitor, so the next `recognize()` failed with
  "Session already disposed". They now rebuild against the new session.

### Security

- **Supply-chain hardening.** All GitHub Actions are pinned to commit SHAs,
  `npm publish` passes `--provenance`, and an OpenSSF Scorecard workflow
  publishes a supply-chain health score.
- **Published package runs no install scripts.** `scripts` (including `prepare`)
  and `devDependencies` are stripped from the published manifest, so an
  installed copy can execute no lifecycle code (`hasInstallScript: false`).
- **OpenSSF baseline + best practices.** CodeQL on every push/PR (least-privilege
  token), an osv-scanner SCA gate (CI and pre-release), a CycloneDX SBOM per
  release, per-file SPDX headers, and the supporting docs: `GOVERNANCE.md`,
  `ROADMAP.md`, `docs/DESIGN.md`, `docs/THREAT_MODEL.md`, the
  release-verification / dependency / remediation / VEX policy in `SECURITY.md`,
  and a DCO sign-off requirement in `CONTRIBUTING.md`.
- **`SECURITY.md`** documents the Socket "obfuscated code" alerts on
  `onnxruntime-web` / `@protobufjs/float` as false positives on minified and
  generated upstream artifacts.
- **LICENSE now ships in the npm tarball** (previously only the SPDX field
  traveled).

## [5.7.1] - 2026-05-24

### Fixed

- **`bunx ppu-paddle-ocr` / `npx ppu-paddle-ocr` now work out of the box.** `onnxruntime-node` is an optional _peer_ dependency, which package managers never auto-install, so a zero-install CLI run crashed with `ERR_MODULE_NOT_FOUND: onnxruntime-node`. It is now also declared in `optionalDependencies`, so `bunx`/`npx` pull it automatically. SDK consumers are unaffected (the optional peer is still honored); web-only installs can skip it with `--no-optional`.

## [5.7.0] - 2026-05-24

### Added

- **First-party CLI - `bunx ppu-paddle-ocr ...` / `npx ppu-paddle-ocr ...`.** Shipped as a `bin` in the package (no extra install), it covers the whole library surface: `recognize` (single image), `batch` and `stream` (globs or lists, with bounded concurrency), plus `download-models`, `clear-cache`, and `models`. Every `PaddleOptions` / `RecognizeOptions` field has a flag - `--strategy`, `--engine`, `--flatten`, `--model-detection/-recognition/-dict`, detection tuning (`--max-side-length`, `--mean`, `--std`, ...), `--execution-providers`, `--concurrency`, and output controls (`--json`, `--pretty`, `-o`, `-q`). Recognized text goes to stdout, progress/logs to stderr; exit codes are `0` success / `1` runtime error / `2` usage error. Uses the default v5 models unless overridden. Cross-runtime (Node and Bun); no new runtime dependencies (`node:util.parseArgs`).

## [5.6.0] - 2026-05-24

### Added

- **`apps/serve` - production-grade REST API** (Hono + Bun, dockerized). One warmed `PaddleOcrService` behind a bounded inference queue (429 backpressure, no OOM/VRAM blow-up), graceful shutdown, optional API-key auth, Prometheus `/metrics`, OpenAPI `/docs`. Endpoints: sync/batch/async/SSE OCR, task status/cancel, `/v1/models`, `/health`, `/ready`. Multi-stage CPU + CUDA Dockerfiles (models pre-baked, non-root), compose, and a release workflow that builds, slims (docker-slim), and pushes to ghcr.io. Standalone package - kept out of the library's install/publish path.

### Developer experience

- **Benchmarks now measure the shipped default models (v5).** `bench/batch.bench.ts` and `bench/profile.ts` hardcoded the stale v4 recognition model from `models/`; they now omit explicit model paths so every benchmark exercises the library default, matching `bench/index.bench.ts`. README benchmark numbers refreshed accordingly.
- **Tests now exercise the default models (v5) too.** `index.test.ts` (recognition behaviour + accuracy), `engine-parity.test.ts`, and `batch-recognize.test.ts` no longer pin the stale v4 recognition model; the explicit file-path / ArrayBuffer / buffer-release tests in `index.test.ts` keep loading a local file, since they verify the model-loading API itself.

## [5.5.0] - 2026-05-23

### Added

- **`batchRecognize()` and `batchRecognizeStream()`** - run `recognize()` over an array or (async) iterable of images with bounded concurrency, so peak memory stays bounded regardless of batch size. Results are index-aligned to the inputs; supports per-item error isolation (`settle`), `AbortSignal` cancellation, and `onProgress`. Concurrency defaults to `"auto"` - `1` when an accelerator execution provider (CUDA/WebGPU) is configured, a small CPU default otherwise. Inherited by both the Node and Web builds. See the new "Batch Recognition" section in the README.

### Developer experience

- **Replaced mitata with a zero-dependency benchmark harness** (`bench/harness.ts`). mitata crashed intermittently on this suite; the harness measures in-process with `performance.now`, runs tasks round-robin across rounds so thermal/GC drift hits each equally, and reports the median plus optional peak RSS. Both `bench/index.bench.ts` and `bench/batch.bench.ts` use it. Removes the `mitata` devDependency.
- **Test files are now isolated in worker processes** via `bun test --parallel=N` (where N is the number of `*.test.ts` files under `tests/` and `private-tests/`). Sequential `bun test` on Bun 1.3.13 segfaulted when multiple test files each loaded `@techstark/opencv-js` together with the newly upgraded `@napi-rs/canvas@1.0.0` - an Emscripten/embind multi-load issue that previously surfaced as a recoverable warning under `@napi-rs/canvas@0.1.x`. The workaround is also ~2.4x faster (11s vs 26s on the local suite).
- **Upstream fix landed.** Bun 1.3.14 (likely via [oven-sh/bun#30412](https://github.com/oven-sh/bun/pull/30412)) no longer crashes on the same suite without the workaround. Tracking issue: [oven-sh/bun#30716](https://github.com/oven-sh/bun/issues/30716). The `--parallel=N` flag is kept anyway for the speedup and to protect contributors still on 1.3.13.
- **`bun.lock` is now committed.** Previously gitignored; now part of the repo so CI and contributors install the exact set the maintainers test against. Has no effect on the published package (the publish workflow only ships `./lib`).

## [5.4.4] - 2026-05-14

### Security

- **Prototype pollution fix in `deepMerge`** (`src/utils.ts`). The recursive merge used to walk every own-enumerable key of the source object without filtering, so a crafted input containing `__proto__`, `constructor`, or `prototype` could write through to `Object.prototype` and affect unrelated objects in the process. `deepMerge` now skips those three keys explicitly. Users who pass untrusted JSON into any options object should upgrade.

### Developer experience

- Added `.github/dependabot.yml` so npm dependencies and GitHub Actions are kept current automatically (weekly schedule).
- Hardened CI: tightened `permissions:` on the quality-check workflow.
- Bumped CI actions to current majors: `actions/checkout` v4 -> v6, `actions/setup-node` v4 -> v6, `oven-sh/setup-bun` v1 -> v2.
- Bumped `oxfmt` 0.48.0 -> 0.49.0 (dev dependency, formatter).

## [5.4.3] - 2026-05-14

### Fixed

- **Browser bundlers no longer need to alias `ppu-ocv/canvas`** ([#18](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues/18)). Core services previously imported `ppu-ocv/canvas` (the Node variant) at module top level, which forced every browser consumer - including the `web` subpath - to alias or `pnpm patch` the specifier. Canvas access is now routed through `PlatformProvider.canvas` (`prepareCanvas` / `createProcessor` / `getToolkit`); `NodePlatformProvider` wires it to `ppu-ocv/canvas`, `WebPlatformProvider` wires it to `ppu-ocv/canvas-web`. Webpack / Vite / Next.js / esbuild consumers of `ppu-paddle-ocr/web` should now work out of the box.

### Developer experience

- New `CanvasOps<TCanvas>` type on `PlatformProvider` for platforms that want to plug in custom canvas backends.
- `core/base-{detection,recognition,paddle-ocr}.service.ts` no longer import `ppu-ocv/canvas` at runtime (type-only imports remain).
- Demo (`index.html`) refreshed: full config surface (recognition strategy, cross-line factor, mean/std-dev, execution provider) is now editable from the sidebar; sticky "Apply Configuration" button with dirty-state pulse; loading overlay during inference; paper-and-ink theme.

## [5.4.0] - 2026-05-10

### Performance

- **Safe execution provider fallback for Node.js**: Session creation now gracefully handles failures from preferred providers (CUDA, DirectML, TensorRT) by falling back to CPU. Prevents initialization crashes on systems without GPU acceleration.
- **Default to `.ort` models**: The library now defaults to using pre-optimized ONNX Runtime (`.ort`) models instead of standard ONNX files, providing **~5x faster cold start** time.
- **Parallel model loading**: Model file download and session creation now run concurrently during `initialize()`, further reducing initialization latency.

### Developer experience

- Added `src/core/session-factory.ts` with `createSession()` that encapsulates EP selection and fallback logic, making it reusable across Node.js environments.
- New tests in `tests/session-factory.test.ts` covering EP fallback scenarios.

## [5.3.0] - 2026-05-09

### Added

- **WebGPU execution provider** (web build). `PaddleOcrService` imported from `ppu-paddle-ocr/web` now probes `navigator.gpu` during `initialize()` and prefers `["webgpu", "wasm"]` when available, falling back silently to `["wasm"]` otherwise. WebGPU session creation that errors out (e.g. a model uses an op WebGPU does not support) triggers a transparent retry on WebAssembly. Typical speedup on Chrome/Edge with a compatible GPU is **2-5x faster recognition** with no code changes.
- `isWebGpuAvailable()` and `getDefaultWebExecutionProviders()` exported from `ppu-paddle-ocr/web` for conditional UI ("GPU-accelerated" indicators) and explicit provider selection.
- `examples/quantize-onnx.py` - helper script for producing INT8 dynamic quantized recognition models from the FP32 ONNX files in [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models). Quantizes `MatMul` / `Gemm` only (`Conv` is skipped because `ConvInteger` is not implemented in `onnxruntime-node`'s CPU backend). Typically 20-50% faster recognition on x86-64 CPUs with VNNI and on WebAssembly, with no measurable accuracy loss on the receipt sample.

### Changed

- Bumped internal `onnxruntime-web` CDN URL and the `ort.env.wasm.wasmPaths` default from 1.24.2 to 1.26.0 (so WebGPU is available out-of-the-box).

### Documentation

- README now documents the model-cache folder location per OS (macOS, Linux, Windows).
- New README section **"WebGPU Acceleration"** covering auto-detection, how to override the provider preference, and how to probe support from user code.
- New README section **"INT8 Quantized Recognition Models (advanced)"** with platform-specific guidance - explicitly calls out that INT8 is **slower** than FP32 on Apple Silicon, so users on macOS ARM64 should stick with FP32.

### Developer experience

- Pre-commit hook now runs `bun run fmt:fix` and `bun run lint:fix` across the whole repo before delegating strict lint + type-check to lint-staged, and restages the fixer output via `git add -u`. Commits land clean without a follow-up "fix: apply formatter" commit.
- `package.json` now has a `"prepare": "husky"` script so `bun install` reliably activates husky on fresh clones (previously missing, which is why hooks silently did nothing).
- GitHub issue templates (bug, accuracy, performance, install, feature, documentation) and a pull request template with What/Why/How sections.
- CI pinned to Bun 1.2.23 until the Bun 1.3.x test-runner SIGILL on exit is fixed upstream.

## [5.2.1] - 2026-05-09

### Performance

- **Detection preprocessing**: Replaced the OpenCV resize + separate padded-canvas step with a single `drawImage` that scales and places the image into the padded target in one call. Eliminates a `Mat <-> Canvas` round trip for the OpenCV engine; neutral for canvas-native.
- **Detection normalization hot loop**: Pre-computed `scale = 1/(255*std)` and `shift = mean/std` so each pixel costs one multiply + one subtract per channel instead of divide -> subtract -> multiply.
- **Recognition tensor creation**: `createImageTensorFromCanvas` now fills channel 0 once from the grayscale input and uses `Float32Array.copyWithin` to memcpy the block into channels 1 and 2, instead of writing each pixel three times.
- **CTC decoding**: Inlined the per-timestep argmax and character-append helpers, and replaced the per-character confidence array + final `reduce` with a running sum + count. Largest measurable gain in `cross-line` (longer CTC output sequences).

Net result on the M1 receipt benchmark (vs. v5.2.0, clean machine): 1-3.5% faster across all six (strategy x engine) variants, with identical recognition accuracy on every variant.

## [5.2.0] - 2026-05-09

### Added

- **Recognition strategies** (`recognition.strategy` option and per-call `recognize(..., { strategy })` override): Choose how detected boxes are fed into the recognition model. Each strategy works by cropping detected regions from the canvas and stitching them side-by-side before running inference, so the number of recognition inferences can be reduced.
  - `"per-box"` - each detected box produces one separate inference (previous behavior, most accurate).
  - `"per-line"` (default) - boxes on the same line are merged into a single crop and a single inference.
  - `"cross-line"` - short lines are bin-packed across batches to minimise total inference calls, improving throughput on images with many text regions.
- `RecognitionStrategy` type, `RecognitionOptions.strategy`, `RecognitionOptions.crossLineWidthFactor`, and `RecognizeOptions.strategy` in the public API.
- `PaddleOcrService.downloadModels()` static method to pre-download and cache the default model files (useful for CI/CD and warm-up).
- Multi-engine x multi-strategy benchmark suite under `bench/`.

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

- **Performance regression fix**: Restored eager `ImageProcessor.initRuntime()` call during `initialize()` when using the OpenCV engine. In v5.0.0 this call was removed when OpenCV was dropped; v5.1.0 restored the OpenCV code path but not the runtime initialization, causing the OpenCV WASM module to be lazily compiled on first use - resulting in 3-6x slower first inference and high variance in subsequent calls.

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
