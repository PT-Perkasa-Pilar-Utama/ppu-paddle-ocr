import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { config } from "./config.js";
import { tooManyRequests } from "./errors.js";

function clientIp(c: Parameters<Parameters<typeof createMiddleware>[0]>[0]): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    // No connection info under app.request() (tests); fall back gracefully.
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Fixed-window, in-memory rate limiter keyed by client IP. Per-instance - for
 * multi-replica deployments put a shared limiter (Redis) in front.
 */
export function rateLimiter(): MiddlewareHandler {
  const windowMs = config.rateLimitWindowMs;
  const max = config.rateLimitMax;
  const hits = new Map<string, { count: number; reset: number }>();

  return createMiddleware(async (c, next) => {
    const key = clientIp(c);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));

    if (entry.count > max) {
      c.header("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      throw tooManyRequests("Rate limit exceeded");
    }
    await next();
  });
}
