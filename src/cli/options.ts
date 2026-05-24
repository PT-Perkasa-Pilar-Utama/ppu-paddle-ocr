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
import { usageError } from "./io.js";

/** `parseArgs` option spec shared by every command. */
export const PARSE_OPTIONS: NonNullable<ParseArgsConfig["options"]> = {
  strategy: { type: "string" },
  "cross-line-width-factor": { type: "string" },
  engine: { type: "string" },
  "image-height": { type: "string" },
  flatten: { type: "boolean" },
  "no-cache": { type: "boolean" },
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
  return parts as [number, number, number];
}

function strategy(values: CliValues): RecognitionStrategy | undefined {
  const raw = values.strategy;
  if (raw === undefined) return undefined;
  if (!STRATEGIES.includes(raw as RecognitionStrategy)) {
    usageError(`--strategy must be one of ${STRATEGIES.join(" | ")}`);
  }
  return raw as RecognitionStrategy;
}

function engine(values: CliValues): ProcessingEngine | undefined {
  const raw = values.engine;
  if (raw === undefined) return undefined;
  if (!ENGINES.includes(raw as ProcessingEngine)) {
    usageError(`--engine must be one of ${ENGINES.join(" | ")}`);
  }
  return raw as ProcessingEngine;
}

/** Build the constructor `PaddleOptions` from parsed flags. */
export function buildPaddleOptions(values: CliValues): PaddleOptions {
  const options: PaddleOptions = {};

  const detection = values["model-detection"] as string | undefined;
  const recognition = values["model-recognition"] as string | undefined;
  const dict = values["model-dict"] as string | undefined;
  if (detection || recognition || dict) {
    options.model = {
      ...(detection ? { detection } : {}),
      ...(recognition ? { recognition } : {}),
      ...(dict ? { charactersDictionary: dict } : {}),
    };
  }

  const mean = triple(values, "mean");
  const stdDeviation = triple(values, "std");
  const maxSideLength = num(values, "max-side-length");
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
  // `charactersDictionary: []` is the documented placeholder — initialize()
  // fills it from the recognition model's dictionary.
  options.recognition = {
    charactersDictionary: [],
    ...(strat ? { strategy: strat } : {}),
    ...(imageHeight !== undefined ? { imageHeight } : {}),
    ...(crossLineWidthFactor !== undefined ? { crossLineWidthFactor } : {}),
  };

  const eng = engine(values);
  if (eng) options.processing = { engine: eng };

  const providers = values["execution-providers"] as string | undefined;
  if (providers) {
    options.session = {
      executionProviders: providers.split(",").map((p) => p.trim()),
    };
  }

  if (values.verbose || values.debug || values["debug-folder"]) {
    options.debugging = {
      ...(values.verbose ? { verbose: true } : {}),
      ...(values.debug ? { debug: true } : {}),
      ...(values["debug-folder"] ? { debugFolder: values["debug-folder"] as string } : {}),
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

/** Batch options: recognize options plus concurrency/settle. */
export function buildBatchOptions(values: CliValues): BatchRecognizeOptions {
  const raw = values.concurrency as string | undefined;
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
  };
}
