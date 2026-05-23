import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { envelope, errorResponse, failure, success } from "../../core/api-response.js";
import { taskIdParamsSchema, taskStatusSchema } from "../../core/schemas.js";
import { tasks } from "../../core/tasks.js";
import type { Env } from "../../core/types.js";

export const route = createRoute({
  method: "get",
  path: "/v1/tasks/{id}",
  tags: ["Tasks"],
  summary: "Task status",
  security: [{ Bearer: [] }],
  request: { params: taskIdParamsSchema },
  responses: {
    200: {
      description: "Status.",
      content: { "application/json": { schema: envelope(taskStatusSchema) } },
    },
    404: errorResponse("Unknown task id."),
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) => {
  const task = tasks.get(c.req.valid("param").id);
  if (!task) return c.json(failure("Unknown task id", c.get("requestId")), 404);
  return c.json(success(c, { id: task.id, status: task.status, updatedAt: task.updatedAt }), 200);
};
