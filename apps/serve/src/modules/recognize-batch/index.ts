import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { envelope, errorResponse, success } from "../../lib/api-response.js";
import { resolveBatch, runBatch } from "../../lib/runner.js";
import { batchOcrSchema, batchResultSchema } from "../../lib/schemas.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "post",
  path: "/v1/ocr/batch",
  tags: ["OCR"],
  summary: "Recognize many images",
  security: [{ Bearer: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: batchOcrSchema } } },
  },
  responses: {
    200: {
      description: "Batch results, index-aligned to inputs.",
      content: { "application/json": { schema: envelope(batchResultSchema) } },
    },
    400: errorResponse("Invalid input."),
    429: errorResponse("Rate limited."),
  },
});

export const handler: RouteHandler<typeof route, Env> = async (c) => {
  const body = c.req.valid("json");
  const images = await resolveBatch(body.sources);
  const { results, meta } = await runBatch(images, body);
  return c.json(
    success(c, { results: results as unknown[] }, { engine: meta.engine, strategy: meta.strategy }),
    200
  );
};
