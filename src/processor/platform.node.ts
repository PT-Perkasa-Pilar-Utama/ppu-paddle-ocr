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
    // SAFETY: CoreCanvas is the structural subset of the canvas API this
    // package uses, and node-canvas's Canvas implements all of it. The cast is
    // nominal only; engine-parity tests exercise the result end to end.
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
    // SAFETY: slice() on a Buffer's backing store returns an ArrayBuffer; the
    // cast drops the SharedArrayBuffer arm, which fs.readFile never returns.
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
    // CanvasToolkit.saveImage joins the output path onto process.cwd()
    // unconditionally, so an absolute debugFolder lands under the working
    // directory instead. Resolve it here and write the buffer directly, which
    // also drops the toolkit's incrementing "0. " filename prefix.
    const dir = path.resolve(outputDir);
    const file = filename.endsWith(".png") ? filename : `${filename}.png`;
    await fs.mkdir(dir, { recursive: true });
    // SAFETY: this provider only ever hands out node-canvas instances from
    // createCanvas above, so a CoreCanvas here is one of them.
    await fs.writeFile(path.join(dir, file), (canvas as Canvas).toBuffer("image/png"));
  }

  public async saveImage(canvas: CoreCanvas, filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // SAFETY: as above, every canvas in this provider came from createCanvas.
    await fs.writeFile(filePath, (canvas as Canvas).toBuffer("image/png"));
  }

  public readonly canvas: CanvasOps<CoreCanvas> = {
    // SAFETY: prepareCanvas accepts any decodable source and ppu-ocv widens the
    // parameter itself; the ArrayBuffer cast satisfies its declared type. Its
    // result is a node-canvas Canvas, structurally a CoreCanvas.
    prepareCanvas: (image: unknown): Promise<CoreCanvas> =>
      CanvasProcessor.prepareCanvas(image as ArrayBuffer) as Promise<CoreCanvas>,
    // SAFETY: as above, canvases here originate from this provider.
    createProcessor: (canvas: CoreCanvas) => new CanvasProcessor(canvas as Canvas),
    getToolkit: () => CanvasToolkit.getInstance(),
  };

  public readonly imageProcessor: ImageProcessorProvider<CoreCanvas> = {
    prepareCanvas: async (image: unknown): Promise<CoreCanvas> => {
      // In ppu-ocv v3, prepareCanvas lives on CanvasProcessor
      // SAFETY: same contract as the CanvasOps.prepareCanvas above.
      return CanvasProcessor.prepareCanvas(image as ArrayBuffer) as Promise<CoreCanvas>;
    },
    // SAFETY: ImageProcessorProvider restates ppu-ocv's classes over CoreCanvas
    // so the core stays free of the concrete canvas type. The three casts below
    // re-label the same runtime values; only the canvas parameter differs, and
    // it is the structural type these classes already accept.
    ImageProcessor:
      ImageProcessor as unknown as ImageProcessorProvider<CoreCanvas>["ImageProcessor"],
    // SAFETY: same re-labelling as ImageProcessor above.
    Contours: Contours as unknown as ImageProcessorProvider<CoreCanvas>["Contours"],
    // SAFETY: same re-labelling; `cv` is the OpenCV.js namespace itself.
    cv: cv as unknown as ImageProcessorProvider<CoreCanvas>["cv"],
  };
}
