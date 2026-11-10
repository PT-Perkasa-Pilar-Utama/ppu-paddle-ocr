// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession, Tensor } from "onnxruntime-common";
import { DEFAULT_DEBUGGING_OPTIONS } from "../../constants.js";
import type { Box, DebuggingOptions } from "../../interface.js";
import { calculateResizeDimensions } from "../detection/box-geometry.js";
import type { CoreCanvas, PlatformProvider } from "../platform.js";
import type { GridPoint, PixelSize, UnwarpGrid, UnwarpSkipReason } from "./grid.js";
import {
  composeGrids,
  gridDefect,
  gridDistortion,
  gridFromTensor,
  measurePageSize,
  sampleGrid,
} from "./grid.js";
import { rgbaToUnwarpTensor, UNWARP_INPUT_HEIGHT, UNWARP_INPUT_WIDTH } from "./image-tensor.js";
import { paperColour, remapImage } from "./remap.js";

/**
 * Below this grid distortion, in degrees, the page counts as flat and upright
 * and is left alone: the correction would move text by less than the blur a
 * resample adds.
 */
const FLAT_DISTORTION_LIMIT = 1;

/**
 * A correction is kept only when the second look measures at most this share
 * of the first look's distortion.
 *
 * ponytail: calibrated on the repo fixture alone. Synthetic curls of
 * assets/receipt.jpg that the correction made more readable measured 0.35 to
 * 0.91; the flat original, which a correction makes 2 points less accurate,
 * measured 1.00. The limit sits between the two groups. Re-measure with real
 * curled photos (tests/unwarping.test.ts prints the numbers) before moving it.
 */
const MIN_GAIN_RATIO = 0.95;

/** Sub-pixel slack, in pixels, when a mapped box edge is snapped to whole pixels. */
const SNAP_TOLERANCE = 1e-3;

const MODEL_INPUT: PixelSize = { width: UNWARP_INPUT_WIDTH, height: UNWARP_INPUT_HEIGHT };

/**
 * Places on a box outline that are mapped to find its extent in the photo:
 * the corners and the middle of each side. A curled page bends a straight
 * side, so the corners alone can miss where the side bulges furthest.
 */
const BOX_OUTLINE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
];

/**
 * Translates positions on the flattened page back to the source photo.
 *
 * Detection and recognition run on the flattened page, but callers draw and
 * crop on the photo they passed in, so every box leaves the pipeline through
 * {@link boxToSource}.
 */
export class UnwarpMapping {
  public constructor(
    private readonly grid: UnwarpGrid,
    /** Size of the flattened page the boxes were found on. */
    private readonly page: PixelSize,
    /** Size of the photo the caller passed in. */
    private readonly source: PixelSize
  ) {}

  /** Photo position, in pixels, of a pixel on the flattened page. */
  public pointToSource(x: number, y: number): GridPoint {
    const u = this.page.width > 1 ? x / (this.page.width - 1) : 0;
    const v = this.page.height > 1 ? y / (this.page.height - 1) : 0;
    const fraction = sampleGrid(this.grid, u, v);
    return {
      x: fraction.x * (this.source.width - 1),
      y: fraction.y * (this.source.height - 1),
    };
  }

  /** Copies of `items` with their boxes moved from the flattened page to the photo. */
  public itemsToSource<TItem extends { box: Box }>(items: readonly TItem[]): TItem[] {
    return items.map((item) => ({ ...item, box: this.boxToSource(item.box) }));
  }

  /**
   * Smallest upright box in the photo that holds a box of the flattened page,
   * clipped to the photo and snapped outward to whole pixels.
   */
  public boxToSource(box: Box): Box {
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const [fx, fy] of BOX_OUTLINE) {
      const point = this.pointToSource(box.x + box.width * fx, box.y + box.height * fy);
      if (point.x < left) left = point.x;
      if (point.x > right) right = point.x;
      if (point.y < top) top = point.y;
      if (point.y > bottom) bottom = point.y;
    }
    // The grid is float32, so a whole-pixel edge can come back a hair off;
    // snapping outward from that would grow the box by a pixel for nothing.
    const x = Math.max(0, Math.floor(left + SNAP_TOLERANCE));
    const y = Math.max(0, Math.floor(top + SNAP_TOLERANCE));
    return {
      x,
      y,
      width: Math.max(0, Math.min(this.source.width, Math.ceil(right - SNAP_TOLERANCE)) - x),
      height: Math.max(0, Math.min(this.source.height, Math.ceil(bottom - SNAP_TOLERANCE)) - y),
    };
  }
}

/**
 * Outcome of the unwarping stage.
 *
 * `canvas` is always the image to read text from: the flattened page when the
 * correction was applied, the untouched input when it was skipped.
 */
export type UnwarpResult =
  | {
      status: "unwarped";
      /** The flattened page. */
      canvas: CoreCanvas;
      /** Maps positions on `canvas` back to the input photo. */
      mapping: UnwarpMapping;
    }
  | {
      status: "skipped";
      /** Why the correction was not applied. */
      reason: UnwarpSkipReason;
      /** The input, unchanged. */
      canvas: CoreCanvas;
    };

/**
 * Flattens a photo of a curled, folded, or tilted page before text detection.
 *
 * The model predicts a deformation grid from a small copy of the photo; this
 * service checks the grid, then redraws the page through it. The model file is
 * a cut of PaddleOCR's UVDoc that stops at the grid, so the resampling, the
 * output size, and the box mapping are this package's own code and run the
 * same on every runtime.
 */
