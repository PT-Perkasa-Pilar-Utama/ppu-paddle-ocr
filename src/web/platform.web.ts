// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import * as ort from "onnxruntime-web";
import { CanvasProcessor, CanvasToolkit, getPlatform } from "ppu-ocv/canvas-web";
import type {
  CanvasProcessor as CanvasProcessorType,
  CanvasToolkit as CanvasToolkitType,
} from "ppu-ocv/canvas";
import type { CanvasOps, CoreCanvas, PlatformProvider } from "../core/platform.js";

/**
 * CDN copy of the ONNX Runtime WASM binaries, used when the host app picks no
 * location.
 *
 * The version comes from the runtime that is actually loaded rather than a pin,
 * so the binaries always match the JS glue that fetches them. A pin goes stale
 * on the next `onnxruntime-web` bump and then hands a 1.27 loader 1.26 binaries,
 * which fails at session-build time.
 */
function defaultWasmPaths(): string {
  const version = ort.env.versions.web ?? ort.env.versions.common;
  return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
}

/**
 * 2D context options. `CanvasLike.getContext` is declared with one parameter in
 * `ppu-ocv`, so the attribute bag needs its own signature.
 */
type GetContext2D = (contextId: "2d", options?: { willReadFrequently?: boolean }) => unknown;

/**
 * True inside a Web Worker: dedicated, shared, or a Manifest V3 service worker.
 *
 * `WorkerGlobalScope` exists only in worker scopes, never on a page and never in
 * Node/Bun/Deno. `window` is the mirror image of it: absent in workers, which is
 * why probing for `window` alone reads a worker as a server runtime.
 */
export function isWebWorker(): boolean {
  // SAFETY: probing globalThis for a global that may not exist; the annotation
  // only says the property is optional, which is exactly what is being tested.
  return typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function";
}

/**
 * Point ONNX Runtime at a CDN copy of its WASM binaries to avoid 404s on CDN or
 * unbundled usage. Applies to pages and workers alike; an explicit
 * `ort.env.wasm.wasmPaths` set by the host app always wins.
 *
 * Runs once on import. Exported so the environment probe stays testable.
 */
export function applyDefaultWasmPaths(): void {
  const inBrowser = typeof window !== "undefined" || isWebWorker();
  if (!inBrowser || ort.env.wasm.wasmPaths) return;
  ort.env.wasm.wasmPaths = defaultWasmPaths();
}

applyDefaultWasmPaths();

/** True when `navigator.gpu` is present and at least one adapter is available. */
export async function isWebGpuAvailable(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  // SAFETY: `gpu` is absent from the DOM lib in some TS targets; the
  // intersection declares it optional and the next line tests for it.
  const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown | null> } };
  if (!nav.gpu || typeof nav.gpu.requestAdapter !== "function") return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

/** Returns `["webgpu", "wasm"]` when WebGPU is available, otherwise `["wasm"]`. */
export async function getDefaultWebExecutionProviders(): Promise<
  ort.InferenceSession.SessionOptions["executionProviders"]
> {
  if (await isWebGpuAvailable()) {
    return ["webgpu", "wasm"];
  }
  return ["wasm"];
}

export class WebPlatformProvider implements PlatformProvider<CoreCanvas> {
  public readonly pathSeparator = "/";
  // SAFETY: onnxruntime-web ships its own copy of the ORT types;
  // PlatformProvider["ort"] is the onnxruntime-common shape the core codes
  // against, and both describe the same runtime API.
  public readonly ort = ort as unknown as PlatformProvider["ort"];

  public createCanvas(width: number, height: number): CoreCanvas {
    // Delegate to ppu-ocv's browser platform: it returns an OffscreenCanvas
    // wherever the runtime has one and only falls back to document.createElement
    // otherwise, so this works on a page and inside a Web Worker, which has no
    // document at all.
    const canvas = getPlatform().createCanvas(width, height);

    // Warm the 2D context. getContext fixes its attributes on the first call and
    // ignores them on every call after, and this pipeline is getImageData-heavy.
    const getContext: GetContext2D = canvas.getContext.bind(canvas);
    getContext("2d", { willReadFrequently: true });

    // SAFETY: CoreCanvas is the structural subset this package uses, and both
    // HTMLCanvasElement and OffscreenCanvas implement it.
    return canvas as unknown as CoreCanvas;
  }

  public isCanvas(image: unknown): image is CoreCanvas {
    // Duck-typed on purpose. HTMLCanvasElement is not exposed inside a Web
    // Worker, so an instanceof probe throws a ReferenceError there instead of
    // returning false. Every canvas this build accepts - HTMLCanvasElement,
    // OffscreenCanvas, or a host-supplied equivalent - exposes getContext.
    // SAFETY: this is the probe itself - the value is unknown by definition and
    // the cast only makes the property read expressible.
    return !!image && typeof (image as Record<string, unknown>).getContext === "function";
  }

  public async loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string
  ): Promise<ArrayBuffer> {
    if (source instanceof ArrayBuffer) {
      return source;
    }

    const sourceToLoad = typeof source === "string" ? source : defaultUrl;

    // In browser, all string sources are treated as URLs
    const response = await fetch(sourceToLoad);
    if (!response.ok) {
      throw new Error(`Failed to fetch resource from ${sourceToLoad}`);
    }
    return response.arrayBuffer();
  }

  public async saveDebugImage(
    _canvas: CoreCanvas,
    _filename: string,
    _outputDir: string
  ): Promise<void> {
    // No-op on the web since we can't easily write to a local debug folder
    return Promise.resolve();
  }

  public readonly canvas: CanvasOps<CoreCanvas> = {
    // SAFETY: prepareCanvas decodes any supported source; the ArrayBuffer cast
    // satisfies ppu-ocv's declared parameter, and its canvas is a structural
    // CoreCanvas.
    prepareCanvas: (image: unknown): Promise<CoreCanvas> =>
      CanvasProcessor.prepareCanvas(image as ArrayBuffer) as unknown as Promise<CoreCanvas>,
    // SAFETY: canvases here came from createCanvas above, so they are the
    // browser type CanvasProcessor expects; the return is re-labelled to the
    // core's structural view of the same object.
    createProcessor: (canvas: CoreCanvas): CanvasProcessorType =>
      new CanvasProcessor(canvas as never) as unknown as CanvasProcessorType,
    // SAFETY: the toolkit singleton is ppu-ocv's, re-labelled to the core's view.
    getToolkit: (): CanvasToolkitType =>
      CanvasToolkit.getInstance() as unknown as CanvasToolkitType,
  };
}
