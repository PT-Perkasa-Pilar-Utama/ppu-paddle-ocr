import { z } from "zod";

/** Raw environment schema. All knobs are documented in the README. */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),

  EXECUTION_PROVIDERS: z.string().default("cpu"),
  DEFAULT_STRATEGY: z.enum(["per-box", "per-line", "cross-line"]).default("per-line"),
  DEFAULT_ENGINE: z.enum(["opencv", "canvas-native"]).default("opencv"),

  MODEL_DETECTION: z.string().optional(),
  MODEL_RECOGNITION: z.string().optional(),
  MODEL_DICT: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  MAX_BATCH_IMAGES: z.coerce.number().int().positive().default(32),

  MAX_CONCURRENCY: z.coerce.number().int().nonnegative().default(0),
  MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(100),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  TASK_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60_000),

  API_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default("*"),
  SOURCE_URL_ALLOWLIST: z.string().default(""),
});

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

function build(env: NodeJS.ProcessEnv) {
  const e = EnvSchema.parse(env);
  const executionProviders = splitList(e.EXECUTION_PROVIDERS);
  const usesAccelerator = executionProviders.some((p) => p !== "cpu" && p !== "wasm");
  // 0 = auto: serialize on an accelerator (a shared session serializes device
  // work anyway and parallel runs stack VRAM), a small pool on CPU.
  const autoConcurrency = usesAccelerator ? 1 : 4;

  const model =
    e.MODEL_DETECTION || e.MODEL_RECOGNITION || e.MODEL_DICT
      ? {
          detection: e.MODEL_DETECTION,
          recognition: e.MODEL_RECOGNITION,
          charactersDictionary: e.MODEL_DICT,
        }
      : undefined;

  return {
    port: e.PORT,
    host: e.HOST,
    executionProviders,
    usesAccelerator,
    defaultStrategy: e.DEFAULT_STRATEGY,
    defaultEngine: e.DEFAULT_ENGINE,
    model,
    maxUploadBytes: e.MAX_UPLOAD_BYTES,
    maxImagePixels: e.MAX_IMAGE_PIXELS,
    maxBatchImages: e.MAX_BATCH_IMAGES,
    concurrency: e.MAX_CONCURRENCY > 0 ? e.MAX_CONCURRENCY : autoConcurrency,
    maxQueueDepth: e.MAX_QUEUE_DEPTH,
    requestTimeoutMs: e.REQUEST_TIMEOUT_MS,
    taskTtlMs: e.TASK_TTL_MS,
    apiKey: e.API_KEY,
    corsOrigins: e.CORS_ORIGINS === "*" ? "*" : splitList(e.CORS_ORIGINS),
    sourceUrlAllowlist: splitList(e.SOURCE_URL_ALLOWLIST),
  };
}

export type Config = ReturnType<typeof build>;

export const config: Config = build(process.env);
