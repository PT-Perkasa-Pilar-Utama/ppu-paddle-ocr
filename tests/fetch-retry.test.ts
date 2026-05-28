// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterEach, describe, expect, test } from "bun:test";

import { fetchArrayBufferWithRetry } from "../src/utils.js";

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
