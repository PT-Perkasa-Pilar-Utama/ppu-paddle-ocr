import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { errorResponse, jsonResponse, success } from "../../core/api-response.js";
import { submitJob } from "../../core/async-jobs.js";
import { resolveBatch } from "../../core/runner.js";
import { batchOcrSchema, taskAcceptedSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";
import { validate } from "../../core/validate.js";

export function mount(app: Hono<Env>): void {
  app.post(
    "/v1/ocr/async",
    describeRoute({
      tags: ["Tasks"],
      summary: "Enqueue a batch job",
      security: [{ Bearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(batchOcrSchema) } },
      },
      responses: {
        202: jsonResponse("Accepted.", taskAcceptedSchema),
        400: errorResponse("Invalid input."),
      },
    }),
    validate("json", batchOcrSchema),
    async (c) => {
      const body = c.req.valid("json");
      const images = await resolveBatch(body.sources);
      const taskId = submitJob(images, body);
      return c.json(success(c, { taskId, status: "queued" }), 202);
    }
  );
}
