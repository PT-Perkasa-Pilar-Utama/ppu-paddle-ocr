// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Command implementations. Each owns one `PaddleOcrService` lifecycle and
 * throws `CliError` on failure; the dispatcher in `index.ts` maps that to an
 * exit code. Recognized text and structured JSON go to stdout; progress and
 * logs go to stderr.
 */

import os from "node:os";
import path from "node:path";

import type { AnyOcrResult } from "../core/base-paddle-ocr.service.js";
import { DEFAULT_MODEL_URLS, MODEL_PRESETS } from "../index.js";
import { PaddleOcrService } from "../processor/paddle-ocr.service.js";
import {
  CliError,
  expandPatterns,
  isMissingLocalFile,
  loadImageInput,
  logStderr,
  writeOutput,
} from "./io.js";
import type { CliValues } from "./options.js";
import { buildBatchOptions, buildPaddleOptions, buildRecognizeOptions, str } from "./options.js";

type BatchEntry = {
  file: string;
  status: "fulfilled" | "rejected";
  result?: AnyOcrResult;
  error?: string;
};

function stringify(value: unknown, values: CliValues): string {
  return JSON.stringify(value, null, values.pretty ? 2 : undefined);
}

function errMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Fail fast if any local (non-URL) path is missing, before warming models. */
function assertLocalFilesExist(files: string[]): void {
  const missing = files.filter(isMissingLocalFile);
  if (missing.length > 0) {
    throw new CliError(`No such file${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  }
}

export async function runRecognize(images: string[], values: CliValues): Promise<void> {
  const [image] = images;
  if (!image || images.length !== 1) {
    throw new CliError("recognize takes exactly one image; use 'batch' for multiple", 2);
  }
  const service = new PaddleOcrService(buildPaddleOptions(values));
  try {
    logStderr("Loading models...", Boolean(values.quiet));
    await service.initialize();
    const input = await loadImageInput(image);
    const opts = buildRecognizeOptions(values);
    const result = values.flatten
      ? await service.recognize(input, { ...opts, flatten: true })
      : await service.recognize(input, { ...opts, flatten: false });
    if (values.json) {
      writeOutput(stringify(result, values), str(values, "output"));
    } else {
      writeOutput(result.text, str(values, "output"));
    }
  } finally {
    await service.destroy();
  }
}

export async function runDetect(images: string[], values: CliValues): Promise<void> {
  const [image] = images;
  if (!image || images.length !== 1) {
    throw new CliError("detect takes exactly one image", 2);
  }
  const service = new PaddleOcrService(buildPaddleOptions(values));
  try {
    logStderr("Loading models...", Boolean(values.quiet));
    await service.initialize();
    const input = await loadImageInput(image);
    const saveCropsTo = str(values, "save-crops");
    const { boxes } = await service.detect(input, saveCropsTo ? { saveCropsTo } : undefined);
    if (saveCropsTo) {
      logStderr(`Saved ${boxes.length} crop(s) to ${saveCropsTo}`, Boolean(values.quiet));
    }
    writeOutput(stringify(boxes, values), str(values, "output"));
  } finally {
    await service.destroy();
  }
}

export async function runBatch(patterns: string[], values: CliValues): Promise<void> {
  const files = expandPatterns(patterns);
  if (files.length === 0) throw new CliError("batch needs at least one image", 2);
  assertLocalFilesExist(files);

  const service = new PaddleOcrService(buildPaddleOptions(values));
  try {
    logStderr(`Loading models, then OCR'ing ${files.length} image(s)...`, Boolean(values.quiet));
    await service.initialize();

    const inputs = async function* (): AsyncGenerator<ArrayBuffer> {
      for (const file of files) yield loadImageInput(file);
    };
    const settled = await service.batchRecognize(inputs(), {
      ...buildBatchOptions(values),
      settle: true,
      onProgress: (done) => logStderr(`  ${done}/${files.length}`, Boolean(values.quiet)),
    });

    const entries: BatchEntry[] = settled.map((item) => {
      const file = files[item.index] ?? "?";
      return item.status === "fulfilled"
        ? { file, status: "fulfilled", result: item.value }
        : { file, status: "rejected", error: errMessage(item.reason) };
    });

    if (values.json) {
      writeOutput(stringify(entries, values), str(values, "output"));
    } else {
      const blocks = entries.map((e) =>
        e.result ? `==> ${e.file} <==\n${e.result.text}` : `==> ${e.file} <==\nERROR: ${e.error}`
      );
      writeOutput(blocks.join("\n\n"), str(values, "output"));
    }

    if (entries.some((e) => e.status === "rejected")) {
      throw new CliError(
        `${entries.filter((e) => e.status === "rejected").length} image(s) failed`
      );
    }
  } finally {
    await service.destroy();
  }
}

export async function runStream(patterns: string[], values: CliValues): Promise<void> {
  const files = expandPatterns(patterns);
  if (files.length === 0) throw new CliError("stream needs at least one image", 2);
  assertLocalFilesExist(files);

  const service = new PaddleOcrService(buildPaddleOptions(values));
  let failures = 0;
  try {
    logStderr("Loading models...", Boolean(values.quiet));
    await service.initialize();

    const inputs = async function* (): AsyncGenerator<ArrayBuffer> {
      for (const file of files) yield loadImageInput(file);
    };
    for await (const item of service.batchRecognizeStream(inputs(), {
      ...buildBatchOptions(values),
      settle: true,
    })) {
      const file = files[item.index] ?? "?";
      if (item.status === "fulfilled") {
        const entry: BatchEntry = { file, status: "fulfilled", result: item.value };
        writeOutput(values.json ? stringify(entry, values) : `==> ${file} <==\n${item.value.text}`);
      } else {
        failures++;
        const error = errMessage(item.reason);
        const entry: BatchEntry = { file, status: "rejected", error };
        if (values.json) writeOutput(stringify(entry, values));
        else logStderr(`==> ${file} <==\nERROR: ${error}`, Boolean(values.quiet));
      }
    }
  } finally {
    await service.destroy();
  }
  if (failures > 0) throw new CliError(`${failures} image(s) failed`);
}

export async function runDownloadModels(values: CliValues): Promise<void> {
  await PaddleOcrService.downloadModels({ verbose: !values.quiet });
  logStderr("Models cached.", Boolean(values.quiet));
}

export function runClearCache(values: CliValues): void {
  new PaddleOcrService().clearModelCache();
  logStderr("Cache cleared.", Boolean(values.quiet));
}

export function runModels(values: CliValues): void {
  const built = buildPaddleOptions(values);
  const info = {
    cacheDir: path.join(os.homedir(), ".cache", "ppu-paddle-ocr"),
    models: {
      detection: built.model?.detection ?? DEFAULT_MODEL_URLS.detection,
      recognition: built.model?.recognition ?? DEFAULT_MODEL_URLS.recognition,
      charactersDictionary:
        built.model?.charactersDictionary ?? DEFAULT_MODEL_URLS.charactersDictionary,
    },
    strategy: built.recognition?.strategy ?? "per-box",
    engine: built.processing?.engine ?? "opencv",
    executionProviders: built.session?.executionProviders ?? ["cpu"],
    presets: Object.keys(MODEL_PRESETS),
  };
  writeOutput(stringify(info, values), str(values, "output"));
}
