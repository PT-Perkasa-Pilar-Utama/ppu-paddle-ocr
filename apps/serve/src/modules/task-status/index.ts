import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { errorBody } from "../../lib/errors.js";
import { errorResponse, taskIdParamsSchema, taskStatusSchema } from "../../lib/schemas.js";
import { tasks } from "../../lib/tasks.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "get",
  path: "/v1/tasks/{id}",
  tags: ["Tasks"],
  summary: "Task status",
  security: [{ Bearer: [] }],
  request: { params: taskIdParamsSchema },
  responses: {
    200: { description: "Status.", content: { "application/json": { schema: taskStatusSchema } } },
    404: errorResponse("Unknown task id."),
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) => {
  const task = tasks.get(c.req.valid("param").id);
  if (!task) return c.json(errorBody("not_found", "Unknown task id", c.get("requestId")), 404);
  return c.json({ id: task.id, status: task.status, updatedAt: task.updatedAt }, 200);
};
