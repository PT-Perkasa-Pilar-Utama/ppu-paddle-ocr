// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { CoreCanvas } from "../platform.js";

/** Number of color channels used by the detection model. */
const NUM_CHANNELS = 3;

/**
 * Converts a canvas to a normalized CHW float tensor for detection model input.
 *
 * Hot loop; pre-multiplies normalization constants to a single multiply+subtract per channel per pixel.
 */
export function imageToTensor(
  canvas: CoreCanvas,
  width: number,
  height: number,
  mean: [number, number, number],
  stdDeviation: [number, number, number]
): Float32Array {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, width, height);
  const rgbaData = imageData.data;

  const channelSize = height * width;
  const tensor = new Float32Array(NUM_CHANNELS * channelSize);
  const meanR = mean[0] ?? 0.485;
  const meanG = mean[1] ?? 0.456;
  const meanB = mean[2] ?? 0.406;
  const stdR = stdDeviation[0] ?? 0.229;
  const stdG = stdDeviation[1] ?? 0.224;
  const stdB = stdDeviation[2] ?? 0.225;
  const scaleR = 1.0 / (255.0 * stdR);
  const scaleG = 1.0 / (255.0 * stdG);
  const scaleB = 1.0 / (255.0 * stdB);
  const shiftR = meanR / stdR;
  const shiftG = meanG / stdG;
  const shiftB = meanB / stdB;
  const gOffset = channelSize;
  const bOffset = channelSize * 2;

  for (let i = 0, rgbaIdx = 0; i < channelSize; i++, rgbaIdx += 4) {
    const r = rgbaData[rgbaIdx];
    const g = rgbaData[rgbaIdx + 1];
    const b = rgbaData[rgbaIdx + 2];
    tensor[i] = r * scaleR - shiftR;
    tensor[gOffset + i] = g * scaleG - shiftG;
    tensor[bOffset + i] = b * scaleB - shiftB;
  }

  return tensor;
}

/**
 * Converts a flat float tensor (probability map) back to a grayscale canvas.
 */
export function tensorToCanvas(
  tensor: Float32Array,
  width: number,
  height: number,
  createCanvas: (w: number, h: number) => CoreCanvas
): CoreCanvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const probability = tensor[i] || 0;
    const grayValue = Math.round(probability * 255);
    const pixelIdx = i * 4;
    data[pixelIdx] = grayValue;
    data[pixelIdx + 1] = grayValue;
    data[pixelIdx + 2] = grayValue;
    data[pixelIdx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
