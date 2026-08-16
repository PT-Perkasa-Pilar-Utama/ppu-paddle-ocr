// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { cv } from "ppu-ocv";
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
      // Reading the resized Mat's bytes directly skips the toCanvas()
      // render-plus-readback round trip; the resize output is CV_8UC4
      // (RGBA, straight from matFromImageData), so the red channel is the
      // same byte createImageTensorFromCanvas would read.
      const mat = imgProcessor.toMat();
      if (mat.channels() === 4 || mat.channels() === 1) {
        const imageTensor = createImageTensorFromMat(mat, resizedWidth, targetHeight);
        return { imageTensor, tensorWidth: resizedWidth, tensorHeight: targetHeight };
      }
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

/**
 * Creates a normalized float tensor directly from an 8-bit OpenCV Mat.
 *
 * Same normalization as {@link createImageTensorFromCanvas} (red channel for
 * RGBA mats), but reads `mat.data` in place instead of routing the pixels
 * through a canvas render and `getImageData` readback. Rows are walked via
 * `step1(0)` so non-contiguous (row-padded) mats are read correctly.
 */
export function createImageTensorFromMat(mat: cv.Mat, width: number, height: number): Float32Array {
  const channels = mat.channels();
  const stride = mat.step1(0);
  const data = mat.data;

  const channelSize = height * width;
  const imageTensor = new Float32Array(3 * channelSize);

  const INV_127_5 = 1 / 127.5;
  if (channels === 4) {
    for (let y = 0; y < height; y++) {
      let src = y * stride;
      const rowEnd = y * width + width;
      for (let dst = y * width; dst < rowEnd; dst++, src += 4) {
        imageTensor[dst] = data[src] * INV_127_5 - 1.0;
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      let src = y * stride;
      const rowEnd = y * width + width;
      for (let dst = y * width; dst < rowEnd; dst++, src++) {
        imageTensor[dst] = data[src] * INV_127_5 - 1.0;
      }
    }
  }

  imageTensor.copyWithin(channelSize, 0, channelSize);
  imageTensor.copyWithin(channelSize * 2, 0, channelSize);

  return imageTensor;
}
