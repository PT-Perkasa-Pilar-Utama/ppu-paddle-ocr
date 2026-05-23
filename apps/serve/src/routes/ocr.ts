import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { config } from "../config.js";
import { sendError } from "../errors.js";
import { readSingle } from "../input.js";
import { batchOcrSchema } from "../schemas.js";
import { resolveBatch, runBatch, runOcr, streamBatch } from "../runner.js";

export const ocr = new Hono();

const uploadLimit = bodyLimit({
  maxSize: config.maxUploadBytes,
  onError: (c) =>
    sendError(
      c,
      413,
      "payload_too_large",
      `Body exceeds MAX_UPLOAD_BYTES (${config.maxUploadBytes})`
    ),
});

// Sync single-image OCR (multipart file or JSON { source }).
ocr.post("/v1/ocr", uploadLimit, async (c) => {
  const { image, opts } = await readSingle(c);
  const { result, meta } = await runOcr(image, opts);
  return c.json({ ...(result as object), meta });
});

// Sync batch OCR.
ocr.post("/v1/ocr/batch", async (c) => {
  const body = batchOcrSchema.parse(await c.req.json());
  const images = await resolveBatch(body.sources);
  const { results, meta } = await runBatch(images, body);
  return c.json({ results, meta });
});

// Streaming batch OCR: one SSE event per image as it finishes.
ocr.post("/v1/ocr/stream", async (c) => {
  const body = batchOcrSchema.parse(await c.req.json());
  const images = await resolveBatch(body.sources);
  return streamSSE(c, async (stream) => {
    for await (const item of streamBatch(images, body)) {
      await stream.writeSSE({ event: item.status, data: JSON.stringify(item) });
    }
    await stream.writeSSE({ event: "done", data: "{}" });
  });
});
