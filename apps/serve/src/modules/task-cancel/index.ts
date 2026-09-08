import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as v from "valibot";
import { errorResponse, failure, jsonResponse, success } from "../../core/api-response.js";
import { cancelJob } from "../../core/async-jobs.js";
import { taskIdParamsSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";
import { validate } from "../../core/validate.js";

export function mount(app: Hono<Env>): void {
  app.delete(
    "/v1/tasks/:id",
    describeRoute({
      tags: ["Tasks"],
      summary: "Cancel a task",
      security: [{ Bearer: [] }],
      responses: {
        200: jsonResponse(
          "Cancelled.",
          v.object({ id: v.string(), status: v.literal("cancelled") })
        ),
        404: errorResponse("Unknown task id."),
      },
    }),
    validate("param", taskIdParamsSchema),
    (c) => {
      const id = c.req.valid("param").id;
      if (!cancelJob(id)) return c.json(failure("Unknown task id", c.get("requestId")), 404);
      return c.json(success(c, { id, status: "cancelled" as const }), 200);
    }
  );
}
