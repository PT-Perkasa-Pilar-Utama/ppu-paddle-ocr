// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * The deformation grid the unwarping model predicts.
 *
 * A lattice of `columns` x `rows` nodes covers the flattened page edge to
 * edge. Each node holds the place in the source photo that the page point
 * came from, as a fraction of the photo (0 = left/top edge, 1 = right/bottom
 * edge). Fractions keep one grid valid for any copy of the photo, whatever
 * its resolution.
 */
export type UnwarpGrid = {
  readonly columns: number;
  readonly rows: number;
  /** Source x of each node, row-major, as a fraction of the photo width. */
  readonly x: Float32Array;
  /** Source y of each node, row-major, as a fraction of the photo height. */
  readonly y: Float32Array;
};

/** Why the unwarping stage left an image as it was. */
export type UnwarpSkipReason =
  /** The predicted grid is close to a straight upright lattice: nothing to correct. */
  | "flat"
  /** A second look at the corrected page found it no flatter than the input. */
  | "no-gain"
  /** The grid crosses over itself, so it is not a one-to-one map of the page. */
  | "folded"
  /** Too much of the predicted page lies outside the photo. */
  | "out-of-frame";

/** A size in pixels. */
export type PixelSize = { width: number; height: number };

/** A position: photo fractions from {@link sampleGrid}, pixels where a caller scaled them. */
export type GridPoint = { x: number; y: number };

/**
 * Largest share of grid nodes allowed outside the photo. A page cut by the
 * frame puts a few border nodes outside; a failed prediction puts many.
 */
const OUT_OF_FRAME_SHARE_LIMIT = 0.2;

/** Slack around the photo before a node counts as outside, as a fraction of its size. */
const FRAME_MARGIN = 0.02;

/**
 * Read the model output (`[1, 2, rows, columns]`, x plane then y plane, values
 * in -1..1 with -1 and 1 on the outermost pixel centres) into an {@link UnwarpGrid}.
 */
export function gridFromTensor(data: Float32Array, dims: readonly number[]): UnwarpGrid {
  const [batch, channels, rows, columns] = dims;
  if (
    dims.length !== 4 ||
    batch !== 1 ||
    channels !== 2 ||
    rows === undefined ||
    columns === undefined ||
    rows < 2 ||
    columns < 2
  ) {
    throw new Error(
      `Unwarping model returned shape [${dims.join(", ")}], expected [1, 2, rows, columns]. The model must output the deformation grid, not a corrected image.`
    );
  }

  const nodes = rows * columns;
  const x = new Float32Array(nodes);
  const y = new Float32Array(nodes);
  for (let i = 0; i < nodes; i++) {
    x[i] = (data[i] + 1) / 2;
    y[i] = (data[nodes + i] + 1) / 2;
  }
  return { columns, rows, x, y };
}

/**
 * Source position of the page point (`u`, `v`), both 0..1 across the page.
 * Bilinear between the four surrounding nodes; a point past the page edge
 * continues the border cell in a straight line. Returns photo fractions.
 */
export function sampleGrid(grid: UnwarpGrid, u: number, v: number): GridPoint {
  const { columns, rows, x, y } = grid;
  const gu = u * (columns - 1);
  const gv = v * (rows - 1);
  const i0 = Math.min(columns - 2, Math.max(0, Math.floor(gu)));
  const j0 = Math.min(rows - 2, Math.max(0, Math.floor(gv)));
  const fu = gu - i0;
  const fv = gv - j0;
  const a = j0 * columns + i0;
  const b = a + columns;
  const lerp2 = (plane: Float32Array): number =>
    (plane[a] * (1 - fu) + plane[a + 1] * fu) * (1 - fv) +
    (plane[b] * (1 - fu) + plane[b + 1] * fu) * fv;
  return { x: lerp2(x), y: lerp2(y) };
}

/**
 * Size of the flattened page in source pixels, measured along the grid.
 *
 * A grid row traces one horizontal line of the page through the photo, so its
 * length along the curve is the page width at that row; columns give the
 * height the same way. The median over rows (columns) ignores the few lines a
 * bad border prediction stretches.
 *
 * ponytail: curve length undoes curl but not perspective, so a page shot at a
 * steep angle keeps some foreshortening. Recovering the true ratio needs a
 * camera model; add one if skewed photos show stretched text.
 */
