import * as ort from "onnxruntime-web";
import { CanvasProcessor, CanvasToolkit } from "ppu-ocv/canvas-web";
import type {
  CanvasProcessor as CanvasProcessorType,
  CanvasToolkit as CanvasToolkitType,
} from "ppu-ocv/canvas";
import type { CanvasOps, CoreCanvas, PlatformProvider } from "../core/platform.js";

// Provide an intelligent default for ONNX WASM paths to avoid 404s on CDN or unbundled usage.
// Users can override this by explicitly setting ort.env.wasm.wasmPaths before initialization.
if (typeof window !== "undefined" && !ort.env.wasm.wasmPaths) {
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/";
}

/** True when `navigator.gpu` is present and at least one adapter is available. */
export async function isWebGpuAvailable(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
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
  public readonly ort = ort as unknown as PlatformProvider["ort"];

  public createCanvas(_width: number, _height: number): CoreCanvas {
    // CanvasToolkit in the web handles creating actual HTMLCanvasElement or OffscreenCanvas internally
    // We just return a dummy canvas structure expected by ppu-ocv/web
    const canvas = document.createElement("canvas");
    canvas.width = _width;
    canvas.height = _height;
    canvas.getContext("2d", { willReadFrequently: true });
    return canvas as unknown as CoreCanvas;
  }

  public isCanvas(image: unknown): image is CoreCanvas {
    return !!(
      image instanceof HTMLCanvasElement ||
      (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas) ||
      (image && typeof (image as Record<string, unknown>).getContext === "function")
    );
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
    prepareCanvas: (image: unknown): Promise<CoreCanvas> =>
      CanvasProcessor.prepareCanvas(image as ArrayBuffer) as unknown as Promise<CoreCanvas>,
    createProcessor: (canvas: CoreCanvas): CanvasProcessorType =>
      new CanvasProcessor(canvas as never) as unknown as CanvasProcessorType,
    getToolkit: (): CanvasToolkitType =>
      CanvasToolkit.getInstance() as unknown as CanvasToolkitType,
  };
}
