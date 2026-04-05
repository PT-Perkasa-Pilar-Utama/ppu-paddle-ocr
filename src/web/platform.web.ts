import * as ort from "onnxruntime-web";
import {
  CanvasProcessor,
  CanvasToolkit,
  Contours,
  cv,
  ImageProcessor,
} from "ppu-ocv/web";
import type { CoreCanvas, PlatformProvider } from "../core/platform.js";

// Provide an intelligent default for ONNX WASM paths to avoid 404s on CDN or unbundled usage.
// Users can override this by explicitly setting ort.env.wasm.wasmPaths before initialization.
if (typeof window !== "undefined" && !ort.env.wasm.wasmPaths) {
  ort.env.wasm.wasmPaths =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/";
}

export class WebPlatformProvider implements PlatformProvider<CoreCanvas> {
  public readonly pathSeparator = "/";
  public readonly ort = ort as any;

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
      (typeof OffscreenCanvas !== "undefined" &&
        image instanceof OffscreenCanvas) ||
      (image && typeof (image as any).getContext === "function")
    );
  }

  public async loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string,
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
    _outputDir: string,
  ): Promise<void> {
    // No-op on the web since we can't easily write to a local debug folder
    return Promise.resolve();
  }

  public readonly imageProcessor = {
    prepareCanvas: async (image: unknown): Promise<CoreCanvas> => {
      return CanvasProcessor.prepareCanvas(image) as Promise<CoreCanvas>;
    },
    ImageProcessor,
    Contours,
    cv,
    CanvasToolkit,
  };

  public readonly canvasProcessor = {
    CanvasProcessor,
  };
}
