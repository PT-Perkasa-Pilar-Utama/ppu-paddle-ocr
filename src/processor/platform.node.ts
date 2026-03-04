import * as fs from "fs/promises";
import * as ort from "onnxruntime-node";
import * as path from "path";
import { Canvas, CanvasToolkit, Contours, cv, ImageProcessor } from "ppu-ocv";
import type { CoreCanvas, PlatformProvider } from "../core/platform.js";

export class NodePlatformProvider implements PlatformProvider<CoreCanvas> {
  public readonly pathSeparator: string = path.sep;
  public readonly ort: typeof ort = ort;

  public createCanvas(width: number, height: number): CoreCanvas {
    return new Canvas(width, height) as unknown as CoreCanvas;
  }

  public isCanvas(image: unknown): image is CoreCanvas {
    return image instanceof Canvas;
  }

  public async loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string,
  ): Promise<ArrayBuffer> {
    if (source instanceof ArrayBuffer) {
      return source;
    }

    const sourceToLoad = typeof source === "string" ? source : defaultUrl;

    if (sourceToLoad.startsWith("http")) {
      const response = await fetch(sourceToLoad);
      if (!response.ok) {
        throw new Error(`Failed to fetch resource from ${sourceToLoad}`);
      }
      return response.arrayBuffer();
    }

    const buffer = await fs.readFile(sourceToLoad);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
  }

  public async saveDebugImage(
    canvas: CoreCanvas,
    filename: string,
    outputDir: string,
  ): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    await CanvasToolkit.getInstance().saveImage({
      canvas: canvas as Canvas,
      filename,
      path: outputDir,
    });
  }

  public readonly imageProcessor = {
    prepareCanvas: async (image: unknown): Promise<CoreCanvas> => {
      // In Node, we can prepare canvas from ArrayBuffer or local Buffer
      return ImageProcessor.prepareCanvas(image as any);
    },
    ImageProcessor: ImageProcessor as any,
    Contours: Contours as any,
    cv: cv as any,
    CanvasToolkit: CanvasToolkit as any,
  };
}
