import { app } from "./app.js";
import { config } from "./config.js";
import { initService, shutdownService } from "./service.js";

console.log(`[serve] warming models (providers=${config.executionProviders.join(",")})…`);
await initService();
console.log(
  `[serve] ready — concurrency=${config.concurrency}, default engine=${config.defaultEngine}`
);

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  // Generous request timeout; per-inference backpressure is the real bound.
  idleTimeout: Math.min(255, Math.ceil(config.requestTimeoutMs / 1000)),
  fetch: app.fetch,
});

console.log(`[serve] listening on http://${config.host}:${config.port} (docs at /docs)`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[serve] ${signal} received — draining…`);
  // Stop accepting new connections, let in-flight requests finish, free models.
  await server.stop(false);
  await shutdownService();
  console.log("[serve] shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
