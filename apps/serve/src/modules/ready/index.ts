import { createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { envelope, errorResponse, failure, success } from "../../lib/api-response.js";
import { isReady } from "../../lib/service.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "get",
  path: "/ready",
  tags: ["System"],
  summary: "Readiness probe (200 once models are warmed)",
  responses: {
    200: {
      description: "Models warmed.",
      content: { "application/json": { schema: envelope(z.object({ ready: z.boolean() })) } },
    },
    503: errorResponse("Models are still loading."),
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) =>
  isReady()
    ? c.json(success(c, { ready: true }), 200)
    : c.json(failure("Models are still loading", c.get("requestId")), 503);
