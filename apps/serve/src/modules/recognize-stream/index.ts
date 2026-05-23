import { createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { errorResponse } from "../../core/api-response.js";
import { batchOcrSchema } from "../../core/schemas.js";
import { resolveBatch, streamBatch } from "../../core/runner.js";
import type { Env } from "../../core/types.js";

export const route = createRoute({
  method: "post",
  path: "/v1/ocr/stream",
  tags: ["OCR"],
  summary: "Stream batch results (SSE)",
  description: "Emits one `fulfilled`/`rejected` SSE event per image, then a `done` event.",
  security: [{ Bearer: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: batchOcrSchema } } },
  },
  responses: {
    200: {
      description: "Server-sent events (one JSON event per image, then `done`).",
      content: { "text/event-stream": { schema: z.string() } },
    },
    400: errorResponse("Invalid input."),
  },
});

export const handler: RouteHandler<typeof route, Env> = async (c) => {
  const body = c.req.valid("json");
  const images = await resolveBatch(body.sources);
  return streamSSE(c, async (stream) => {
    for await (const item of streamBatch(images, body)) {
      await stream.writeSSE({ event: item.status, data: JSON.stringify(item) });
    }
    await stream.writeSSE({ event: "done", data: "{}" });
  });
};
