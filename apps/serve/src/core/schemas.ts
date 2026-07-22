import { z } from "@hono/zod-openapi";

const booleanish = z.preprocess(
  (v) => (typeof v === "string" ? v === "true" || v === "1" : v),
  z.boolean().optional()
);

const strategy = z.enum(["per-box", "per-line", "cross-line"]).optional();
const engine = z.enum(["opencv", "canvas-native"]).optional();

/** Per-request recognition options shared by every input shape. */
export const ocrOptionsSchema = z.object({ strategy, flatten: booleanish, engine });
export type OcrOptions = z.infer<typeof ocrOptionsSchema>;

// A 1×1 PNG as a data: URI - a valid, runnable example so Scalar's "Send"
// works out of the box (it decodes, finds no text, returns an empty result).
const EXAMPLE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** JSON body for single-image OCR. */
export const jsonOcrSchema = ocrOptionsSchema
  .extend({
    source: z.string().min(1).openapi({
      description: "A `data:` URI or an allowlisted https URL. Local paths are rejected.",
      example: EXAMPLE_IMAGE,
    }),
  })
  .openapi("OcrJsonRequest");

/** Multipart body for single-image OCR (documentation only - parsed manually). */
export const multipartOcrSchema = z
  .object({
    file: z.custom<File>().openapi({ type: "string", format: "binary" }),
    strategy,
    flatten: booleanish,
    engine,
  })
  .openapi("OcrMultipartRequest");

/** JSON body for detection-only inference. */
export const jsonDetectSchema = z
  .object({
    engine,
    source: z.string().min(1).openapi({
      description: "A `data:` URI or an allowlisted https URL. Local paths are rejected.",
      example: EXAMPLE_IMAGE,
    }),
  })
  .openapi("DetectJsonRequest");

/** Multipart body for detection-only inference (documentation only - parsed manually). */
export const multipartDetectSchema = z
  .object({
    file: z.custom<File>().openapi({ type: "string", format: "binary" }),
    engine,
  })
  .openapi("DetectMultipartRequest");

/** JSON body for batch / async / stream OCR. */
export const batchOcrSchema = ocrOptionsSchema
  .extend({
    sources: z
      .array(z.string().min(1))
      .min(1)
      .openapi({ description: "data: URIs or https URLs." }),
    concurrency: z.coerce.number().int().positive().optional(),
    settle: booleanish,
  })
  .openapi("BatchRequest", {
    example: { sources: [EXAMPLE_IMAGE], strategy: "per-line", settle: true },
  });
export type BatchOcrBody = z.infer<typeof batchOcrSchema>;

export const taskIdParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: crypto.randomUUID() }),
});

// --- Response schemas ---

const boxSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const recognitionItemSchema = z.object({
  text: z.string(),
  confidence: z.number(),
  box: boxSchema,
});
export const ocrResultSchema = z
  .object({
    text: z.string(),
    confidence: z.number(),
    lines: z.array(z.array(recognitionItemSchema)).optional(),
    results: z.array(recognitionItemSchema).optional(),
  })
  .openapi("OcrResult");

export const detectResultSchema = z.object({ boxes: z.array(boxSchema) }).openapi("DetectResult");

export const batchResultSchema = z.object({ results: z.array(z.unknown()) }).openapi("BatchResult");

export const taskAcceptedSchema = z
  .object({ taskId: z.string(), status: z.string() })
  .openapi("TaskAccepted");

export const taskStatusSchema = z
  .object({
    id: z.string(),
    status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
    updatedAt: z.number(),
  })
  .openapi("TaskStatus");

export const modelsSchema = z
  .object({
    engines: z.array(z.string()),
    strategies: z.array(z.string()),
    default: z.object({ engine: z.string(), strategy: z.string() }),
    executionProviders: z.array(z.string()),
  })
  .openapi("Models");
