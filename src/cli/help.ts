// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Usage text for the `ppu-paddle-ocr` CLI. Printed to stdout for `help` /
 * `--help`, and to stderr (followed by a non-zero exit) on usage errors.
 */

export const USAGE = `ppu-paddle-ocr - PaddleOCR on the command line

Usage:
  ppu-paddle-ocr <command> [args] [flags]

Commands:
  recognize <image>      OCR one image (file path or http(s) URL)
  detect <image>         Detect text boxes only, no recognition (JSON to stdout)
  batch <pattern...>     OCR many images (globs or a list of paths/URLs)
  stream <pattern...>    OCR many images, printing each result as it finishes
  download-models        Pre-warm the model cache (~/.cache/ppu-paddle-ocr)
  clear-cache            Delete the cached model files
  models                 Print the active models, defaults, and providers
  help                   Show this help
  version                Show the installed version

Recognition flags (recognize / batch / stream):
  --strategy <s>                 per-box | per-line | cross-line  (default per-line)
  --cross-line-width-factor <n>  bin-pack width multiplier for cross-line (default 1.0)
  --engine <e>                   opencv | canvas-native  (default opencv)
  --image-height <n>             recognition input height in px (default 48)
  --min-confidence <n>           drop items below this confidence, 0 disables (default 0.5)
  --max-crop-source-side-length <n>
                                 longest side (px) the crop source is capped at (default 2000);
                                 lower is faster on large scans, higher keeps native-res crops
  --flatten                      flat results in reading order instead of grouped lines
  --no-cache                     bypass the in-memory result cache

Model overrides:
  --model <preset>               catalogue preset, e.g. v6-small (default), v6-tiny,
                                 v5-en-mobile, v5-thai-mobile (see 'models --json')
  --model-detection <path|url>   override the preset's detection model
  --model-recognition <path|url> override the preset's recognition model
  --model-dict <path|url>        override the preset's dictionary

Detection tuning (also apply to detect):
  --save-crops <dir>             (detect only) save each region as crop_NNN.png
  --max-side-length <n|auto>     longest side before downscale (default auto)
  --padding-vertical <n>         box padding, fraction of height (default 0.4)
  --padding-horizontal <n>       box padding, fraction of height (default 0.6)
  --min-area <n>                 drop boxes smaller than this area in px (default 50)
  --mean <r,g,b>                 normalization mean (default 0.485,0.456,0.406)
  --std <r,g,b>                  normalization std dev (default 0.229,0.224,0.225)

Session:
  --execution-providers <list>   comma-separated, e.g. cpu or cuda,cpu  (default cpu)

Batch / stream:
  --concurrency <n|auto>         images in flight at once (default auto)
  --settle                       keep going past a failed image (default on for batch/stream)

Output:
  -o, --output <file>            write to a file instead of stdout
  --json                         emit structured JSON (NDJSON for stream)
  --pretty                       indent JSON output
  -q, --quiet                    suppress progress/logs on stderr
  --verbose                      log each processing step to stderr
  --debug                        dump intermediate frames to disk
  --debug-folder <dir>           where --debug writes (default out)

Examples:
  ppu-paddle-ocr recognize receipt.jpg
  ppu-paddle-ocr detect receipt.jpg --save-crops ./regions --pretty
  ppu-paddle-ocr recognize https://example.com/invoice.png --json --pretty
  ppu-paddle-ocr batch "scans/*.png" --strategy cross-line -o results.json --json
  ppu-paddle-ocr download-models --verbose
`;
