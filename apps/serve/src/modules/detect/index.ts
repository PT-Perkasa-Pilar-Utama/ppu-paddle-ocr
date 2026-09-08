import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { errorResponse, jsonResponse, success } from "../../core/api-response.js";
import { readSingle } from "../../core/input.js";
import { runDetect } from "../../core/runner.js";
import { detectResultSchema, jsonDetectSchema } from "../../core/schemas.js";
import type { Env } from "../../core/types.js";

// Like /v1/ocr, this endpoint accepts BOTH multipart and JSON, so it is
// documented here and parses its body manually.
export function mount(app: Hono<Env>): void {
  app.post(
    "/v1/detect",
    describeRoute({
      tags: ["OCR"],
      summary: "Detect text boxes in a single image (no recognition)",
      description:
        "Runs only the detection model and returns bounding boxes in original image " +
        "coordinates. multipart/form-data with a `file` field, or JSON `{ source, engine? }`.",
      security: [{ Bearer: [] }],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: { $ref: "#/components/schemas/DetectMultipartRequest" },
          },
          "application/json": { schema: resolver(jsonDetectSchema) },
        },
      },
      responses: {
        200: jsonResponse(
          "Detected boxes. `metadata` carries `speed` (seconds) and `count`.",
          detectResultSchema
        ),
        400: errorResponse("Invalid input, unsupported image type, or source error."),
        413: errorResponse("Image exceeds MAX_UPLOAD_BYTES."),
        429: errorResponse("Rate limit or inference queue full."),
      },
    }),
    async (c) => {
      const { image, opts } = await readSingle(c);
      const { result, meta } = await runDetect(image, opts);
      return c.json(
        success(c, result, {
          speed: meta.ms / 1000,
          count: result.boxes.length,
          engine: meta.engine,
        })
      );
    }
  );
}
