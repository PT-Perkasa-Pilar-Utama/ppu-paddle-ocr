import { createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { renderMetrics } from "../../core/metrics.js";
import type { Env } from "../../core/types.js";

export const route = createRoute({
  method: "get",
  path: "/metrics",
  tags: ["System"],
  summary: "Prometheus metrics",
  responses: {
    200: {
      description: "Prometheus exposition text.",
      content: { "text/plain": { schema: z.string() } },
    },
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) =>
  c.text(renderMetrics(), 200, { "content-type": "text/plain; version=0.0.4" });
