import type { RouteConfig } from "@hono/zod-openapi";
import type { Context } from "hono";
import { envelope, errorResponse, success } from "../../core/api-response.js";
import { readSingle } from "../../core/input.js";
import { runOcr } from "../../core/runner.js";
import { jsonOcrSchema, multipartOcrSchema, ocrResultSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";

// This endpoint accepts BOTH multipart and JSON. @hono/zod-openapi runs every
// declared body validator, so it can't auto-validate a dual-content body -
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
      description: "OCR result. `metadata` carries `speed` (seconds) and `confidence`.",
      content: { "application/json": { schema: envelope(ocrResultSchema) } },
    },
    400: errorResponse("Invalid input, unsupported image type, or source error."),
    413: errorResponse("Image exceeds MAX_UPLOAD_BYTES."),
    429: errorResponse("Rate limit or inference queue full."),
  },
};

export const handler = async (c: Context<Env>): Promise<Response> => {
  const { image, opts } = await readSingle(c);
  const { result, meta } = await runOcr(image, opts);
  return c.json(
    success(c, result, {
      speed: meta.ms / 1000,
      // SAFETY: runOcr returns the flattened shape for this route, which
      // always carries a confidence.
      confidence: (result as { confidence: number }).confidence,
      engine: meta.engine,
      strategy: meta.strategy,
    })
  );
};
