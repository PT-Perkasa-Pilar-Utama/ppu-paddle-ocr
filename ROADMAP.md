# Roadmap

ppu-paddle-ocr is stable and in active maintenance. This roadmap states the
direction and the near-term priorities. It is a statement of intent, not a
contract; dates are deliberately omitted because a small team sets pace by
capacity.

## Now (maintenance)

- Keep dependencies current and the supply chain hardened: Dependabot updates,
  pinned actions, npm provenance, the SCA and SAST gates in CI.
- Fix reported bugs and answer issues within the timeframes in
  [SECURITY.md](SECURITY.md).
- Hold test coverage steady (enforced in CI).

## Next

- Broaden language and script coverage as PP-OCR models and dictionaries allow
  (Latin, Cyrillic, Arabic, Indic, CJK, Thai), driven by real demand.
- Sharpen the recognition strategies (`per-box` / `per-line` / `cross-line`)
  and the engine choice (`opencv` / `canvas-native`) with benchmarks.
- Improve the WebGPU path and its CPU fallback on the browser entry point.

## Later

- Performance work on detection and recognition hot paths, with before/after
  benchmarks (`bun task bench`).
- Evaluate newer ONNX Runtime releases as upstream ships them.
- Grow the `apps/serve` HTTP service and CLI surface where it helps real users.

## Out of scope

- Training or fine-tuning models. This project runs inference on published
  PP-OCR models; training lives elsewhere.
- Features outside OCR (general computer vision lives in sibling packages such
  as ppu-ocv).

## Proposing changes

Open an issue to discuss direction, or a pull request for a concrete change.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).
