// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/** Width of the unwarping model's input, in pixels. Fixed by the model. */
export const UNWARP_INPUT_WIDTH = 488;
/** Height of the unwarping model's input, in pixels. Fixed by the model. */
export const UNWARP_INPUT_HEIGHT = 712;

const NUM_CHANNELS = 3;

/**
 * Resize RGBA pixels to the model input and lay them out as a CHW float
 * tensor: blue, green, red planes, values 0..1.
 *
 * The resize is bilinear with the outermost pixel centres of source and target
 * aligned. Both that rule and the channel order repeat what the published
 * UVDoc graph did to its input before the cut (see
 * examples/export-unwarping-grid-onnx.py), so the cut model sees the same
 * numbers on every canvas backend. A canvas `drawImage` resize filters
 * differently per platform and moved the predicted grid by about 2 px on a
 * 720 px wide photo.
 */
export function rgbaToUnwarpTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  const plane = UNWARP_INPUT_WIDTH * UNWARP_INPUT_HEIGHT;
  const tensor = new Float32Array(NUM_CHANNELS * plane);
  const stepX = UNWARP_INPUT_WIDTH > 1 ? (width - 1) / (UNWARP_INPUT_WIDTH - 1) : 0;
  const stepY = UNWARP_INPUT_HEIGHT > 1 ? (height - 1) / (UNWARP_INPUT_HEIGHT - 1) : 0;
  const lastX = width - 1;
  const lastY = height - 1;
  const greenOffset = plane;
  const redOffset = plane * 2;
  const scale = 1 / 255;

  for (let ty = 0, out = 0; ty < UNWARP_INPUT_HEIGHT; ty++) {
    const sy = ty * stepY;
    const y0 = Math.min(lastY, Math.floor(sy));
    const y1 = Math.min(lastY, y0 + 1);
    const fy = sy - y0;
    const row0 = y0 * width * 4;
    const row1 = y1 * width * 4;

    for (let tx = 0; tx < UNWARP_INPUT_WIDTH; tx++, out++) {
      const sx = tx * stepX;
      const x0 = Math.min(lastX, Math.floor(sx));
      const x1 = Math.min(lastX, x0 + 1);
      const fx = sx - x0;
      const w00 = (1 - fx) * (1 - fy) * scale;
      const w01 = fx * (1 - fy) * scale;
      const w10 = (1 - fx) * fy * scale;
      const w11 = fx * fy * scale;
      const p00 = row0 + x0 * 4;
      const p01 = row0 + x1 * 4;
      const p10 = row1 + x0 * 4;
      const p11 = row1 + x1 * 4;

      tensor[out] =
        rgba[p00 + 2] * w00 + rgba[p01 + 2] * w01 + rgba[p10 + 2] * w10 + rgba[p11 + 2] * w11;
      tensor[greenOffset + out] =
        rgba[p00 + 1] * w00 + rgba[p01 + 1] * w01 + rgba[p10 + 1] * w10 + rgba[p11 + 1] * w11;
      tensor[redOffset + out] =
        rgba[p00] * w00 + rgba[p01] * w01 + rgba[p10] * w10 + rgba[p11] * w11;
    }
  }

  return tensor;
}
