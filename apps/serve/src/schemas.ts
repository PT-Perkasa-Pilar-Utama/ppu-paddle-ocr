import { z } from "zod";

// `z.coerce.boolean()` treats the string "false" as true; parse booleans from
// form/query strings explicitly instead.
const booleanish = z.preprocess(
  (v) => (typeof v === "string" ? v === "true" || v === "1" : v),
  z.boolean().optional()
);

/** Per-request recognition options, shared by JSON and multipart inputs. */
export const ocrOptionsSchema = z.object({
  strategy: z.enum(["per-box", "per-line", "cross-line"]).optional(),
  flatten: booleanish,
  engine: z.enum(["opencv", "canvas-native"]).optional(),
});
export type OcrOptions = z.infer<typeof ocrOptionsSchema>;

/** JSON body for `POST /v1/ocr`: a single `source` plus options. */
export const jsonOcrSchema = ocrOptionsSchema.extend({
  source: z.string().min(1),
});

/** JSON body for `POST /v1/ocr/batch` and `/async`: many `sources`. */
export const batchOcrSchema = ocrOptionsSchema.extend({
  sources: z.array(z.string().min(1)).min(1),
  concurrency: z.coerce.number().int().positive().optional(),
  settle: booleanish,
});
export type BatchOcrBody = z.infer<typeof batchOcrSchema>;
