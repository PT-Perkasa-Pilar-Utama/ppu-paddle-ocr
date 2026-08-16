// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession, Tensor } from "onnxruntime-common";
import type { Canvas, Contours, ImageProcessor, cv } from "ppu-ocv";
import type { CanvasProcessor, CanvasToolkit } from "ppu-ocv/canvas";
import type { CanvasLike } from "ppu-ocv/web";

// Unified Canvas type to support both Node and Web Canvas variations
export type CoreCanvas = Canvas | CanvasLike;

/**
 * Canvas-native operations supplied by the platform layer.
 *
 * Core services receive the `ppu-ocv/canvas` (Node) or `ppu-ocv/canvas-web`
 * (browser) variant through this surface so they never import the bare
 * `ppu-ocv/canvas` specifier directly - bundlers and browser importmaps
 * would otherwise have to alias it.
 */
export type CanvasOps<TCanvas = CoreCanvas> = {
  prepareCanvas: (image: unknown) => Promise<TCanvas>;
  createProcessor: (canvas: TCanvas) => CanvasProcessor;
  getToolkit: () => CanvasToolkit;
};

/**
 * Optional wrapper for platform-specific OpenCV image manipulation.
 *
 * Only populated when `processing.engine === "opencv"` (Node/Bun).
 * Web builds leave this `undefined` and always use canvas-native processing.
 */
export type ImageProcessorProvider<TCanvas = CoreCanvas> = {
  /** Injects the source image buffer into a universally parsable Canvas */
  prepareCanvas: (image: unknown) => Promise<TCanvas>;

  /** Wrapper class handling matrix transformations */
  ImageProcessor: new (source: TCanvas | cv.Mat) => ImageProcessor;

  /** Wrapper class handling mathematical OpenCV contours */
  Contours: new (mat: cv.Mat, options: { mode: number; method: number }) => Contours;

  /** Raw OpenCV WebAssembly object reference */
  cv: typeof cv;
};

/**
 * A generic abstraction mapping specifically to pure runtime-level APIs
 * (like ort/onnxruntime, canvas APIs, fetching mechanisms, etc).
 *
 * This injects the platform-specific dependencies into the shared Core logic.
 */
export type PlatformProvider<TCanvas = CoreCanvas> = {
  /** The specific pathing delimiter used on this platform (ie '/' vs '\') */
  pathSeparator: string;

  /** Platform-specific ONNX Runtime namespace (`onnxruntime-node` vs `onnxruntime-web`) */
  ort: {
    Tensor: typeof Tensor;
    InferenceSession: typeof InferenceSession;
  };

  /** Platform-specific canvas constructor (`createCanvas` vs `getPlatform().createCanvas`) */
  createCanvas: (width: number, height: number) => TCanvas;

  /** Type guard determining if an object is a recognized Canvas API implementation */
  isCanvas: (image: unknown) => image is TCanvas;

  /** Resolves resources asynchronously via local FileSystem (`fs`) or HTTP (`fetch`) based on the environment */
  loadResource: (
    source: string | ArrayBuffer | undefined,
    defaultUrl: string
  ) => Promise<ArrayBuffer>;

  /** Optionally dump a given Canvas representation directly onto the disk (No-Op on Web context) */
  saveDebugImage: (canvas: TCanvas, filename: string, path: string) => Promise<void>;

  /** Write a canvas as a PNG to an exact file path (undefined on Web/Mobile - no filesystem) */
  saveImage?: (canvas: TCanvas, filePath: string) => Promise<void>;

  /** OpenCV-based image processor (only available in Node/Bun environments) */
  imageProcessor?: ImageProcessorProvider<TCanvas>;

  /** Canvas-native helpers (`prepareCanvas`, `CanvasProcessor`, `CanvasToolkit`). */
  canvas: CanvasOps<TCanvas>;
};
