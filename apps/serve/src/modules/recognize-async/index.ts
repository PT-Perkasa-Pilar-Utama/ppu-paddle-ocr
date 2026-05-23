import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { submitJob } from "../../lib/async-jobs.js";
import { resolveBatch } from "../../lib/runner.js";
import { batchOcrSchema, errorResponse, taskAcceptedSchema } from "../../lib/schemas.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "post",
  path: "/v1/ocr/async",
  tags: ["Tasks"],
  summary: "Enqueue a batch job",
  security: [{ Bearer: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: batchOcrSchema } } },
  },
  responses: {
    202: {
      description: "Accepted.",
      content: { "application/json": { schema: taskAcceptedSchema } },
    },
    400: errorResponse("Invalid input."),
  },
});

export const handler: RouteHandler<typeof route, Env> = async (c) => {
  const body = c.req.valid("json");
  const images = await resolveBatch(body.sources);
  const taskId = submitJob(images, body);
  return c.json({ taskId, status: "queued" }, 202);
};
