// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Deep merges multiple objects into the target object.
 * Arrays are overwritten, not concatenated.
 *
 * @param target The target object to merge into.
 * @param sources The source objects to merge from.
 * @returns The merged target object.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          continue;
        }

        const sourceValue = source[key];
        const targetValue = target[key];

        if (isObject(sourceValue)) {
          if (!targetValue || !isObject(targetValue)) {
            target[key] = {} as T[Extract<keyof T, string>];
          }
          deepMerge(target[key] as Record<string, unknown>, sourceValue as Record<string, unknown>);
        } else if (sourceValue !== undefined) {
          target[key] = sourceValue as T[Extract<keyof T, string>];
        }
      }
    }
  }

  return deepMerge(target, ...sources);
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n] ?? 0;
}

/**
 * Fetches a URL as an `ArrayBuffer` with a per-attempt deadline and bounded
 * retries. Each attempt is aborted after `timeoutMs` (covering both the
 * response headers and the body download), so a stalled connection fails fast
 * and is retried instead of hanging indefinitely.
 *
 * @param url - Resource to download.
 * @param options - `timeoutMs` per-attempt deadline (default 300 000 ms / 5 min) and
 *   `retries` additional attempts after the first (default 2).
 * @returns The downloaded bytes.
 * @throws If every attempt fails (network error, timeout, or non-2xx response).
 */
export async function fetchArrayBufferWithRetry(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<ArrayBuffer> {
  const { timeoutMs = 300_000, retries = 2 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries + 1} attempt(s): ${String(lastError)}`);
}

/** Parse a PaddleOCR dictionary into an ordered array. Handles LF/CRLF; preserves blank entries. */
export function parseDictionary(source: ArrayBuffer | Uint8Array | string): string[] {
  const content = typeof source === "string" ? source : new TextDecoder("utf-8").decode(source);
  return content.split(/\r?\n/);
}

/**
 * Checks if a value is a plain object.
 *
 * @param item The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
export function isObject(item: unknown): item is Record<string, unknown> {
  return (
    item !== null &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    !(item instanceof Date) &&
    !(item instanceof RegExp) &&
    !(item instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(item)
  );
}
