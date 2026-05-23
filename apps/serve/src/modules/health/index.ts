import { createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { envelope, success } from "../../lib/api-response.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness probe",
  responses: {
    200: {
      description: "Service is up.",
      content: { "application/json": { schema: envelope(z.object({ alive: z.boolean() })) } },
    },
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) =>
  c.json(success(c, { alive: true }), 200);
