// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { PixelSize, UnwarpGrid } from "./grid.js";

/** An opaque colour, one byte per channel. */
export type Rgb = readonly [red: number, green: number, blue: number];

/**
 * Median colour of the source at the grid nodes that fall inside the photo.
 *
 * A page is mostly blank paper, so the per-channel median over the nodes is
 * the paper colour. {@link remapImage} paints it wherever the page runs past
 * the photo, where a black fill would hand the text detector a hard edge to
 * box.
 */
export function paperColour(rgba: Uint8ClampedArray, source: PixelSize, grid: UnwarpGrid): Rgb {
  const lastX = source.width - 1;
  const lastY = source.height - 1;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  for (let n = 0; n < grid.x.length; n++) {
    const px = Math.round(grid.x[n] * lastX);
    const py = Math.round(grid.y[n] * lastY);
    if (px < 0 || py < 0 || px > lastX || py > lastY) continue;
    const p = (py * source.width + px) * 4;
    reds.push(rgba[p]);
    greens.push(rgba[p + 1]);
    blues.push(rgba[p + 2]);
  }

  // No node inside the photo cannot reach here: gridDefect rejects that grid
  // first. White keeps the function total for direct callers.
  if (reds.length === 0) return [255, 255, 255];
  const middle = (values: number[]): number => values.sort((a, b) => a - b)[values.length >> 1];
  return [middle(reds), middle(greens), middle(blues)];
}

/**
 * Draw the flattened page: for each output pixel, look up where it came from
 * in the source through `grid` and copy that colour, bilinear between the four
 * nearest source pixels. Pixels whose source lies outside the photo get `fill`.
 *
 * This is the hot loop of the stage (one pass per output pixel), so it avoids
 * per-pixel grid lookups: along one output row the source position is a
 * straight line between two neighbouring grid columns, so each grid cell is
 * walked with a constant step.
 */
export function remapImage(
  rgba: Uint8ClampedArray,
  source: PixelSize,
  grid: UnwarpGrid,
  target: PixelSize,
  fill: Rgb
): Uint8ClampedArray {
  const { columns, rows, x: gridX, y: gridY } = grid;
  const { width: sourceWidth, height: sourceHeight } = source;
  const { width, height } = target;
  const out = new Uint8ClampedArray(width * height * 4);
  // One 32-bit store per pixel instead of four byte stores. Byte order is
  // fixed by writing the fill through the byte view first.
  const out32 = new Uint32Array(out.buffer);
  out[0] = fill[0];
  out[1] = fill[1];
  out[2] = fill[2];
  out[3] = 255;
  const fill32 = out32[0];

  const scaleX = sourceWidth - 1;
  const scaleY = sourceHeight - 1;
  const stride = sourceWidth * 4;
  // Source position of each grid column on the current output row, in pixels.
  const rowX = new Float64Array(columns);
  const rowY = new Float64Array(columns);
  // Output x where each grid cell starts; the last entry closes the last cell.
  const cellStart = new Int32Array(columns);
  const columnStep = width > 1 ? (columns - 1) / (width - 1) : 0;
  for (let i = 1; i < columns; i++) {
    // A one-pixel-wide target has no step; the first cell then owns the pixel.
    // The epsilon keeps a quotient that lands a hair above a whole number
    // from skipping its pixel.
    cellStart[i] =
      i === columns - 1 || columnStep === 0
        ? width
        : Math.min(width, Math.ceil(i / columnStep - 1e-9));
  }
  const rowStep = height > 1 ? (rows - 1) / (height - 1) : 0;

  for (let ty = 0; ty < height; ty++) {
    const gv = ty * rowStep;
    const j0 = Math.min(rows - 2, Math.floor(gv));
    const fv = gv - j0;
    const upper = j0 * columns;
    const lower = upper + columns;
    for (let i = 0; i < columns; i++) {
      rowX[i] = (gridX[upper + i] * (1 - fv) + gridX[lower + i] * fv) * scaleX;
      rowY[i] = (gridY[upper + i] * (1 - fv) + gridY[lower + i] * fv) * scaleY;
    }

    const rowOffset = ty * width;
    for (let i = 0; i < columns - 1; i++) {
      const from = cellStart[i];
      const to = cellStart[i + 1];
      if (from >= to) continue;
      const stepX = (rowX[i + 1] - rowX[i]) * columnStep;
      const stepY = (rowY[i + 1] - rowY[i]) * columnStep;
      const lead = from * columnStep - i;
      let sx = rowX[i] + (rowX[i + 1] - rowX[i]) * lead;
      let sy = rowY[i] + (rowY[i + 1] - rowY[i]) * lead;

      for (let tx = from; tx < to; tx++, sx += stepX, sy += stepY) {
        if (sx < 0 || sy < 0 || sx > scaleX || sy > scaleY) {
          out32[rowOffset + tx] = fill32;
          continue;
        }
        const x0 = sx | 0;
        const y0 = sy | 0;
        const fx = sx - x0;
        const fy = sy - y0;
        const p00 = y0 * stride + x0 * 4;
        // On the last column or row the neighbour would be outside; its weight
        // is zero there, so reading the pixel itself changes nothing.
        const p01 = x0 < scaleX ? p00 + 4 : p00;
        const p10 = y0 < scaleY ? p00 + stride : p00;
        const p11 = x0 < scaleX ? p10 + 4 : p10;
        const w00 = (1 - fx) * (1 - fy);
        const w01 = fx * (1 - fy);
        const w10 = (1 - fx) * fy;
        const w11 = fx * fy;
        const o = (rowOffset + tx) * 4;
        // Uint8ClampedArray rounds to nearest on store.
        out[o] = rgba[p00] * w00 + rgba[p01] * w01 + rgba[p10] * w10 + rgba[p11] * w11;
        out[o + 1] =
          rgba[p00 + 1] * w00 + rgba[p01 + 1] * w01 + rgba[p10 + 1] * w10 + rgba[p11 + 1] * w11;
        out[o + 2] =
          rgba[p00 + 2] * w00 + rgba[p01 + 2] * w01 + rgba[p10 + 2] * w10 + rgba[p11 + 2] * w11;
        out[o + 3] = 255;
      }
    }
  }

  return out;
}
