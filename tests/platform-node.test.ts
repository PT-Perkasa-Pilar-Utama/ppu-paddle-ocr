// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NodePlatformProvider } from "../src/processor/platform.node.js";

const receiptPath = `${import.meta.dir}/../assets/receipt.jpg`;
const receipt = await Bun.file(receiptPath).arrayBuffer();
const HTTP_NOT_FOUND = 404;

let server: ReturnType<typeof Bun.serve>;
let origin: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      return new URL(req.url).pathname === "/receipt.jpg"
        ? new Response(receipt)
        : new Response("nope", { status: HTTP_NOT_FOUND });
    },
  });
  origin = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("NodePlatformProvider.loadResource", () => {
  const platform = new NodePlatformProvider();

  test("returns an ArrayBuffer source untouched", async () => {
    expect(await platform.loadResource(receipt, `${origin}/unused`)).toBe(receipt);
  });

  test("reads a file path from disk", async () => {
    const loaded = await platform.loadResource(receiptPath, `${origin}/unused`);
    expect(loaded.byteLength).toBe(receipt.byteLength);
  });

  test("fetches an http URL and falls back to the default URL", async () => {
    const explicit = await platform.loadResource(`${origin}/receipt.jpg`, `${origin}/unused`);
    expect(explicit.byteLength).toBe(receipt.byteLength);

    const fallback = await platform.loadResource(undefined, `${origin}/receipt.jpg`);
    expect(fallback.byteLength).toBe(receipt.byteLength);
  });

  test("rejects a non-2xx response with the URL in the message", async () => {
    await expect(platform.loadResource(`${origin}/missing.onnx`, "")).rejects.toThrow(
      `${origin}/missing.onnx`
    );
  });
});

describe("NodePlatformProvider canvases", () => {
  const platform = new NodePlatformProvider();

  test("createCanvas produces something isCanvas accepts, plain objects are refused", () => {
    const canvas = platform.createCanvas(4, 3);
    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(3);
    expect(platform.isCanvas(canvas)).toBe(true);
    expect(platform.isCanvas({ width: 4, height: 3 })).toBe(false);
    expect(platform.isCanvas(receipt)).toBe(false);
  });
});
