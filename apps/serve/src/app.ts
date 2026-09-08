import { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";
import { bearerAuth } from "hono/bearer-auth";
import { getConnInfo } from "hono/bun";
import { cors } from "hono/cors";
import { ipRestriction } from "hono/ip-restriction";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { multipartDetectSchema, multipartOcrSchema } from "./core/schemas.js";
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
import * as recognizeAsync from "./modules/recognize-async/index.js";
import * as recognizeBatch from "./modules/recognize-batch/index.js";
import * as recognizeStream from "./modules/recognize-stream/index.js";
import * as recognize from "./modules/recognize/index.js";
import * as taskCancel from "./modules/task-cancel/index.js";
import * as taskResult from "./modules/task-result/index.js";
import * as taskStatus from "./modules/task-status/index.js";

export const app = new Hono<Env>({ strict: false });

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

// One folder = one endpoint; each slice mounts its own route, validator, and
// handler so `c.req.valid()` stays typed end to end.
for (const slice of [
  health,
  ready,
  metrics,
  models,
  recognize,
  detect,
  recognizeBatch,
  recognizeStream,
  recognizeAsync,
  taskStatus,
  taskResult,
  taskCancel,
]) {
  slice.mount(app);
}

if (config.docsEnabled) {
  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        openapi: "3.1.0",
        info: {
          title: "ppu-paddle-ocr-serve",
          version: "0.4.0",
          description: "REST API serving ppu-paddle-ocr. POST an image, get OCR JSON.",
        },
        components: {
          // Documentation-only bodies (parsed manually); named here so the
          // dual-content routes can $ref them like every other request body.
          schemas: {
            OcrMultipartRequest: multipartOcrSchema,
            DetectMultipartRequest: multipartDetectSchema,
          },
          securitySchemes: {
            Bearer: {
              type: "http",
              scheme: "bearer",
              description:
                "Send `Authorization: Bearer <SECRET_KEY>`. Required only when SECRET_KEY is set.",
            },
          },
        },
      },
      // The spec, the docs page, and the redirect are not API operations.
      exclude: ["/openapi.json", "/docs", "/"],
      // Validation failures use the error envelope declared per route, not
      // hono-openapi's own { success, error, data } shape.
      defaultValidationErrorResponse: false,
    })
  );
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "ppu-paddle-ocr-serve - API" }));
  app.get("/", (c) => c.redirect("/docs"));
} else {
  app.get("/", (c) => c.json({ name: "ppu-paddle-ocr-serve", health: "/health" }));
}

app.notFound((c) => sendError(c, 404, "Route not found"));

app.onError((err, c) => {
  if (err instanceof HttpError) return sendError(c, err.status, err.message);
  // Hono's own middleware (the body validator on malformed JSON, for one)
  // throws these with the right status; keep it instead of masking as 500.
  if (err instanceof HTTPException) return sendError(c, err.status, err.message);
  if (err instanceof QueueFullError) {
    return c.json(failure(err.message, c.get("requestId")), 429, { "Retry-After": "1" });
  }
  console.error("[unhandled]", err);
  return sendError(c, 500, "Internal server error");
});
