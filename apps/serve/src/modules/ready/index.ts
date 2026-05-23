import { createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { errorBody } from "../../lib/errors.js";
import { errorResponse } from "../../lib/schemas.js";
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
      content: { "application/json": { schema: z.object({ status: z.literal("ready") }) } },
    },
    503: errorResponse("Models are still loading."),
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) =>
  isReady()
    ? c.json({ status: "ready" } as const, 200)
    : c.json(errorBody("not_ready", "Models are still loading", c.get("requestId")), 503);
