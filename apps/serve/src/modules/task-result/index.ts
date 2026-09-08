import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { errorResponse, failure, jsonResponse, success } from "../../core/api-response.js";
import { batchResultSchema, taskIdParamsSchema } from "../../core/schemas.js";
import { tasks } from "../../core/tasks.js";
import type { Env } from "../../core/types.js";
import { validate } from "../../core/validate.js";

export function mount(app: Hono<Env>): void {
  app.get(
    "/v1/tasks/:id/result",
    describeRoute({
      tags: ["Tasks"],
      summary: "Task result",
      security: [{ Bearer: [] }],
      responses: {
        200: jsonResponse("Result.", batchResultSchema),
        404: errorResponse("Unknown task id."),
        409: errorResponse("Task not finished, failed, or cancelled."),
      },
    }),
    validate("param", taskIdParamsSchema),
    (c) => {
      const requestId = c.get("requestId");
      const task = tasks.get(c.req.valid("param").id);
      if (!task) return c.json(failure("Unknown task id", requestId), 404);
      if (task.status === "failed" || task.status === "cancelled") {
        return c.json(failure(task.error ?? `Task ${task.status}`, requestId), 409);
      }
      if (task.status !== "done") return c.json(failure(`Task is ${task.status}`, requestId), 409);
      // SAFETY: the status check above establishes the task completed, and the
      // batch worker is the only writer of `result`.
      const result = task.result as { results: unknown[] };
      return c.json(success(c, { results: result.results }), 200);
    }
  );
}
