import type { InferenceSession } from "onnxruntime-common";

/** Minimal shape of an ORT namespace capable of creating sessions. */
export type OrtLike = {
  InferenceSession: typeof InferenceSession;
};

/** Providers that are always guaranteed to work as a last-resort fallback. */
const ALWAYS_AVAILABLE_FALLBACKS = new Set(["cpu", "wasm"]);

/** Extract the provider name whether it's a string or a `{ name }` object. */
function providerName(
  provider: NonNullable<InferenceSession.SessionOptions["executionProviders"]>[number]
): string {
  return typeof provider === "string" ? provider : provider.name;
}

/**
 * Create an ORT session, retrying with a CPU/WASM-only provider list if the
 * original attempt fails.
 *
 * Works around cases like `executionProviders: ["cuda", "cpu"]` on a host
 * without the CUDA runtime — ORT throws during session construction instead
 * of silently falling back to CPU. We catch that, log once, and retry with
 * whichever safe provider (`cpu` or `wasm`) was in the original list (or
 * default to `cpu` / `wasm` based on the ORT binding shape).
 *
 * Throws the original error if the provider list was already safe-only.
 */
export async function createSessionWithFallback(
  ort: OrtLike,
  modelData: Uint8Array,
  sessionOpts: InferenceSession.SessionOptions | undefined,
  logger: (msg: string) => void,
  onFallback?: (newOpts: InferenceSession.SessionOptions) => void
): Promise<InferenceSession> {
  const opts = sessionOpts ?? {};
  try {
    return await ort.InferenceSession.create(modelData, opts);
  } catch (err) {
    const providers = opts.executionProviders ?? [];
    const names = providers.map(providerName);
    const alreadySafe = names.every((n) => ALWAYS_AVAILABLE_FALLBACKS.has(n));
    if (alreadySafe || names.length === 0) {
      throw err;
    }

    const fallback = names.find((n) => ALWAYS_AVAILABLE_FALLBACKS.has(n));
    const fallbackName = fallback ?? (names.includes("wasm") ? "wasm" : "cpu");

    const msg = err instanceof Error ? err.message : String(err);
    logger(
      `executionProviders=${JSON.stringify(names)} failed (${msg}); ` +
        `falling back to ["${fallbackName}"].`
    );

    const fallbackOpts: InferenceSession.SessionOptions = {
      ...opts,
      executionProviders: [fallbackName],
    };
    onFallback?.(fallbackOpts);
    return ort.InferenceSession.create(modelData, fallbackOpts);
  }
}
