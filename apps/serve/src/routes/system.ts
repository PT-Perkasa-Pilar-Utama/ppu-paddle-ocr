import { Hono } from "hono";
import { config } from "../config.js";
import { sendError } from "../errors.js";
import { renderMetrics } from "../metrics.js";
import { isReady } from "../service.js";

export const system = new Hono();

system.get("/health", (c) => c.json({ status: "ok" }));

system.get("/ready", (c) =>
  isReady()
    ? c.json({ status: "ready" })
    : sendError(c, 503, "not_ready", "Models are still loading")
);

system.get("/v1/models", (c) =>
  c.json({
    engines: ["opencv", "canvas-native"],
    strategies: ["per-box", "per-line", "cross-line"],
    default: { engine: config.defaultEngine, strategy: config.defaultStrategy },
    executionProviders: config.executionProviders,
  })
);

system.get("/metrics", (c) =>
  c.text(renderMetrics(), 200, { "content-type": "text/plain; version=0.0.4" })
);
