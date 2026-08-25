import { describe, expect, test } from "bun:test";

import { ImageCache } from "../src/core/image-cache.js";

/**
 * The cache key stands in for the whole image. Two different images that map to
 * one key make `recognize()` return the first one's text for the second, so the
 * key has to depend on bytes throughout the buffer, not just its head.
 */

describe("ImageCache.generateKey", () => {
  test("separates buffers that share a header and a length", () => {
    // The shape canvas input takes: raw RGBA of the same dimensions, so the
    // lengths match, opening with identical uniform-margin pixels. The bodies
    // differ the way two documents do, over a region rather than one byte.
    const a = new Uint8Array(8192).fill(255, 0, 2048);
    const b = new Uint8Array(8192).fill(255, 0, 2048);
    a.fill(42, 5000, 5200);
    b.fill(99, 5000, 5200);

    expect(ImageCache.generateKey(a.buffer)).not.toBe(ImageCache.generateKey(b.buffer));
  });

  test("separates buffers that differ only in their last bytes", () => {
    const a = new Uint8Array(1 << 20);
    const b = new Uint8Array(1 << 20);
    a[a.length - 1] = 1;

    expect(ImageCache.generateKey(a.buffer)).not.toBe(ImageCache.generateKey(b.buffer));
  });

  test("is stable for equal buffers", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);

    expect(ImageCache.generateKey(a.buffer)).toBe(ImageCache.generateKey(b.buffer));
  });

  test("separates buffers of different lengths with the same content", () => {
    const a = new Uint8Array(64).fill(7);
    const b = new Uint8Array(65).fill(7);

    expect(ImageCache.generateKey(a.buffer)).not.toBe(ImageCache.generateKey(b.buffer));
  });
});
