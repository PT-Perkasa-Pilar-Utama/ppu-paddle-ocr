import { createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness probe",
  responses: {
    200: {
      description: "Service is up.",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) =>
  c.json({ status: "ok" } as const, 200);
