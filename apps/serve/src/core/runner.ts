import type { BatchItemResult, DetectResult, ProcessingEngine } from "ppu-paddle-ocr";
import { config } from "./config.js";
import { badRequest } from "./errors.js";
import { resolveSource } from "./input.js";
import type { BatchOcrBody, OcrOptions } from "./schemas.js";
import { getService, queue } from "./service.js";

export type OcrMeta = { engine: ProcessingEngine; strategy: string; ms: number };
export type OcrResponse = { result: unknown; meta: OcrMeta };

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Recognize one image through the bounded inference queue. */
export async function runOcr(image: ArrayBuffer, opts: OcrOptions): Promise<OcrResponse> {
  // SAFETY: the request schema restricts `engine` to the same union, and the
  // config default is validated at startup.
  const engine = (opts.engine ?? config.defaultEngine) as ProcessingEngine;
  const strategy = opts.strategy ?? config.defaultStrategy;
  const svc = await getService(engine);

  const start = performance.now();
  const result = opts.flatten
    ? await queue.run(() => svc.recognize(image, { flatten: true, strategy, noCache: true }))
    : await queue.run(() => svc.recognize(image, { strategy, noCache: true }));
  return { result, meta: { engine, strategy, ms: round1(performance.now() - start) } };
}

export type DetectResponse = {
  result: DetectResult;
  meta: { engine: ProcessingEngine; ms: number };
};

/** Detect text boxes only (no recognition) through the bounded inference queue. */
export async function runDetect(image: ArrayBuffer, opts: OcrOptions): Promise<DetectResponse> {
  // SAFETY: as in runOcr above.
  const engine = (opts.engine ?? config.defaultEngine) as ProcessingEngine;
  const svc = await getService(engine);

  const start = performance.now();
  const result = await queue.run(() => svc.detect(image));
  return { result, meta: { engine, ms: round1(performance.now() - start) } };
}

/** Resolve a batch of `sources` to image buffers, bounded by MAX_BATCH_IMAGES. */
export async function resolveBatch(sources: string[]): Promise<ArrayBuffer[]> {
  if (sources.length > config.maxBatchImages) {
    throw badRequest(`Too many sources (max ${config.maxBatchImages})`);
  }
  return Promise.all(sources.map(resolveSource));
}

function batchOptions(body: BatchOcrBody) {
  return {
    // SAFETY: as in runOcr above.
    engine: (body.engine ?? config.defaultEngine) as ProcessingEngine,
    strategy: body.strategy ?? config.defaultStrategy,
    concurrency: body.concurrency ?? config.concurrency,
    flatten: body.flatten ?? false,
  };
}

export type BatchResponse = {
  results: unknown;
  meta: { engine: ProcessingEngine; strategy: string };
};

/** Recognize a batch; `batchRecognize` applies its own bounded concurrency. */
export async function runBatch(
  images: ArrayBuffer[],
  body: BatchOcrBody,
  signal?: AbortSignal
): Promise<BatchResponse> {
  const { engine, strategy, concurrency, flatten } = batchOptions(body);
  const svc = await getService(engine);
  const opts = { strategy, concurrency, noCache: true, flatten, signal };
  const results = body.settle
    ? await svc.batchRecognize(images, { ...opts, settle: true })
    : await svc.batchRecognize(images, opts);
  return { results, meta: { engine, strategy } };
}

/** Stream batch results as each image finishes (completion order). */
export async function* streamBatch(
  images: ArrayBuffer[],
  body: BatchOcrBody
): AsyncGenerator<BatchItemResult<unknown>> {
  const { engine, strategy, concurrency, flatten } = batchOptions(body);
  const svc = await getService(engine);
  yield* svc.batchRecognizeStream(images, {
    strategy,
    concurrency,
    noCache: true,
    flatten,
    settle: body.settle ?? false,
  });
}
