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

/** JSON body for single-image OCR. */
export const jsonOcrSchema = ocrOptionsSchema
  .extend({
    source: z.string().min(1).openapi({
      description: "A `data:` URI or an allowlisted https URL. Local paths are rejected.",
      example: "https://images.example.com/receipt.jpg",
    }),
  })
  .openapi("OcrJsonRequest");

/** Multipart body for single-image OCR (documentation only — parsed manually). */
export const multipartOcrSchema = z
  .object({
    file: z.custom<File>().openapi({ type: "string", format: "binary" }),
    strategy,
    flatten: booleanish,
    engine,
  })
  .openapi("OcrMultipartRequest");

/** JSON body for batch / async / stream OCR. */
export const batchOcrSchema = ocrOptionsSchema
  .extend({
    sources: z.array(z.string().min(1)).min(1).openapi({ description: "data: URIs or https URLs." }),
    concurrency: z.coerce.number().int().positive().optional(),
    settle: booleanish,
  })
  .openapi("BatchRequest");
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
const metaSchema = z.object({
  engine: z.string(),
  strategy: z.string(),
  ms: z.number().optional(),
});

export const ocrResultSchema = z
  .object({
    text: z.string(),
    confidence: z.number(),
    lines: z.array(z.array(recognitionItemSchema)).optional(),
    results: z.array(recognitionItemSchema).optional(),
    meta: metaSchema,
  })
  .openapi("OcrResult");

export const batchResultSchema = z
  .object({ results: z.array(z.unknown()), meta: metaSchema })
  .openapi("BatchResult");

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

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string().optional(),
    }),
  })
  .openapi("ErrorResponse");

/** Reusable error response entry for createRoute `responses`. */
export const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
