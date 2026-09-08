import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as v from "valibot";
import { jsonResponse, success } from "../../core/api-response.js";
import type { Env } from "../../core/types.js";

export function mount(app: Hono<Env>): void {
  app.get(
    "/health",
    describeRoute({
      tags: ["System"],
      summary: "Liveness probe",
      responses: { 200: jsonResponse("Service is up.", v.object({ alive: v.boolean() })) },
    }),
    (c) => c.json(success(c, { alive: true }), 200)
  );
}
