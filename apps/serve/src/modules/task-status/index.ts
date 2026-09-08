import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { errorResponse, failure, jsonResponse, success } from "../../core/api-response.js";
import { taskIdParamsSchema, taskStatusSchema } from "../../core/schemas.js";
import { tasks } from "../../core/tasks.js";
import type { Env } from "../../core/types.js";
import { validate } from "../../core/validate.js";

export function mount(app: Hono<Env>): void {
  app.get(
    "/v1/tasks/:id",
    describeRoute({
      tags: ["Tasks"],
      summary: "Task status",
      security: [{ Bearer: [] }],
      responses: {
        200: jsonResponse("Status.", taskStatusSchema),
        404: errorResponse("Unknown task id."),
      },
    }),
    validate("param", taskIdParamsSchema),
    (c) => {
      const task = tasks.get(c.req.valid("param").id);
      if (!task) return c.json(failure("Unknown task id", c.get("requestId")), 404);
      return c.json(
        success(c, { id: task.id, status: task.status, updatedAt: task.updatedAt }),
        200
      );
    }
  );
}
