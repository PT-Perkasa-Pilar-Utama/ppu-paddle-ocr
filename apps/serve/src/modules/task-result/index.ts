import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { envelope, errorResponse, failure, success } from "../../core/api-response.js";
import { batchResultSchema, taskIdParamsSchema } from "../../core/schemas.js";
import { tasks } from "../../core/tasks.js";
import type { Env } from "../../core/types.js";

export const route = createRoute({
  method: "get",
  path: "/v1/tasks/{id}/result",
  tags: ["Tasks"],
  summary: "Task result",
  security: [{ Bearer: [] }],
  request: { params: taskIdParamsSchema },
  responses: {
    200: {
      description: "Result.",
      content: { "application/json": { schema: envelope(batchResultSchema) } },
    },
    404: errorResponse("Unknown task id."),
    409: errorResponse("Task not finished, failed, or cancelled."),
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) => {
  const requestId = c.get("requestId");
  const task = tasks.get(c.req.valid("param").id);
  if (!task) return c.json(failure("Unknown task id", requestId), 404);
  if (task.status === "failed" || task.status === "cancelled") {
    return c.json(failure(task.error ?? `Task ${task.status}`, requestId), 409);
  }
  if (task.status !== "done") return c.json(failure(`Task is ${task.status}`, requestId), 409);
  const result = task.result as { results: unknown[] };
  return c.json(success(c, { results: result.results }), 200);
};
