import { afterEach, describe, expect, test } from "bun:test";

import { fetchArrayBufferWithRetry } from "../src/utils.js";

/**
 * Model downloads must not send a referer.
 *
 * Some hosts blocklist the origin of the page doing the embedding and answer
 * with a status that carries no CORS headers, which a browser then reports as
 * "No 'Access-Control-Allow-Origin' header is present" rather than as the block
 * it is. A referer buys a model download nothing, so none is sent.
 *
 * Bun has no referer to send, so the behaviour itself is not observable here.
 * These pin the request the browser is handed.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture the init of every fetch, answering each with `body`. */
function captureFetch(body: ArrayBuffer, status = 200): RequestInit[] {
  const calls: RequestInit[] = [];
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    calls.push(init);
    return Promise.resolve(new Response(status === 200 ? body : null, { status }));
  }) as unknown as typeof fetch;
  return calls;
}

describe("model downloads", () => {
  test("ask the browser for no referer", async () => {
    const calls = captureFetch(new Uint8Array([1, 2, 3]).buffer);

    await fetchArrayBufferWithRetry("https://example.com/model.onnx");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.referrerPolicy).toBe("no-referrer");
  });

  test("keep the policy on every retry", async () => {
    const calls = captureFetch(new ArrayBuffer(0), 500);

    await expect(
      fetchArrayBufferWithRetry("https://example.com/model.onnx", { retries: 2 })
    ).rejects.toThrow();

    expect(calls).toHaveLength(3);
    for (const init of calls) {
      expect(init.referrerPolicy).toBe("no-referrer");
    }
  });

  test("still carry the abort signal", async () => {
    const calls = captureFetch(new Uint8Array([1]).buffer);

    await fetchArrayBufferWithRetry("https://example.com/model.onnx");

    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});
