// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { CanvasProcessor } from "ppu-ocv/canvas";
import type { CoreCanvas, ImageProcessorProvider } from "../platform.js";
import { MIN_CROP_WIDTH } from "./ctc.js";

/**
 * Preprocesses a cropped canvas region into a float tensor ready for the recognition model.
 *
 * Uses OpenCV resize when `imageProcessor` is supplied, otherwise falls back to canvas-native.
 */
export async function preprocessImage(
  cropCanvas: CoreCanvas,
  targetHeight: number,
  imageProcessor: ImageProcessorProvider | undefined,
  createCanvasProcessor: (canvas: CoreCanvas) => CanvasProcessor
): Promise<{ imageTensor: Float32Array; tensorWidth: number; tensorHeight: number }> {
  const originalWidth = cropCanvas.width;
  const originalHeight = cropCanvas.height;

  if (originalHeight === 0 || originalWidth === 0) {
    throw new Error(`Crop dimensions are zero: ${originalWidth}x${originalHeight}`);
  }

  const aspectRatio = originalWidth / originalHeight;
  const resizedWidth = Math.max(MIN_CROP_WIDTH, Math.round(targetHeight * aspectRatio));

  if (imageProcessor) {
    const imgProcessor = new imageProcessor.ImageProcessor(cropCanvas);
    try {
      imgProcessor.resize({ width: resizedWidth, height: targetHeight });
      const imageTensor = createImageTensorFromCanvas(
        imgProcessor.toCanvas(),
        resizedWidth,
        targetHeight
      );
      return { imageTensor, tensorWidth: resizedWidth, tensorHeight: targetHeight };
    } finally {
      imgProcessor.destroy();
    }
  }

  const processor = createCanvasProcessor(cropCanvas).resize({
    width: resizedWidth,
    height: targetHeight,
  });
  const imageTensor = createImageTensor(processor, resizedWidth, targetHeight);
  return { imageTensor, tensorWidth: resizedWidth, tensorHeight: targetHeight };
}

/**
 * Creates a normalized float tensor from a `CanvasProcessor`.
 */
export function createImageTensor(
  processor: CanvasProcessor,
  width: number,
  height: number
): Float32Array {
  const canvas = processor.toCanvas();
  return createImageTensorFromCanvas(canvas, width, height);
}

/**
 * Creates a normalized float tensor from a canvas.
 *
 * The model expects three identical channels (grayscale replicated to RGB).
 * Fills channel 0, then `copyWithin` copies it to channels 1 and 2.
 */
export function createImageTensorFromCanvas(
  canvas: CoreCanvas,
  width: number,
  height: number
): Float32Array {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixelData = imageData.data;

  const channelSize = height * width;
  const imageTensor = new Float32Array(3 * channelSize);

  const INV_127_5 = 1 / 127.5;
  for (let i = 0, p = 0; i < channelSize; i++, p += 4) {
    imageTensor[i] = (pixelData[p] ?? 0) * INV_127_5 - 1.0;
  }

  imageTensor.copyWithin(channelSize, 0, channelSize);
  imageTensor.copyWithin(channelSize * 2, 0, channelSize);

  return imageTensor;
}
