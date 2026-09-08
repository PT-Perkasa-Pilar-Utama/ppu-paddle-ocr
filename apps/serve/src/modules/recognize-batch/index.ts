import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { errorResponse, jsonResponse, success } from "../../core/api-response.js";
import { resolveBatch, runBatch } from "../../core/runner.js";
import { batchOcrSchema, batchResultSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";
import { validate } from "../../core/validate.js";

export function mount(app: Hono<Env>): void {
  app.post(
    "/v1/ocr/batch",
    describeRoute({
      tags: ["OCR"],
      summary: "Recognize many images",
      security: [{ Bearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(batchOcrSchema) } },
      },
      responses: {
        200: jsonResponse("Batch results, index-aligned to inputs.", batchResultSchema),
        400: errorResponse("Invalid input."),
        429: errorResponse("Rate limited."),
      },
    }),
    validate("json", batchOcrSchema),
    async (c) => {
      const body = c.req.valid("json");
      const images = await resolveBatch(body.sources);
      const { results, meta } = await runBatch(images, body);
      return c.json(
        // SAFETY: the envelope carries results verbatim; the array element type
        // is the OCR result shape the route's response schema already declares.
        success(
          c,
          { results: results as unknown[] },
          { engine: meta.engine, strategy: meta.strategy }
        ),
        200
      );
    }
  );
}