export function measurePageSize(grid: UnwarpGrid, source: PixelSize): PixelSize {
  const { columns, rows, x, y } = grid;
  const scaleX = source.width - 1;
  const scaleY = source.height - 1;

  const rowLengths = new Float64Array(rows);
  for (let j = 0; j < rows; j++) {
    let length = 0;
    for (let i = 1; i < columns; i++) {
      const n = j * columns + i;
      length += Math.hypot((x[n] - x[n - 1]) * scaleX, (y[n] - y[n - 1]) * scaleY);
    }
    rowLengths[j] = length;
  }

  const columnLengths = new Float64Array(columns);
  for (let i = 0; i < columns; i++) {
    let length = 0;
    for (let j = 1; j < rows; j++) {
      const n = j * columns + i;
      length += Math.hypot((x[n] - x[n - columns]) * scaleX, (y[n] - y[n - columns]) * scaleY);
    }
    columnLengths[i] = length;
  }

  return {
    width: Math.max(1, Math.round(median(rowLengths)) + 1),
    height: Math.max(1, Math.round(median(columnLengths)) + 1),
  };
}

/**
 * A structural fault that makes a grid unusable, or null when it has none.
 *
 * The model always answers, also for a photo with no page in it:
 *
 * - folded - a cell is turned inside out, so two page points share a source.
 * - out-of-frame - most of the predicted page is not in the photo.
 */
export function gridDefect(grid: UnwarpGrid): "folded" | "out-of-frame" | null {
  if (hasFoldedCell(grid)) return "folded";
  if (outOfFrameShare(grid) > OUT_OF_FRAME_SHARE_LIMIT) return "out-of-frame";
  return null;
}

/**
 * How far the grid is from a straight upright lattice, in degrees.
 *
 * On a flat upright page every grid row runs level through the photo and every
 * column runs plumb. Curl, tilt, and perspective turn the segments between
 * neighbouring nodes away from that. The result is the root mean square of
 * those turns, over the row segments and the column segments together, so one
 * number covers horizontal and vertical writing.
 */
export function gridDistortion(grid: UnwarpGrid, source: PixelSize): number {
  const { columns, rows, x, y } = grid;
  const scaleX = source.width - 1;
  const scaleY = source.height - 1;
  let sumOfSquares = 0;
  let segments = 0;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const n = j * columns + i;
      if (i > 0) {
        const turn = Math.atan2((y[n] - y[n - 1]) * scaleY, (x[n] - x[n - 1]) * scaleX);
        sumOfSquares += turn * turn;
        segments++;
      }
      if (j > 0) {
        const turn = Math.atan2((x[n] - x[n - columns]) * scaleX, (y[n] - y[n - columns]) * scaleY);
        sumOfSquares += turn * turn;
        segments++;
      }
    }
  }

  return (Math.sqrt(sumOfSquares / segments) * 180) / Math.PI;
}

/**
 * Chain two corrections into one grid: `second` was predicted on the page that
 * `first` produced, so each of its nodes names a point of that page, and
 * `first` knows where that point came from in the photo.
 *
 * One grid for both steps lets the page be redrawn from the photo once, which
 * keeps it sharper than redrawing an already redrawn image.
 */
export function composeGrids(first: UnwarpGrid, second: UnwarpGrid): UnwarpGrid {
  const nodes = second.x.length;
  const x = new Float32Array(nodes);
  const y = new Float32Array(nodes);
  for (let n = 0; n < nodes; n++) {
    const source = sampleGrid(first, second.x[n], second.y[n]);
    x[n] = source.x;
    y[n] = source.y;
  }
  return { columns: second.columns, rows: second.rows, x, y };
}

/** True when any cell has a corner where "right" and "down" no longer turn clockwise. */
function hasFoldedCell(grid: UnwarpGrid): boolean {
  const { columns, rows, x, y } = grid;
  // z of the cross product of the edges leaving `origin` towards `right` and
  // `down`. Positive for an unfolded cell (y grows downward in image space).
  const turn = (origin: number, right: number, down: number): number =>
    (x[right] - x[origin]) * (y[down] - y[origin]) - (y[right] - y[origin]) * (x[down] - x[origin]);

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < columns - 1; i++) {
      const topLeft = j * columns + i;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns;
      const bottomRight = bottomLeft + 1;
      if (
        turn(topLeft, topRight, bottomLeft) <= 0 ||
        // The opposite corner sees the same two directions reversed, which
        // keeps the sign.
        turn(bottomRight, bottomLeft, topRight) <= 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Share of nodes that point outside the photo. */
function outOfFrameShare(grid: UnwarpGrid): number {
  const { x, y } = grid;
  const low = -FRAME_MARGIN;
  const high = 1 + FRAME_MARGIN;
  let outside = 0;
  for (let n = 0; n < x.length; n++) {
    if (x[n] < low || x[n] > high || y[n] < low || y[n] > high) outside++;
  }
  return outside / x.length;
}

function median(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort();
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
