// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Usage text for the `ppu-paddle-ocr` CLI. Printed to stdout for `help` /
 * `--help`, and to stderr (followed by a non-zero exit) on usage errors.
 */

export const USAGE = `ppu-paddle-ocr — PaddleOCR on the command line

Usage:
  ppu-paddle-ocr <command> [args] [flags]

Commands:
  recognize <image>      OCR one image (file path or http(s) URL)
  batch <pattern...>     OCR many images (globs or a list of paths/URLs)
  stream <pattern...>    OCR many images, printing each result as it finishes
  download-models        Pre-warm the model cache (~/.cache/ppu-paddle-ocr)
  clear-cache            Delete the cached model files
  models                 Print the active models, defaults, and providers
  help                   Show this help
  version                Show the installed version

Recognition flags (recognize / batch / stream):
  --strategy <s>                 per-box | per-line | cross-line  (default per-box)
  --cross-line-width-factor <n>  bin-pack width multiplier for cross-line (default 1.0)
  --engine <e>                   opencv | canvas-native  (default opencv)
  --image-height <n>             recognition input height in px (default 48)
  --flatten                      flat results in reading order instead of grouped lines
  --no-cache                     bypass the in-memory result cache

Model overrides:
  --model-detection <path|url>
  --model-recognition <path|url>
  --model-dict <path|url>

Detection tuning:
  --max-side-length <n>          longest side before downscale (default 640)
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
  ppu-paddle-ocr recognize https://example.com/invoice.png --json --pretty
  ppu-paddle-ocr batch "scans/*.png" --strategy cross-line -o results.json --json
  ppu-paddle-ocr download-models --verbose
`;
