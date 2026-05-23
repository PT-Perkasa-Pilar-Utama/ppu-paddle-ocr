import type { RouteConfig } from "@hono/zod-openapi";
import type { Context } from "hono";
import { readSingle } from "../../lib/input.js";
import { runOcr } from "../../lib/runner.js";
import {
  errorResponse,
  jsonOcrSchema,
  multipartOcrSchema,
  ocrResultSchema,
} from "../../lib/schemas.js";
import type { Env } from "../../lib/types.js";

// This endpoint accepts BOTH multipart and JSON. @hono/zod-openapi runs every
// declared body validator, so it can't auto-validate a dual-content body —
// hence we document it via registerPath and parse the body manually.
export const route: RouteConfig = {
  method: "post",
  path: "/v1/ocr",
  tags: ["OCR"],
  summary: "Recognize a single image",
  description: "multipart/form-data with a `file` field, or JSON `{ source, ...options }`.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": { schema: multipartOcrSchema },
        "application/json": { schema: jsonOcrSchema },
      },
    },
  },
  responses: {
    200: {
      description: "OCR result.",
      content: { "application/json": { schema: ocrResultSchema } },
    },
    400: errorResponse("Invalid input or source."),
    413: errorResponse("Image exceeds MAX_UPLOAD_BYTES."),
    429: errorResponse("Rate limit or inference queue full."),
  },
};

export const handler = async (c: Context<Env>): Promise<Response> => {
  const { image, opts } = await readSingle(c);
  const { result, meta } = await runOcr(image, opts);
  return c.json({ ...(result as object), meta });
};
