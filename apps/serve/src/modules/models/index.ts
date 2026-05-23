import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { config } from "../../lib/config.js";
import { modelsSchema } from "../../lib/schemas.js";
import type { Env } from "../../lib/types.js";

export const route = createRoute({
  method: "get",
  path: "/v1/models",
  tags: ["System"],
  summary: "Available engines, strategies, and defaults",
  security: [{ Bearer: [] }],
  responses: {
    200: { description: "ok", content: { "application/json": { schema: modelsSchema } } },
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) =>
  c.json(
    {
      engines: ["opencv", "canvas-native"],
      strategies: ["per-box", "per-line", "cross-line"],
      default: { engine: config.defaultEngine, strategy: config.defaultStrategy },
      executionProviders: config.executionProviders,
    },
    200
  );
