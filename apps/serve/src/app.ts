import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { bearerAuth } from "hono/bearer-auth";
import { getConnInfo } from "hono/bun";
import { cors } from "hono/cors";
import { ipRestriction } from "hono/ip-restriction";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { failure } from "./core/api-response.js";
import { config } from "./core/config.js";
import { HttpError, sendError } from "./core/errors.js";
import { recordRequest } from "./core/metrics.js";
import { rateLimiter } from "./core/middleware.js";
import { QueueFullError } from "./core/queue.js";
import type { Env } from "./core/types.js";
import * as detect from "./modules/detect/index.js";
import * as health from "./modules/health/index.js";
import * as metrics from "./modules/metrics/index.js";
import * as models from "./modules/models/index.js";
import * as ready from "./modules/ready/index.js";
import * as recognize from "./modules/recognize/index.js";
import * as recognizeAsync from "./modules/recognize-async/index.js";
import * as recognizeBatch from "./modules/recognize-batch/index.js";
import * as recognizeStream from "./modules/recognize-stream/index.js";
import * as taskCancel from "./modules/task-cancel/index.js";
import * as taskResult from "./modules/task-result/index.js";
import * as taskStatus from "./modules/task-status/index.js";

export const app = new OpenAPIHono<Env>({
  strict: false,
  // Consistent envelope for request-validation failures.
  defaultHook: (result, c) => {
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return sendError(c, 400, `Validation failed — ${detail}`);
    }
  },
});

app.use("*", requestId());
app.use("*", logger());
app.use("*", secureHeaders());

const allowList = config.ipWhiteList.includes("*") ? [] : config.ipWhiteList;
if (allowList.length > 0 || config.ipDenyList.length > 0) {
  app.use("*", ipRestriction(getConnInfo, { denyList: config.ipDenyList, allowList }));
}

app.use("*", cors({ origin: config.corsOrigins }));

app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  recordRequest(c.req.routePath, c.res.status, (performance.now() - start) / 1000);
});

if (config.rateLimitEnabled) app.use("/v1/*", rateLimiter());
if (config.secretKey) app.use("/v1/*", bearerAuth({ token: config.secretKey }));

// One folder = one endpoint; register each slice's route + handler.
app.openapi(health.route, health.handler);
app.openapi(ready.route, ready.handler);
app.openapi(metrics.route, metrics.handler);
app.openapi(models.route, models.handler);
// /v1/ocr accepts multipart OR JSON, so it's documented (registerPath) but
// parses its body manually rather than via auto-validation.
app.openAPIRegistry.registerPath(recognize.route);
app.post(recognize.route.path, recognize.handler);
// /v1/detect is dual-content (multipart or JSON) like /v1/ocr.
app.openAPIRegistry.registerPath(detect.route);
app.post(detect.route.path, detect.handler);
app.openapi(recognizeBatch.route, recognizeBatch.handler);
app.openapi(recognizeStream.route, recognizeStream.handler);
app.openapi(recognizeAsync.route, recognizeAsync.handler);
app.openapi(taskStatus.route, taskStatus.handler);
app.openapi(taskResult.route, taskResult.handler);
app.openapi(taskCancel.route, taskCancel.handler);

app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
  description: "Send `Authorization: Bearer <SECRET_KEY>`. Required only when SECRET_KEY is set.",
});

if (config.docsEnabled) {
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "ppu-paddle-ocr-serve",
      version: "0.2.0",
      description: "REST API serving ppu-paddle-ocr. POST an image, get OCR JSON.",
    },
  });
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "ppu-paddle-ocr-serve — API" }));
  app.get("/", (c) => c.redirect("/docs"));
} else {
  app.get("/", (c) => c.json({ name: "ppu-paddle-ocr-serve", health: "/health" }));
}

app.notFound((c) => sendError(c, 404, "Route not found"));

app.onError((err, c) => {
  if (err instanceof HttpError) return sendError(c, err.status, err.message);
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return sendError(c, 400, `Validation failed — ${detail}`);
  }
  if (err instanceof QueueFullError) {
    return c.json(failure(err.message, c.get("requestId")), 429, { "Retry-After": "1" });
  }
  console.error("[unhandled]", err);
  return sendError(c, 500, "Internal server error");
});
