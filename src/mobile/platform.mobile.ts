// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import * as ort from "onnxruntime-react-native";
import { CanvasProcessor, CanvasToolkit, getPlatform } from "ppu-ocv/canvas-mobile";
import type {
  CanvasProcessor as CanvasProcessorType,
  CanvasToolkit as CanvasToolkitType,
} from "ppu-ocv/canvas";
import type { CanvasOps, CoreCanvas, PlatformProvider } from "../core/platform.js";

// Importing `ppu-ocv/canvas-mobile` registers the Skia-backed canvas platform
// as a side effect. Skia itself is lazy-required by ppu-ocv only when a canvas
// is actually created, so this import is safe in bundlers for other entries.

/**
 * Default execution providers for React Native.
 *
 * `onnxruntime-react-native` runs on CPU by default; NNAPI (Android) and CoreML
 * (iOS) can be opted into via `session.executionProviders`. WebGPU is not
 * available on React Native.
 */
export function getDefaultMobileExecutionProviders(): ort.InferenceSession.SessionOptions["executionProviders"] {
  return ["cpu"];
}

export class MobilePlatformProvider implements PlatformProvider<CoreCanvas> {
  public readonly pathSeparator = "/";
  public readonly ort = ort as unknown as PlatformProvider["ort"];

  public createCanvas(width: number, height: number): CoreCanvas {
    // The Skia platform (registered by importing ppu-ocv/canvas-mobile) builds
    // the actual SkSurface-backed canvas; we just forward the dimensions.
    return getPlatform().createCanvas(width, height) as unknown as CoreCanvas;
  }

  public isCanvas(image: unknown): image is CoreCanvas {
    return getPlatform().isCanvas(image);
  }

  public async loadResource(
    source: string | ArrayBuffer | undefined,
    defaultUrl: string
  ): Promise<ArrayBuffer> {
    if (source instanceof ArrayBuffer) {
      return source;
    }

    const sourceToLoad = typeof source === "string" ? source : defaultUrl;

    // React Native provides a global fetch; all string sources are URLs.
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
    // No-op on mobile; there is no local debug folder to write to.
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
