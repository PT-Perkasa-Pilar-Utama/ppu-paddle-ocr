<!--
Thanks for opening a PR against ppu-paddle-ocr! Please fill out the three
sections below. Keep it short — a couple of sentences each is fine for
small changes. Bigger changes deserve a bit more context.
-->

## What

<!--
What does this PR change? One or two sentences, in plain language.
If this fixes an issue, link it: "Fixes #123".

Examples:
- Adds WebGPU execution provider to the web build.
- Fixes crash when a detected box is smaller than MIN_CROP_WIDTH.
- Bumps `onnxruntime-node` peer from ^1.23 to ^1.26.
-->

## Why

<!--
Why is this change worth making?

If it's a bug fix, describe the symptom the user was seeing and what the
root cause turned out to be. If it's a feature, explain the use case that
motivated it. If it's a performance change, include numbers (see the
Benchmark section below).

Avoid restating *what* you did — focus on *why* it's worth merging.
-->

## How

<!--
How does the change work? Point readers at the key files and the design
choices that aren't obvious from reading the diff. If you considered
other approaches, say why you picked this one.

For performance PRs, include the bench output (before vs. after) and
note whether accuracy is preserved on the receipt sample.
-->

### Checklist

- [ ] Tests pass locally (`bun test`)
- [ ] Types are clean (`bun run type-check`)
- [ ] Lint + format are clean (`bun run lint` and `bun run fmt`)
- [ ] Benchmark run if this touches the hot path (`bun run bench/index.bench.ts`)
- [ ] CHANGELOG updated under `## [Unreleased]` (or bump version if cutting a release)
- [ ] README updated if the public API, defaults, or setup changed
- [ ] New tests added for bugs fixed or features added

### Compatibility

<!--
Tick the environments you've verified manually (CI covers the first two).
Leave the rest unticked if you haven't exercised them — reviewers will
know what still needs checking.
-->

- [ ] Node.js (via `onnxruntime-node`)
- [ ] Bun (via `onnxruntime-node`)
- [ ] Browser — WebAssembly fallback (Safari, older Firefox)
- [ ] Browser — WebGPU path (Chrome / Edge with a discrete or integrated GPU)
- [ ] macOS (Apple Silicon)
- [ ] Linux (x86-64)
- [ ] Windows

### Related

<!--
Optional: link related PRs, upstream issues, or docs.

- Closes #123
- Part of the perf work on #45
- Upstream: https://github.com/microsoft/onnxruntime/issues/...
-->
