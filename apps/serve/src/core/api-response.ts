import type { Context } from "hono";
import { resolver } from "hono-openapi";
import type { DescribeRouteOptions } from "hono-openapi";
import * as v from "valibot";
import type { Env } from "./types.js";

/** API version surfaced in every response envelope. */
export const API_VERSION = "0.4.0";

/** Success envelope shape: `{ status, version, metadata: { id, ... }, data }`. */
export type SuccessEnvelope<T> = {
  status: "success";
  version: string;
  metadata: { id: string } & Record<string, unknown>;
  data: T;
};

/** Error envelope shape: `{ status, version, data: { message, requestId } }`. */
export type ErrorEnvelope = {
  status: "error";
  version: string;
  data: { message: string; requestId?: string };
};

/** One entry of a route's `responses` map. */
type ResponseEntry = NonNullable<DescribeRouteOptions["responses"]>[string];

/** oksara-style success envelope: `{ status, version, metadata: { id, ... }, data }`. */
export function success<T>(
  c: Context<Env>,
  data: T,
  metadata: Record<string, unknown> = {}
): SuccessEnvelope<T> {
  return {
    status: "success",
    version: API_VERSION,
    metadata: { id: c.get("requestId"), ...metadata },
    data,
  };
}

/** oksara-style error envelope: `{ status, version, data: { message, requestId } }`. */
export function failure(message: string, requestId?: string): ErrorEnvelope {
  return {
    status: "error",
    version: API_VERSION,
    data: { message, requestId },
  };
}

/** Wrap a data schema in the success envelope. */
export function envelope<T extends v.GenericSchema>(data: T): v.GenericSchema {
  return v.object({
    status: v.literal("success"),
    version: v.string(),
    metadata: v.looseObject({ id: v.string() }),
    data,
  });
}

/** Error envelope schema for OpenAPI responses. */
export const errorEnvelopeSchema = v.pipe(
  v.object({
    status: v.literal("error"),
    version: v.string(),
    data: v.object({ message: v.string(), requestId: v.optional(v.string()) }),
  }),
  v.metadata({ ref: "ErrorResponse" })
);

/** A JSON success response entry carrying `data` inside the envelope. */
export const jsonResponse = (description: string, data: v.GenericSchema): ResponseEntry => ({
  description,
  content: { "application/json": { schema: resolver(envelope(data)) } },
});

/** Reusable error response entry for a route's `responses`. */
export const errorResponse = (description: string): ResponseEntry => ({
  description,
  content: { "application/json": { schema: resolver(errorEnvelopeSchema) } },
});
