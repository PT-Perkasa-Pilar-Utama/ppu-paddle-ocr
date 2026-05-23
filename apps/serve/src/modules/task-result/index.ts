import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler, z } from "@hono/zod-openapi";
import { errorBody } from "../../lib/errors.js";
import { batchResultSchema, errorResponse, taskIdParamsSchema } from "../../lib/schemas.js";
import { tasks } from "../../lib/tasks.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "get",
  path: "/v1/tasks/{id}/result",
  tags: ["Tasks"],
  summary: "Task result",
  security: [{ Bearer: [] }],
  request: { params: taskIdParamsSchema },
  responses: {
    200: { description: "Result.", content: { "application/json": { schema: batchResultSchema } } },
    404: errorResponse("Unknown task id."),
    409: errorResponse("Task not finished, failed, or cancelled."),
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) => {
  const requestId = c.get("requestId");
  const task = tasks.get(c.req.valid("param").id);
  if (!task) return c.json(errorBody("not_found", "Unknown task id", requestId), 404);
  if (task.status === "failed" || task.status === "cancelled") {
    return c.json(errorBody(task.status, task.error ?? `Task ${task.status}`, requestId), 409);
  }
  if (task.status !== "done") {
    return c.json(errorBody("not_ready", `Task is ${task.status}`, requestId), 409);
  }
  return c.json(task.result as z.infer<typeof batchResultSchema>, 200);
};
