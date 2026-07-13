// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import * as fs from "fs/promises";
import * as ort from "onnxruntime-node";
import * as path from "path";
import { Canvas, Contours, ImageProcessor, cv } from "ppu-ocv";
import { CanvasProcessor, CanvasToolkit } from "ppu-ocv/canvas";
import type {
  CanvasOps,
  CoreCanvas,
  ImageProcessorProvider,
  PlatformProvider,
} from "../core/platform.js";

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
    defaultUrl: string
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
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
  }

  public async saveDebugImage(
    canvas: CoreCanvas,
    filename: string,
    outputDir: string
  ): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    await CanvasToolkit.getInstance().saveImage({
      canvas: canvas as Canvas,
      filename,
      path: outputDir,
    });
  }

  public async saveImage(canvas: CoreCanvas, filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, (canvas as Canvas).toBuffer("image/png"));
  }

  public readonly canvas: CanvasOps<CoreCanvas> = {
    prepareCanvas: (image: unknown): Promise<CoreCanvas> =>
      CanvasProcessor.prepareCanvas(image as ArrayBuffer) as Promise<CoreCanvas>,
    createProcessor: (canvas: CoreCanvas) => new CanvasProcessor(canvas as Canvas),
    getToolkit: () => CanvasToolkit.getInstance(),
  };

  public readonly imageProcessor: ImageProcessorProvider<CoreCanvas> = {
    prepareCanvas: async (image: unknown): Promise<CoreCanvas> => {
      // In ppu-ocv v3, prepareCanvas lives on CanvasProcessor
      return CanvasProcessor.prepareCanvas(image as ArrayBuffer) as Promise<CoreCanvas>;
    },
    ImageProcessor:
      ImageProcessor as unknown as ImageProcessorProvider<CoreCanvas>["ImageProcessor"],
    Contours: Contours as unknown as ImageProcessorProvider<CoreCanvas>["Contours"],
    cv: cv as unknown as ImageProcessorProvider<CoreCanvas>["cv"],
  };
}
