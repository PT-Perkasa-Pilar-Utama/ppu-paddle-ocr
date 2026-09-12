// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterEach, describe, expect, test } from "bun:test";

import { fetchArrayBufferWithRetry, parseRetryAfter } from "../src/utils.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchArrayBufferWithRetry", () => {
  test("returns the downloaded bytes on first success", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(payload, { status: 200 });
    }) as unknown as typeof fetch;

    const buf = await fetchArrayBufferWithRetry("https://example.test/model.ort");
    expect(new Uint8Array(buf)).toEqual(payload);
    expect(calls).toBe(1);
  });

  test("retries a transient failure, then succeeds", async () => {
    const payload = new Uint8Array([9]);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw new Error("ECONNRESET");
      return new Response(payload, { status: 200 });
    }) as unknown as typeof fetch;

    const buf = await fetchArrayBufferWithRetry("https://example.test/model.ort", { retries: 2 });
    expect(new Uint8Array(buf)).toEqual(payload);
    expect(calls).toBe(2);
  });

  test("treats a non-2xx response as a failure and retries", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("nope", { status: 503 });
    }) as unknown as typeof fetch;

    await expect(
      fetchArrayBufferWithRetry("https://example.test/model.ort", { retries: 1 })
    ).rejects.toThrow(/after 2 attempt/);
    expect(calls).toBe(2);
  });

  test("waits out a Retry-After before retrying a 429", async () => {
    const payload = new Uint8Array([7]);
    const starts: number[] = [];
    let calls = 0;
    globalThis.fetch = (async () => {
      starts.push(Date.now());
      calls++;
      if (calls === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "1" } });
      }
      return new Response(payload, { status: 200 });
    }) as unknown as typeof fetch;

    const buf = await fetchArrayBufferWithRetry("https://example.test/model.ort", { retries: 1 });
    expect(new Uint8Array(buf)).toEqual(payload);
    expect(calls).toBe(2);
    // Without the header the first backoff would be under 1 s, so a gap of at
    // least a second proves the host's own figure won.
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(950);
  });

  test("throws after exhausting retries", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      fetchArrayBufferWithRetry("https://example.test/model.ort", { retries: 1 })
    ).rejects.toThrow(/network down/);
    expect(calls).toBe(2);
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  test("reads the delta-seconds form", () => {
    expect(parseRetryAfter("30", now)).toBe(30_000);
    expect(parseRetryAfter("  30  ", now)).toBe(30_000);
  });

  test("reads the HTTP-date form", () => {
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:45 GMT", now)).toBe(45_000);
  });

  test("clamps a date already in the past to zero", () => {
    expect(parseRetryAfter("Wed, 31 Dec 2025 23:59:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("-5", now)).toBe(0);
  });

  test("caps a header asking for longer than a minute", () => {
    expect(parseRetryAfter("3600", now)).toBe(60_000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 02:00:00 GMT", now)).toBe(60_000);
  });

  test("returns null when there is nothing usable to honour", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("   ", now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
  });
});
