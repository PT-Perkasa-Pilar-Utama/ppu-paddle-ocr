// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { DetectOptions, PaddleOptions, RecognizeOptions } from "../interface.js";

/** Run one operation with a newly initialized service. */
export async function runOneShot<
  TService extends { initialize(): Promise<void>; destroy(): Promise<void> },
  TResult,
>(createService: () => TService, run: (service: TService) => Promise<TResult>): Promise<TResult> {
  const service = createService();
  try {
    await service.initialize();
    return await run(service);
  } finally {
    await service.destroy();
  }
}

/** Constructor vs per-call split for `ocr()`. */
export type SplitOcrResult = { paddle: PaddleOptions; perCall: RecognizeOptions };

/** Constructor vs per-call split for `detect()`. */
export type SplitDetectResult = { paddle: PaddleOptions; perCall: DetectOptions };

/**
 * Split a combined `PaddleOptions & RecognizeOptions` bag into the constructor
 * portion and the per-call portion so the one-shot helpers do not leak
 * constructor keys into `service.recognize()`.
 */
export function splitOcrOptions(options?: PaddleOptions & RecognizeOptions): SplitOcrResult {
  if (!options) return { paddle: {}, perCall: {} };
  const { model, detection, recognition, debugging, session, processing, ...perCall } = options;
  return {
    paddle: { model, detection, recognition, debugging, session, processing },
    perCall,
  };
}

/**
 * Split a combined `PaddleOptions & DetectOptions` bag into the constructor
 * portion and the per-call portion so the one-shot helpers do not leak
 * constructor keys into `service.detect()`.
 */
export function splitDetectOptions(options?: PaddleOptions & DetectOptions): SplitDetectResult {
  if (!options) return { paddle: {}, perCall: {} };
  const { model, detection, recognition, debugging, session, processing, ...perCall } = options;
  return {
    paddle: { model, detection, recognition, debugging, session, processing },
    perCall,
  };
}
