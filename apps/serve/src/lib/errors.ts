import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error carrying an HTTP status and a stable machine code. */
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

export type ErrorBody = { error: { code: string; message: string; requestId?: string } };

/** Consistent error envelope: `{ error: { code, message, requestId } }`. */
export function errorBody(code: string, message: string, requestId?: string): ErrorBody {
  return { error: { code, message, requestId } };
}

export function sendError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string
): Response {
  return c.json(errorBody(code, message, c.get("requestId")), status);
}
