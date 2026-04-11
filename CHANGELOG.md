# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
