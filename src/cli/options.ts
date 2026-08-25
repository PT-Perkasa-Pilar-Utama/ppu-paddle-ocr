// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Maps parsed CLI flags onto the library's option objects. Every flag here has
 * a 1:1 counterpart in `PaddleOptions` / `RecognizeOptions`.
 */

import type { ParseArgsConfig } from "node:util";

import type {
  BatchRecognizeOptions,
  PaddleOptions,
  ProcessingEngine,
  RecognitionStrategy,
  RecognizeOptions,
} from "../interface.js";
import type { ModelUrls } from "../model-catalogue.js";
import { MODEL_PRESETS } from "../model-catalogue.js";
import { usageError } from "./io.js";

/** `parseArgs` option spec shared by every command. */
export const PARSE_OPTIONS: NonNullable<ParseArgsConfig["options"]> = {
  strategy: { type: "string" },
  "cross-line-width-factor": { type: "string" },
  engine: { type: "string" },
  "image-height": { type: "string" },
  "min-confidence": { type: "string" },
  "max-crop-source-side-length": { type: "string" },
  "main-thread-yield-ms": { type: "string" },
  "rec-batch-size": { type: "string" },
  "rotate-vertical-crops": { type: "boolean" },
  "no-rotate-vertical-crops": { type: "boolean" },
  "space-recovery": { type: "boolean" },
  flatten: { type: "boolean" },
  "no-cache": { type: "boolean" },
  model: { type: "string" },
  "model-detection": { type: "string" },
  "model-recognition": { type: "string" },
  "model-dict": { type: "string" },
  "max-side-length": { type: "string" },
  "padding-vertical": { type: "string" },
  "padding-horizontal": { type: "string" },
  "min-area": { type: "string" },
  mean: { type: "string" },
  std: { type: "string" },
  "execution-providers": { type: "string" },
  concurrency: { type: "string" },
  settle: { type: "boolean" },
  "save-crops": { type: "string" },
  output: { type: "string", short: "o" },
  json: { type: "boolean" },
  pretty: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  debug: { type: "boolean" },
  "debug-folder": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

/** Shape of `parseArgs().values` for the spec above. */
export type CliValues = Record<string, string | boolean | undefined>;

const STRATEGIES: RecognitionStrategy[] = ["per-box", "per-line", "cross-line"];
const ENGINES: ProcessingEngine[] = ["opencv", "canvas-native"];

/**
 * Reads a string-valued flag. Boolean flags are declared separately in the
 * parser's option table, so a value here is either absent or a string.
 */
export function str(values: CliValues, key: string): string | undefined {
  const raw = values[key];
  return typeof raw === "string" ? raw : undefined;
}

function num(values: CliValues, key: string): number | undefined {
  const raw = values[key];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) usageError(`--${key} must be a number, got "${String(raw)}"`);
  return n;
}

function triple(values: CliValues, key: string): [number, number, number] | undefined {
  const raw = values[key];
  if (raw === undefined) return undefined;
  const parts = String(raw)
    .split(",")
    .map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    usageError(`--${key} must be three comma-separated numbers, e.g. 0.485,0.456,0.406`);
  }
  // SAFETY: the length check above establishes the tuple's arity.
  return parts as [number, number, number];
}

function strategy(values: CliValues): RecognitionStrategy | undefined {
  const raw = values.strategy;
  if (raw === undefined) return undefined;
  // SAFETY: `includes` needs the element type to compare; the cast is the
  // question being asked, and the failure path exits with a usage error.
  if (!STRATEGIES.includes(raw as RecognitionStrategy)) {
    usageError(`--strategy must be one of ${STRATEGIES.join(" | ")}`);
  }
  // SAFETY: membership in STRATEGIES was just checked.
  return raw as RecognitionStrategy;
}

function engine(values: CliValues): ProcessingEngine | undefined {
  const raw = values.engine;
  if (raw === undefined) return undefined;
  // SAFETY: as with the strategy above, the cast poses the membership question.
  if (!ENGINES.includes(raw as ProcessingEngine)) {
    usageError(`--engine must be one of ${ENGINES.join(" | ")}`);
  }
  // SAFETY: membership in ENGINES was just checked.
  return raw as ProcessingEngine;
}

/** Resolve `--model <preset>` to its URL bundle, or fail with the valid keys. */
function modelPreset(values: CliValues): ModelUrls | undefined {
  const raw = values.model;
  if (raw === undefined) return undefined;
  // SAFETY: MODEL_PRESETS is keyed by a closed union; the flag is free text, so
  // it is looked up as an open dictionary and the miss is handled below.
  const preset = (MODEL_PRESETS as Record<string, ModelUrls>)[String(raw)];
  if (!preset) {
    usageError(`--model must be one of: ${Object.keys(MODEL_PRESETS).join(", ")}`);
  }
  return preset;
}

