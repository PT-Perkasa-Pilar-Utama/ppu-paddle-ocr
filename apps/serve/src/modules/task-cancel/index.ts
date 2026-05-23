import { createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { envelope, errorResponse, failure, success } from "../../lib/api-response.js";
import { cancelJob } from "../../lib/async-jobs.js";
import { taskIdParamsSchema } from "../../lib/schemas.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "delete",
  path: "/v1/tasks/{id}",
  tags: ["Tasks"],
  summary: "Cancel a task",
  security: [{ Bearer: [] }],
  request: { params: taskIdParamsSchema },
  responses: {
    200: {
      description: "Cancelled.",
      content: {
        "application/json": {
          schema: envelope(z.object({ id: z.string(), status: z.literal("cancelled") })),
        },
      },
    },
    404: errorResponse("Unknown task id."),
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) => {
  const id = c.req.valid("param").id;
  if (!cancelJob(id)) return c.json(failure("Unknown task id", c.get("requestId")), 404);
  return c.json(success(c, { id, status: "cancelled" as const }), 200);
};
