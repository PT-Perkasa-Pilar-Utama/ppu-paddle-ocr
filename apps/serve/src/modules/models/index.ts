import { createRoute } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { envelope, success } from "../../core/api-response.js";
import { config } from "../../core/config.js";
import { modelsSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";

export const route = createRoute({
  method: "get",
  path: "/v1/models",
  tags: ["System"],
  summary: "Available engines, strategies, and defaults",
  security: [{ Bearer: [] }],
  responses: {
    200: { description: "ok", content: { "application/json": { schema: envelope(modelsSchema) } } },
  },
});

export const handler: RouteHandler<typeof route, Env> = (c) =>
  c.json(
    success(c, {
      engines: ["opencv", "canvas-native"],
      strategies: ["per-box", "per-line", "cross-line"],
      default: { engine: config.defaultEngine, strategy: config.defaultStrategy },
      executionProviders: config.executionProviders,
    }),
    200
  );