export class UnwarpingService {
  private readonly platform: PlatformProvider;
  private readonly session: InferenceSession;
  private readonly debugging: DebuggingOptions;

  public constructor(
    platform: PlatformProvider,
    session: InferenceSession,
    debugging: Partial<DebuggingOptions> = {}
  ) {
    this.platform = platform;
    this.session = session;
    this.debugging = { ...DEFAULT_DEBUGGING_OPTIONS, ...debugging };
  }

  private log(message: string): void {
    if (this.debugging.verbose) {
      console.log(`[UnwarpingService] ${message}`);
    }
  }

  /**
   * Flatten the page in `canvas`.
   *
   * The model is asked twice. Its first grid says how the page is deformed.
   * Its second grid, predicted on the page corrected by the first, says what
   * deformation is left. That second look does two jobs:
   *
   * - It is the acceptance test. The model answers for any input, flat scans
   *   included, and a grid that is only prediction noise does not make the
   *   page look flatter to the model itself. Such a correction is dropped and
   *   the input is returned untouched.
   * - It refines. One step leaves part of a strong curl behind; chaining both
   *   grids removes most of the rest.
   *
   * The page is drawn once, from the photo, through the chained grid.
   *
   * @param maxSideLength - Longest side, in pixels, of the copy the page is
   *   redrawn from. The pipeline passes its crop-source cap so no pixel is
   *   computed that recognition would scale away; omit it to keep the input's
   *   full resolution.
   */
  public async run(canvas: CoreCanvas, maxSideLength?: number): Promise<UnwarpResult> {
    const source: PixelSize = { width: canvas.width, height: canvas.height };
    const work = this.buildWorkCanvas(canvas, maxSideLength);
    const workSize: PixelSize = { width: work.width, height: work.height };
    const rgba = work.getContext("2d").getImageData(0, 0, work.width, work.height).data;

    const first = await this.predictGrid(rgbaToUnwarpTensor(rgba, workSize.width, workSize.height));
    const defect = gridDefect(first);
    if (defect) return this.skipped(canvas, defect);
    const distortion = gridDistortion(first, workSize);
    if (distortion < FLAT_DISTORTION_LIMIT) return this.skipped(canvas, "flat");

    // The second look needs the corrected page only at the model's input size,
    // so it is drawn at that size directly instead of at full resolution.
    const fill = paperColour(rgba, workSize, first);
    const preview = remapImage(rgba, workSize, first, MODEL_INPUT, fill);
    const second = await this.predictGrid(
      rgbaToUnwarpTensor(preview, MODEL_INPUT.width, MODEL_INPUT.height)
    );
    const remaining = gridDistortion(second, measurePageSize(first, workSize));
    this.log(`Distortion ${distortion.toFixed(2)} deg, ${remaining.toFixed(2)} deg after one step`);
    if (remaining > MIN_GAIN_RATIO * distortion) return this.skipped(canvas, "no-gain");

    // A faulty second grid cannot refine; the first one alone already passed.
    const chained = composeGrids(first, second);
    const grid = gridDefect(chained) === null ? chained : first;

    const page = measurePageSize(grid, workSize);
    const pixels = remapImage(rgba, workSize, grid, page, fill);
    const flattened = this.platform.createCanvas(page.width, page.height);
    const ctx = flattened.getContext("2d");
    const imageData = ctx.createImageData(page.width, page.height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    this.log(
      `Unwarped ${source.width}x${source.height} photo to ${page.width}x${page.height} page`
    );

    if (this.debugging.debug && this.debugging.debugFolder) {
      // A debug dump is an observation, not a step: a read-only filesystem
      // must not turn a successful correction into a failure.
      try {
        await this.platform.saveDebugImage(flattened, "unwarped-debug", this.debugging.debugFolder);
      } catch (error) {
        this.log(`Debug dump failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      status: "unwarped",
      canvas: flattened,
      mapping: new UnwarpMapping(grid, page, source),
    };
  }

  private skipped(canvas: CoreCanvas, reason: UnwarpSkipReason): UnwarpResult {
    this.log(`Skipped: ${reason}`);
    return { status: "skipped", reason, canvas };
  }

  /** The input, scaled down when it exceeds `maxSideLength`. */
  private buildWorkCanvas(canvas: CoreCanvas, maxSideLength?: number): CoreCanvas {
    if (maxSideLength === undefined) return canvas;
    const { width, height, ratio } = calculateResizeDimensions(
      canvas.width,
      canvas.height,
      maxSideLength
    );
    if (ratio === 1) return canvas;

    const resized = this.platform.createCanvas(width, height);
    resized
      .getContext("2d")
      .drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height);
    return resized;
  }

  /** Run the model on one prepared input tensor. */
  private async predictGrid(tensor: Float32Array): Promise<UnwarpGrid> {
    const inputName = this.session.inputNames[0];
    const outputName = this.session.outputNames[0];
    if (inputName === undefined || outputName === undefined) {
      throw new Error("Unwarping model declares no input or no output.");
    }

    const input: Tensor = new this.platform.ort.Tensor("float32", tensor, [
      1,
      3,
      UNWARP_INPUT_HEIGHT,
      UNWARP_INPUT_WIDTH,
    ]);
    try {
      const results = await this.session.run({ [inputName]: input });
      const output = results[outputName];
      if (!output || !(output.data instanceof Float32Array)) {
        throw new Error(`Unwarping model output "${outputName}" is missing or not float32.`);
      }
      const grid = gridFromTensor(output.data, output.dims);
      output.dispose();
      return grid;
    } finally {
      input.dispose();
    }
  }
}
