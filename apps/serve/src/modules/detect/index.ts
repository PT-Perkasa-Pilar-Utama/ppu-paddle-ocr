import type { RouteConfig } from "@hono/zod-openapi";
import type { Context } from "hono";
import { envelope, errorResponse, success } from "../../core/api-response.js";
import { readSingle } from "../../core/input.js";
import { runDetect } from "../../core/runner.js";
import { detectResultSchema, jsonDetectSchema, multipartDetectSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";

// Like /v1/ocr, this endpoint accepts BOTH multipart and JSON, so it is
// documented via registerPath and parses its body manually.
export const route: RouteConfig = {
  method: "post",
  path: "/v1/detect",
  tags: ["OCR"],
  summary: "Detect text boxes in a single image (no recognition)",
  description:
    "Runs only the detection model and returns bounding boxes in original image " +
    "coordinates. multipart/form-data with a `file` field, or JSON `{ source, engine? }`.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": { schema: multipartDetectSchema },
        "application/json": { schema: jsonDetectSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Detected boxes. `metadata` carries `speed` (seconds) and `count`.",
      content: { "application/json": { schema: envelope(detectResultSchema) } },
    },
    400: errorResponse("Invalid input, unsupported image type, or source error."),
    413: errorResponse("Image exceeds MAX_UPLOAD_BYTES."),
    429: errorResponse("Rate limit or inference queue full."),
  },
};

export const handler = async (c: Context<Env>): Promise<Response> => {
  const { image, opts } = await readSingle(c);
  const { result, meta } = await runDetect(image, opts);
  return c.json(
    success(c, result, {
      speed: meta.ms / 1000,
      count: result.boxes.length,
      engine: meta.engine,
    })
  );
};
