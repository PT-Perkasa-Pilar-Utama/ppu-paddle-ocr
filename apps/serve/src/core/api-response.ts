import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Env } from "./types.js";

/** API version surfaced in every response envelope. */
export const API_VERSION = "0.2.1";

/** oksara-style success envelope: `{ status, version, metadata: { id, … }, data }`. */
export function success<T>(
  c: Context<Env>,
  data: T,
  metadata: Record<string, unknown> = {}
): {
  status: "success";
  version: string;
  metadata: { id: string } & Record<string, unknown>;
  data: T;
} {
  return {
    status: "success",
    version: API_VERSION,
    metadata: { id: c.get("requestId"), ...metadata },
    data,
  };
}

/** oksara-style error envelope: `{ status, version, data: { message, requestId } }`. */
export function failure(
  message: string,
  requestId?: string
): { status: "error"; version: string; data: { message: string; requestId?: string } } {
  return {
    status: "error",
    version: API_VERSION,
    data: { message, requestId },
  };
}

/** Wrap a data schema in the success envelope for OpenAPI responses. */
export function envelope<T extends z.ZodTypeAny>(data: T): z.ZodTypeAny {
  return z.object({
    status: z.literal("success"),
    version: z.string(),
    metadata: z.object({ id: z.string() }).passthrough(),
    data,
  });
}

/** Error envelope schema for OpenAPI responses. */
export const errorEnvelopeSchema = z
  .object({
    status: z.literal("error"),
    version: z.string(),
    data: z.object({ message: z.string(), requestId: z.string().optional() }),
  })
  .openapi("ErrorResponse");

/** Reusable error response entry for createRoute `responses`. */
export const errorResponse = (
  description: string
): {
  description: string;
  content: { "application/json": { schema: typeof errorEnvelopeSchema } };
} => ({
  description,
  content: { "application/json": { schema: errorEnvelopeSchema } },
});