/** Build the constructor `PaddleOptions` from parsed flags. */
export function buildPaddleOptions(values: CliValues): PaddleOptions {
  const options: PaddleOptions = {};

  // `--model <preset>` selects a catalogue bundle; the granular `--model-*`
  // flags override individual parts on top of it.
  const preset = modelPreset(values);
  const detection = str(values, "model-detection");
  const recognition = str(values, "model-recognition");
  const dict = str(values, "model-dict");
  if (preset || detection || recognition || dict) {
    options.model = {
      ...preset,
      ...(detection ? { detection } : {}),
      ...(recognition ? { recognition } : {}),
      ...(dict ? { charactersDictionary: dict } : {}),
    };
  }

  const mean = triple(values, "mean");
  const stdDeviation = triple(values, "std");
  const maxSideLength =
    values["max-side-length"] === "auto" ? ("auto" as const) : num(values, "max-side-length");
  const paddingVertical = num(values, "padding-vertical");
  const paddingHorizontal = num(values, "padding-horizontal");
  const minimumAreaThreshold = num(values, "min-area");
  if (
    mean ||
    stdDeviation ||
    maxSideLength !== undefined ||
    paddingVertical !== undefined ||
    paddingHorizontal !== undefined ||
    minimumAreaThreshold !== undefined
  ) {
    options.detection = {
      ...(mean ? { mean } : {}),
      ...(stdDeviation ? { stdDeviation } : {}),
      ...(maxSideLength !== undefined ? { maxSideLength } : {}),
      ...(paddingVertical !== undefined ? { paddingVertical } : {}),
      ...(paddingHorizontal !== undefined ? { paddingHorizontal } : {}),
      ...(minimumAreaThreshold !== undefined ? { minimumAreaThreshold } : {}),
    };
  }

  const strat = strategy(values);
  const imageHeight = num(values, "image-height");
  const crossLineWidthFactor = num(values, "cross-line-width-factor");
  const minimumConfidence = num(values, "min-confidence");
  const maxCropSourceSideLength = num(values, "max-crop-source-side-length");
  const mainThreadYieldMs = num(values, "main-thread-yield-ms");
  const recBatchSize = num(values, "rec-batch-size");
  // `charactersDictionary: []` is the documented placeholder - initialize()
  // fills it from the recognition model's dictionary.
  options.recognition = {
    charactersDictionary: [],
    ...(strat ? { strategy: strat } : {}),
    ...(imageHeight !== undefined ? { imageHeight } : {}),
    ...(crossLineWidthFactor !== undefined ? { crossLineWidthFactor } : {}),
    ...(minimumConfidence !== undefined ? { minimumConfidence } : {}),
    ...(maxCropSourceSideLength !== undefined ? { maxCropSourceSideLength } : {}),
    ...(mainThreadYieldMs !== undefined ? { mainThreadYieldMs } : {}),
    ...(recBatchSize !== undefined ? { recBatchSize } : {}),
    ...(values["rotate-vertical-crops"] ? { rotateVerticalCrops: true } : {}),
    ...(values["no-rotate-vertical-crops"] ? { rotateVerticalCrops: false } : {}),
    ...(values["space-recovery"] ? { spaceRecovery: true } : {}),
  };

  const eng = engine(values);
  // Slim standalone binaries exclude OpenCV entirely; the flag is baked in at
  // compile time by scripts/binary/build-binaries.ts via --define, so this
  // branch is dead code everywhere else.
  if (process.env.PPU_BINARY_SLIM) {
    if (eng === "opencv") {
      usageError("--engine opencv is not available in the slim binary; use the full binary");
    }
    options.processing = { engine: "canvas-native" };
  } else if (eng) {
    options.processing = { engine: eng };
  }

  const providers = str(values, "execution-providers");
  if (providers) {
    options.session = {
      executionProviders: providers.split(",").map((p) => p.trim()),
    };
  }

  if (values.verbose || values.debug || values["debug-folder"]) {
    options.debugging = {
      ...(values.verbose ? { verbose: true } : {}),
      ...(values.debug ? { debug: true } : {}),
      ...(str(values, "debug-folder") ? { debugFolder: str(values, "debug-folder") } : {}),
    };
  }

  return options;
}

/** Per-call recognize options from parsed flags. */
export function buildRecognizeOptions(values: CliValues): RecognizeOptions {
  return {
    ...(values.flatten ? { flatten: true } : {}),
    ...(values["no-cache"] ? { noCache: true } : {}),
    ...(strategy(values) ? { strategy: strategy(values) } : {}),
  };
}

/**
 * Batch options: recognize options plus concurrency. `settle` is part of the
 * return type, not a choice, so the batch commands select the settled overload.
 */
export function buildBatchOptions(values: CliValues): BatchRecognizeOptions & { settle: true } {
  const raw = str(values, "concurrency");
  let concurrency: number | "auto" | undefined;
  if (raw !== undefined) {
    if (raw === "auto") {
      concurrency = "auto";
    } else {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 1) usageError(`--concurrency must be a positive number or "auto"`);
      concurrency = n;
    }
  }
  return {
    ...buildRecognizeOptions(values),
    ...(concurrency !== undefined ? { concurrency } : {}),
    // Batch and stream always settle: one unreadable file must not throw away
    // the results of every other image, and the command still exits non-zero
    // by counting the rejected entries afterwards. `--settle` is accepted for
    // compatibility and names this default rather than switching it.
    settle: true,
  };
}
