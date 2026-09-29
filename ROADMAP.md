# Roadmap

ppu-paddle-ocr is stable and in maintenance. This roadmap states the direction.
It is a statement of intent, not a contract. Dates are left out on purpose,
because a small team sets its pace by capacity.

For released work, see [CHANGELOG.md](CHANGELOG.md).

## Now (maintenance)

- Keep dependencies current and the supply chain hardened: Dependabot updates,
  pinned actions, npm provenance, the SCA and SAST gates in CI.
- Track ONNX Runtime releases and upgrade when a release passes the test suite.
- Fix reported bugs and answer issues within the timeframes in
  [SECURITY.md](SECURITY.md).
- Hold test coverage steady (enforced in CI).

## Next: the next PP-OCR generation

The next large release waits on PaddleOCR. When PaddlePaddle publishes a new
generation of PP-OCR models, we will:

- Convert the models to ONNX and host them next to the current set.
- Add presets for them to the model catalogue.
- Benchmark them against PP-OCRv6 on speed and accuracy, and change the
  defaults only when the new models win.
- Ship a major version if the default model changes, as 6.0.0 did for
  PP-OCRv6.

## Between generations

- Add presets when PaddleOCR publishes new languages for the current
  generation.
- Grow the `apps/serve` HTTP service and the CLI where users ask for it.

## Out of scope

- Training models. This library runs inference on published PP-OCR models. To
  fine-tune recognition for your documents, train with PaddleOCR and load the
  result as a custom model. [examples/fine-tune/](examples/fine-tune/) shows
  how.
- Features outside OCR. General computer vision lives in sibling packages such
  as ppu-ocv.

## Proposing changes

Open an issue to discuss direction, or a pull request for a concrete change.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).
