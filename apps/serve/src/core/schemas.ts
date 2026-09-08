import * as v from "valibot";

const strategy = v.optional(v.picklist(["per-box", "per-line", "cross-line"]));
const engine = v.optional(v.picklist(["opencv", "canvas-native"]));
const unitInterval = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));

/** Per-request recognition options shared by every input shape. */
export const ocrOptionsSchema = v.object({
  strategy,
  flatten: v.optional(v.boolean()),
  engine,
  minimumConfidence: v.optional(unitInterval),
});
export type OcrOptions = v.InferOutput<typeof ocrOptionsSchema>;

// Multipart fields arrive as strings; coerce them to the JSON option types.
const formBoolean = v.optional(
  v.pipe(
    v.string(),
    v.transform((s) => s === "true" || s === "1")
  )
);
const formNumber = v.pipe(v.string(), v.transform(Number), v.number());

/** The same options read from multipart form fields. */
export const multipartOcrOptionsSchema = v.object({
  strategy,
  flatten: formBoolean,
  engine,
  minimumConfidence: v.optional(v.pipe(formNumber, unitInterval)),
});

// A 1x1 PNG as a data: URI - a valid, runnable example so Scalar's "Send"
// works out of the box (it decodes, finds no text, returns an empty result).
const EXAMPLE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const source = v.pipe(
  v.string(),
  v.minLength(1),
  v.description("A `data:` URI or an allowlisted https URL. Local paths are rejected."),
  v.metadata({ example: EXAMPLE_IMAGE })
);

/** JSON body for single-image OCR. */
export const jsonOcrSchema = v.pipe(
  v.object({ ...ocrOptionsSchema.entries, source }),
  v.metadata({ ref: "OcrJsonRequest" })
);

/** JSON body for detection-only inference. */
export const jsonDetectSchema = v.pipe(
  v.object({ engine, source }),
  v.metadata({ ref: "DetectJsonRequest" })
);

/** JSON body for batch / async / stream OCR. */
export const batchOcrSchema = v.pipe(
  v.object({
    ...ocrOptionsSchema.entries,
    sources: v.pipe(
      v.array(v.pipe(v.string(), v.minLength(1))),
      v.minLength(1),
      v.description("data: URIs or https URLs.")
    ),
    concurrency: v.optional(positiveInt),
    settle: v.optional(v.boolean()),
  }),
  v.metadata({
    ref: "BatchRequest",
    example: { sources: [EXAMPLE_IMAGE], strategy: "per-line", settle: true },
  })
);
export type BatchOcrBody = v.InferOutput<typeof batchOcrSchema>;

export const taskIdParamsSchema = v.object({
  id: v.pipe(v.string(), v.metadata({ example: crypto.randomUUID() })),
});

// --- Multipart bodies (documentation only - parsed manually) ---
// Plain OpenAPI objects: the file field has no schema-library shape, and these
// bodies never pass through a validator.

const stringEnum = (values: readonly string[]) => ({ type: "string" as const, enum: [...values] });
const multipartOptions = {
  strategy: stringEnum(["per-box", "per-line", "cross-line"]),
  flatten: { type: "boolean" as const },
  engine: stringEnum(["opencv", "canvas-native"]),
  minimumConfidence: { type: "number" as const, minimum: 0, maximum: 1 },
};
const binaryFile = { type: "string" as const, format: "binary" };

/** Multipart body for single-image OCR. */
export const multipartOcrSchema = {
  type: "object" as const,
  properties: { file: binaryFile, ...multipartOptions },
  required: ["file"],
};

/** Multipart body for detection-only inference. */
export const multipartDetectSchema = {
  type: "object" as const,
  properties: { file: binaryFile, engine: multipartOptions.engine },
  required: ["file"],
};

// --- Response schemas ---

const boxSchema = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});
const recognitionItemSchema = v.object({
  text: v.string(),
  confidence: v.number(),
  box: boxSchema,
});
export const ocrResultSchema = v.pipe(
  v.object({
    text: v.string(),
    confidence: v.number(),
    lines: v.optional(v.array(v.array(recognitionItemSchema))),
    results: v.optional(v.array(recognitionItemSchema)),
  }),
  v.metadata({ ref: "OcrResult" })
);

export const detectResultSchema = v.pipe(
  v.object({ boxes: v.array(boxSchema) }),
  v.metadata({ ref: "DetectResult" })
);

export const batchResultSchema = v.pipe(
  v.object({ results: v.array(v.unknown()) }),
  v.metadata({ ref: "BatchResult" })
);

export const taskAcceptedSchema = v.pipe(
  v.object({ taskId: v.string(), status: v.string() }),
  v.metadata({ ref: "TaskAccepted" })
);

export const taskStatusSchema = v.pipe(
  v.object({
    id: v.string(),
    status: v.picklist(["queued", "running", "done", "failed", "cancelled"]),
    updatedAt: v.number(),
  }),
  v.metadata({ ref: "TaskStatus" })
);

export const modelsSchema = v.pipe(
  v.object({
    engines: v.array(v.string()),
    strategies: v.array(v.string()),
    default: v.object({ engine: v.string(), strategy: v.string() }),
    executionProviders: v.array(v.string()),
  }),
  v.metadata({ ref: "Models" })
);
