import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { renderMetrics } from "../../core/metrics.js";
import type { Env } from "../../core/types.js";

export function mount(app: Hono<Env>): void {
  app.get(
    "/metrics",
    describeRoute({
      tags: ["System"],
      summary: "Prometheus metrics",
      responses: {
        200: {
          description: "Prometheus exposition text.",
          content: { "text/plain": { schema: { type: "string" } } },
        },
      },
    }),
    (c) => c.text(renderMetrics(), 200, { "content-type": "text/plain; version=0.0.4" })
  );
}
