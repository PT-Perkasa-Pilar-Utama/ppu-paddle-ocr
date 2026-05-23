import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { failure } from "./api-response.js";

/** An error carrying an HTTP status and a stable machine code (internal use). */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string): HttpError =>
  new HttpError(400, "bad_request", message);
export const payloadTooLarge = (message: string): HttpError =>
  new HttpError(413, "payload_too_large", message);
export const tooManyRequests = (message: string): HttpError =>
  new HttpError(429, "too_many_requests", message);
export const serviceUnavailable = (message: string): HttpError =>
  new HttpError(503, "service_unavailable", message);

/** Send the oksara-style error envelope (`{ status, version, data }`) with the request id. */
export function sendError(c: Context, status: ContentfulStatusCode, message: string): Response {
  return c.json(failure(message, c.get("requestId")), status);
}
