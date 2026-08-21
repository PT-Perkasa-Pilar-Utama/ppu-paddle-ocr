import { beforeAll, describe, expect, test } from "bun:test";
import { Canvas, ImageProcessor, cv } from "ppu-ocv";
import type { CoreCanvas } from "../src/core/platform.js";
import {
  createImageTensorFromCanvas,
  createImageTensorFromMat,
} from "../src/core/recognition/image-tensor.js";

/**
 * The OpenCV recognition path reads the resized mat's bytes directly instead
 * of rendering it to a canvas and reading it back. These tests pin the two
 * readers to the same output, and pin the continuity requirement that makes
 * the fast path safe.
 */

const WIDTH = 7;
const HEIGHT = 5;

/** Deterministic gradient, one byte per pixel. */
function pixelValue(x: number, y: number): number {
  return (x * 37 + y * 91) % 256;
}

beforeAll(async () => {
  await ImageProcessor.initRuntime();
});

function makeCanvas(): CoreCanvas {
  const canvas = new Canvas(WIDTH, HEIGHT) as unknown as CoreCanvas;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const value = pixelValue(x, y);
      const p = (y * WIDTH + x) * 4;
      imageData.data[p] = value;
      imageData.data[p + 1] = value;
      imageData.data[p + 2] = value;
      imageData.data[p + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

describe("createImageTensorFromMat", () => {
  test("matches the canvas reader byte for byte on an RGBA mat", () => {
    const canvas = makeCanvas();
    const mat = cv.matFromImageData(canvas.getContext("2d").getImageData(0, 0, WIDTH, HEIGHT));
    try {
      expect(mat.channels()).toBe(4);
      expect(mat.isContinuous()).toBe(true);

      const fromMat = createImageTensorFromMat(mat, WIDTH, HEIGHT);
      const fromCanvas = createImageTensorFromCanvas(canvas, WIDTH, HEIGHT);

      expect(Array.from(fromMat)).toEqual(Array.from(fromCanvas));
    } finally {
      mat.delete();
    }
  });

  test("normalizes a single-channel mat to value / 127.5 - 1", () => {
    const mat = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC1);
    try {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          mat.data[y * WIDTH + x] = pixelValue(x, y);
        }
      }

      const tensor = createImageTensorFromMat(mat, WIDTH, HEIGHT);

      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          expect(tensor[y * WIDTH + x]).toBeCloseTo(pixelValue(x, y) / 127.5 - 1, 6);
        }
      }
    } finally {
      mat.delete();
    }
  });

  test("replicates channel 0 into channels 1 and 2", () => {
    const mat = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC1);
    try {
      for (let i = 0; i < WIDTH * HEIGHT; i++) mat.data[i] = i;

      const tensor = createImageTensorFromMat(mat, WIDTH, HEIGHT);
      const channelSize = WIDTH * HEIGHT;

      expect(tensor.length).toBe(3 * channelSize);
      expect(Array.from(tensor.subarray(channelSize, channelSize * 2))).toEqual(
        Array.from(tensor.subarray(0, channelSize))
      );
      expect(Array.from(tensor.subarray(channelSize * 2))).toEqual(
        Array.from(tensor.subarray(0, channelSize))
      );
    } finally {
      mat.delete();
    }
  });

  // The reason preprocessImage guards the fast path with isContinuous(): a
  // padded view's `data` is sized total() * elemSize(), so the strided tail
  // is not addressable and the reader would emit NaN.
  test("a padded ROI view cannot be read through mat.data", () => {
    const full = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC1);
    try {
      const roi = full.roi(new cv.Rect(1, 1, WIDTH - 2, HEIGHT - 2));
      try {
        expect(roi.isContinuous()).toBe(false);
        expect(roi.data.length).toBeLessThan(roi.rows * roi.step1(0));
      } finally {
        roi.delete();
      }
    } finally {
      full.delete();
    }
  });
});
