// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { PaddleOptions } from "../interface.js";

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

/** Constructor options on the left, whatever the call passes through on the right. */
export type SplitOptions<T> = { paddle: PaddleOptions; perCall: Omit<T, keyof PaddleOptions> };

/**
 * Split a combined `PaddleOptions & T` bag into the constructor portion and
 * the per-call portion so the one-shot helpers do not leak constructor keys
 * into `service.recognize()` or `service.detect()`.
 */
export function splitOptions<T extends object>(options?: PaddleOptions & T): SplitOptions<T> {
  if (!options) {
    // SAFETY: an empty bag has no per-call keys; the cast only names the shape.
    return { paddle: {}, perCall: {} as Omit<T, keyof PaddleOptions> };
  }
  const { model, detection, recognition, debugging, session, processing, ...perCall } = options;
  return {
    paddle: { model, detection, recognition, debugging, session, processing },
    perCall,
  };
}
