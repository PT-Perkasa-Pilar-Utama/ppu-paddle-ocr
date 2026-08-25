import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { dirname } from "path";

import { CACHE_DIR, cachePathFor, fetchAndCacheResource } from "../src/processor/model-cache.js";

/**
 * The cache is keyed on the whole URL, not just the file name. Model file
 * names repeat across hosts and directories, so a name-only key hands one
 * URL's bytes to another URL's request.
 *
 * These use a local server rather than the real catalogue: the point is the
 * key, not the models. Entries land in the real CACHE_DIR under their own
 * digest directories, which afterAll removes.
 */

// Two resources that share a file name, the shape the catalogue produces:
// the same model name under different directories.
const FIRST = "detection/model.onnx";
const SECOND = "recognition/model.onnx";
const BODIES: Record<string, string> = {
  [`/${FIRST}`]: "first-resource-bytes",
  [`/${SECOND}`]: "second-resource-bytes",
};

let server: ReturnType<typeof Bun.serve>;
let requests = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const body = BODIES[new URL(request.url).pathname];
      if (body === undefined) return new Response("not found", { status: 404 });
      requests += 1;
      return new Response(body);
    },
  });
});

afterAll(() => {
  for (const path of Object.keys(BODIES)) {
    rmSync(dirname(cachePathFor(`${server.url}${path.slice(1)}`)), {
      recursive: true,
      force: true,
    });
  }
  server.stop(true);
});

const text = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

describe("model cache", () => {
  test("keeps same-named resources from different URLs apart", async () => {
    const first = await fetchAndCacheResource(`${server.url}${FIRST}`);
    const second = await fetchAndCacheResource(`${server.url}${SECOND}`);

    expect(text(first)).toBe("first-resource-bytes");
    expect(text(second)).toBe("second-resource-bytes");
    expect(requests).toBe(2);
  });

  test("serves a repeat request from disk", async () => {
    const before = requests;
    const again = await fetchAndCacheResource(`${server.url}${FIRST}`);

    expect(text(again)).toBe("first-resource-bytes");
    expect(requests).toBe(before);
  });

  test("writes under the cache directory, keeping the file name readable", () => {
    const path = cachePathFor(`${server.url}${FIRST}`);

    expect(path.startsWith(CACHE_DIR)).toBe(true);
    expect(path.endsWith("model.onnx")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("first-resource-bytes");
  });

  test("a different host for the same path is a different entry", () => {
    expect(cachePathFor("https://a.example/m/model.onnx")).not.toBe(
      cachePathFor("https://b.example/m/model.onnx")
    );
  });
});
