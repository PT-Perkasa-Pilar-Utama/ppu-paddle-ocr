import { PaddleOcrService } from "ppu-paddle-ocr";
import type { ProcessingEngine } from "ppu-paddle-ocr";
import { config } from "./config.js";
import { InferenceQueue } from "./queue.js";

/** Shared inference gate across every engine/service (one device, one budget). */
export const queue = new InferenceQueue(config.concurrency, config.maxQueueDepth);

// Up to two warmed services (one per engine), created lazily. The default
// engine is warmed at boot; the other is built on first request that asks for
// it. Both share the inference queue.
const services = new Map<ProcessingEngine, PaddleOcrService>();
let ready = false;

function build(engine: ProcessingEngine): PaddleOcrService {
  return new PaddleOcrService({
    session: { executionProviders: config.executionProviders },
    processing: { engine },
    recognition: {
      charactersDictionary: [],
      strategy: config.defaultStrategy,
      ...(config.minConfidence !== undefined ? { minimumConfidence: config.minConfidence } : {}),
      ...(config.maxCropSourceSideLength !== undefined
        ? { maxCropSourceSideLength: config.maxCropSourceSideLength }
        : {}),
    },
    ...(config.maxSideLength !== undefined
      ? { detection: { maxSideLength: config.maxSideLength } }
      : {}),
    ...(config.model ? { model: config.model } : {}),
  });
}

/** Warm the default-engine service. Call once at boot before serving. */
export async function initService(): Promise<void> {
  const svc = build(config.defaultEngine);
  await svc.initialize();
  services.set(config.defaultEngine, svc);
  ready = true;
}

/** Get (or lazily warm) the service for an engine. */
export async function getService(
  engine: ProcessingEngine = config.defaultEngine
): Promise<PaddleOcrService> {
  const existing = services.get(engine);
  if (existing) return existing;
  const svc = build(engine);
  await svc.initialize();
  services.set(engine, svc);
  return svc;
}

/** Readiness: true once the default engine is warmed. */
export function isReady(): boolean {
  return ready;
}

/** Release every warmed service. Call on shutdown. */
export async function shutdownService(): Promise<void> {
  ready = false;
  for (const svc of services.values()) await svc.destroy();
  services.clear();
}
