import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { getConnInfo } from "hono/bun";
import { cors } from "hono/cors";
import { ipRestriction } from "hono/ip-restriction";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { config } from "./config.js";
import { errorBody, HttpError, sendError } from "./errors.js";
import { recordRequest } from "./metrics.js";
import { rateLimiter } from "./middleware.js";
import { openapiSpec, scalarHtml } from "./openapi.js";
import { QueueFullError } from "./queue.js";
import { asyncOcr } from "./routes/async.js";
import { ocr } from "./routes/ocr.js";
import { system } from "./routes/system.js";

export const app = new Hono<{ Variables: RequestIdVariables }>();

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());

// IP allow/deny. A "*" allow-list means "allow all" (deny-list still applies).
// Only registered when rules exist — otherwise we'd call getConnInfo for nothing
// (and it has no connection to read under app.request() in tests).
const allowList = config.ipWhiteList.includes("*") ? [] : config.ipWhiteList;
if (allowList.length > 0 || config.ipDenyList.length > 0) {
  app.use("*", ipRestriction(getConnInfo, { denyList: config.ipDenyList, allowList }));
}

app.use("*", cors({ origin: config.corsOrigins }));

// Per-request metrics, keyed by the matched route pattern (low cardinality).
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  recordRequest(c.req.routePath, c.res.status, (performance.now() - start) / 1000);
});

// API surface: rate limit, then optional secret-key auth. health/metrics/docs
// stay open and unthrottled.
if (config.rateLimitEnabled) {
  app.use("/v1/*", rateLimiter());
}
if (config.secretKey) {
  app.use("/v1/*", bearerAuth({ token: config.secretKey }));
}

if (config.docsEnabled) {
  app.get("/openapi.json", (c) => c.json(openapiSpec));
  app.get("/docs", (c) => c.html(scalarHtml));
  app.get("/", (c) => c.redirect("/docs"));
} else {
  app.get("/", (c) => c.json({ name: "ppu-paddle-ocr-serve", health: "/health" }));
}

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
