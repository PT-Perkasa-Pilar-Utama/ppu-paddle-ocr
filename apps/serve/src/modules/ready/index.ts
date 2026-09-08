import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as v from "valibot";
import { errorResponse, failure, jsonResponse, success } from "../../core/api-response.js";
import { isReady } from "../../core/service.js";
import type { Env } from "../../core/types.js";

export function mount(app: Hono<Env>): void {
  app.get(
    "/ready",
    describeRoute({
      tags: ["System"],
      summary: "Readiness probe (200 once models are warmed)",
      responses: {
        200: jsonResponse("Models warmed.", v.object({ ready: v.boolean() })),
        503: errorResponse("Models are still loading."),
      },
    }),
    (c) =>
      isReady()
        ? c.json(success(c, { ready: true }), 200)
        : c.json(failure("Models are still loading", c.get("requestId")), 503)
  );
}
