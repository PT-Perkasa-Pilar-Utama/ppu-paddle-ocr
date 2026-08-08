import { z } from "zod";

const toArray = (val: string | undefined): string[] =>
  (val ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const toBoolean = (val: string | undefined): boolean =>
  val ? ["true", "1", "yes", "on"].includes(val.toLowerCase()) : false;

/** Raw environment schema. Every knob is documented in `.env.example`. */
const EnvSchema = z.object({
  API_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),

  // Security
  SECRET_KEY: z.string().optional(),
  IP_WHITE_LIST: z.string().default("*"),
  IP_DENY_LIST: z.string().default(""),
  CORS_ORIGINS: z.string().default("*"),
  DOCS_ENABLED: z.string().default("true"),

  // Rate limiting (fixed window, per client IP)
  RATE_LIMIT_ENABLED: z.string().default("true"),
  RATE_LIMIT_PER_WINDOW: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  // Request limits
  REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  MAX_BATCH_IMAGES: z.coerce.number().int().positive().default(32),

  // OCR engine / models
  EXECUTION_PROVIDERS: z.string().default("cpu"),
  DEFAULT_STRATEGY: z.enum(["per-box", "per-line", "cross-line"]).default("per-line"),
  DEFAULT_ENGINE: z.enum(["opencv", "canvas-native"]).default("opencv"),
  MIN_CONFIDENCE: z.coerce.number().min(0).max(1).optional(),
  MAX_SIDE_LENGTH: z.union([z.literal("auto"), z.coerce.number().int().positive()]).optional(),
  MAX_CROP_SOURCE_SIDE_LENGTH: z.coerce.number().int().positive().optional(),
  MODEL_DETECTION: z.string().optional(),
  MODEL_RECOGNITION: z.string().optional(),
  MODEL_DICT: z.string().optional(),

  // Inference backpressure / async tasks
  MAX_CONCURRENCY: z.coerce.number().int().nonnegative().default(0),
  MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(100),
  TASK_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  // Source fetching (SSRF allowlist of https hosts)
  SOURCE_URL_ALLOWLIST: z.string().default(""),
});

function build(raw: NodeJS.ProcessEnv) {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
    );
    process.exit(1);
  }
  const e = parsed.data;

  const executionProviders = toArray(e.EXECUTION_PROVIDERS);
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
    apiEnv: e.API_ENV,
    port: e.PORT,
    host: e.HOST,

    secretKey: e.SECRET_KEY,
    ipWhiteList: toArray(e.IP_WHITE_LIST),
    ipDenyList: toArray(e.IP_DENY_LIST),
    corsOrigins: e.CORS_ORIGINS === "*" ? "*" : toArray(e.CORS_ORIGINS),
    docsEnabled: toBoolean(e.DOCS_ENABLED),

    rateLimitEnabled: toBoolean(e.RATE_LIMIT_ENABLED),
    rateLimitMax: e.RATE_LIMIT_PER_WINDOW,
    rateLimitWindowMs: e.RATE_LIMIT_WINDOW_SECONDS * 1000,

    requestTimeoutMs: e.REQUEST_TIMEOUT_SECONDS * 1000,
    maxUploadBytes: e.MAX_UPLOAD_BYTES,
    maxImagePixels: e.MAX_IMAGE_PIXELS,
    maxBatchImages: e.MAX_BATCH_IMAGES,

    executionProviders,
    usesAccelerator,
    defaultStrategy: e.DEFAULT_STRATEGY,
    defaultEngine: e.DEFAULT_ENGINE,
    minConfidence: e.MIN_CONFIDENCE,
    maxSideLength: e.MAX_SIDE_LENGTH,
    maxCropSourceSideLength: e.MAX_CROP_SOURCE_SIDE_LENGTH,
    model,

    concurrency: e.MAX_CONCURRENCY > 0 ? e.MAX_CONCURRENCY : autoConcurrency,
    maxQueueDepth: e.MAX_QUEUE_DEPTH,
    taskTtlMs: e.TASK_TTL_SECONDS * 1000,

    sourceUrlAllowlist: toArray(e.SOURCE_URL_ALLOWLIST),
  };
}

export type Config = ReturnType<typeof build>;

export const config: Config = build(process.env);
