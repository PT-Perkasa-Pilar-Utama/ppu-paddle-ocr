import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { streamSSE } from "hono/streaming";
import { errorResponse } from "../../core/api-response.js";
import { resolveBatch, streamBatch } from "../../core/runner.js";
import { batchOcrSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";
import { validate } from "../../core/validate.js";

export function mount(app: Hono<Env>): void {
  app.post(
    "/v1/ocr/stream",
    describeRoute({
      tags: ["OCR"],
      summary: "Stream batch results (SSE)",
      description: "Emits one `fulfilled`/`rejected` SSE event per image, then a `done` event.",
      security: [{ Bearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(batchOcrSchema) } },
      },
      responses: {
        200: {
          description: "Server-sent events (one JSON event per image, then `done`).",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
        400: errorResponse("Invalid input."),
      },
    }),
    validate("json", batchOcrSchema),
    async (c) => {
      const body = c.req.valid("json");
      const images = await resolveBatch(body.sources);
      return streamSSE(c, async (stream) => {
        for await (const item of streamBatch(images, body)) {
          await stream.writeSSE({ event: item.status, data: JSON.stringify(item) });
        }
        await stream.writeSSE({ event: "done", data: "{}" });
      });
    }
  );
}
