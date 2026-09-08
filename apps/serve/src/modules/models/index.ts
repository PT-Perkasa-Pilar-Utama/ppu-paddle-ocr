import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { jsonResponse, success } from "../../core/api-response.js";
import { config } from "../../core/config.js";
import { modelsSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";

export function mount(app: Hono<Env>): void {
  app.get(
    "/v1/models",
    describeRoute({
      tags: ["System"],
      summary: "Available engines, strategies, and defaults",
      security: [{ Bearer: [] }],
      responses: { 200: jsonResponse("ok", modelsSchema) },
    }),
    (c) =>
      c.json(
        success(c, {
          engines: ["opencv", "canvas-native"],
          strategies: ["per-box", "per-line", "cross-line"],
          default: { engine: config.defaultEngine, strategy: config.defaultStrategy },
          executionProviders: config.executionProviders,
        }),
        200
      )
  );
}
