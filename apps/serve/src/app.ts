import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config.js";
import { errorBody, HttpError, sendError } from "./errors.js";
import { recordRequest } from "./metrics.js";
import { openapiSpec, scalarHtml } from "./openapi.js";
import { QueueFullError } from "./queue.js";
import { asyncOcr } from "./routes/async.js";
import { ocr } from "./routes/ocr.js";
import { system } from "./routes/system.js";
import { ZodError } from "zod";

export const app = new Hono<{ Variables: RequestIdVariables }>();

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors({ origin: config.corsOrigins }));

// Per-request metrics, keyed by the matched route pattern (low cardinality).
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  recordRequest(c.req.routePath, c.res.status, (performance.now() - start) / 1000);
});

// Optional API-key auth on the API surface; health/ready/metrics/docs stay open.
if (config.apiKey) {
  app.use("/v1/*", bearerAuth({ token: config.apiKey }));
}

app.get("/openapi.json", (c) => c.json(openapiSpec));
app.get("/docs", (c) => c.html(scalarHtml));

app.route("/", system);
app.route("/", ocr);
app.route("/", asyncOcr);

app.notFound((c) => sendError(c, 404, "not_found", "Route not found"));

app.onError((err, c) => {
  if (err instanceof HttpError) return sendError(c, err.status, err.code, err.message);
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return sendError(c, 400, "validation_error", detail);
  }
  if (err instanceof QueueFullError) {
    return c.json(errorBody("too_many_requests", err.message, c.get("requestId")), 429, {
      "Retry-After": "1",
    });
  }
  console.error("[unhandled]", err);
  return sendError(c, 500, "internal_error", "Internal server error");
});
