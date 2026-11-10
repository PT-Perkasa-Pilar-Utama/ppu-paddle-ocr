import { describe, expect, test } from "bun:test";

import {
  composeGrids,
  gridDefect,
  gridDistortion,
  gridFromTensor,
  measurePageSize,
  sampleGrid,
} from "../src/core/unwarping/grid.js";
import {
  rgbaToUnwarpTensor,
  UNWARP_INPUT_HEIGHT,
  UNWARP_INPUT_WIDTH,
} from "../src/core/unwarping/image-tensor.js";
import { paperColour, remapImage } from "../src/core/unwarping/remap.js";
import { UnwarpMapping } from "../src/core/unwarping/unwarping.service.js";
import { buildGrid, curl, identity, solid } from "./unwarping-fixture.js";

describe("rgbaToUnwarpTensor", () => {
  const plane = UNWARP_INPUT_WIDTH * UNWARP_INPUT_HEIGHT;

  test("writes blue, green, red planes scaled to 0..1", () => {
    const tensor = rgbaToUnwarpTensor(solid(40, 60, [255, 51, 0]), 40, 60);

    expect(tensor).toHaveLength(3 * plane);
    expect(tensor[0]).toBeCloseTo(0, 5);
    expect(tensor[plane]).toBeCloseTo(0.2, 5);
    expect(tensor[2 * plane]).toBeCloseTo(1, 5);
  });

  test("keeps the corner pixels of the source on the corners of the input", () => {
    const width = 100;
    const height = 150;
    const rgba = solid(width, height, [0, 0, 0]);
    // Red marks the top-left pixel, the bottom-right one stays black, the rest
    // is mid grey: a resize that does not align the corners would blend them.
    rgba.fill(128);
    rgba.set([255, 0, 0, 255], 0);
    rgba.set([0, 0, 0, 255], (width * height - 1) * 4);

    const tensor = rgbaToUnwarpTensor(rgba, width, height);

    expect(tensor[2 * plane]).toBeCloseTo(1, 5);
    expect(tensor[0]).toBeCloseTo(0, 5);
    expect(tensor[3 * plane - 1]).toBeCloseTo(0, 5);
  });
});

describe("gridFromTensor", () => {
  test("maps model output from -1..1 to photo fractions", () => {
    const data = new Float32Array([-1, 1, -1, 1, -1, -1, 1, 1]);
    const grid = gridFromTensor(data, [1, 2, 2, 2]);

    expect([...grid.x]).toEqual([0, 1, 0, 1]);
    expect([...grid.y]).toEqual([0, 0, 1, 1]);
  });

  test("rejects a model that returns a corrected image instead of a grid", () => {
    expect(() => gridFromTensor(new Float32Array(3 * 4 * 4), [1, 3, 4, 4])).toThrow(
      /must output the deformation grid/
    );
  });
});

describe("grid checks", () => {
  test("a straight upright lattice has no defect and no distortion", () => {
    expect(gridDefect(identity)).toBeNull();
    expect(gridDistortion(identity, { width: 800, height: 1200 })).toBeCloseTo(0, 5);
  });

  test("distortion reads a rotated page as its angle", () => {
    const angle = (10 * Math.PI) / 180;
    const size = { width: 1001, height: 1001 };
    const rotated = buildGrid((u, v) => [
      0.5 + (u - 0.5) * Math.cos(angle) - (v - 0.5) * Math.sin(angle),
      0.5 + (u - 0.5) * Math.sin(angle) + (v - 0.5) * Math.cos(angle),
    ]);

    expect(gridDistortion(rotated, size)).toBeCloseTo(10, 3);
  });

  test("a grid that crosses over itself is folded", () => {
    const mirrored = buildGrid((u, v) => [1 - u, v]);

    expect(gridDefect(mirrored)).toBe("folded");
  });

  test("a page mostly outside the photo is out of frame", () => {
    const shifted = buildGrid((u, v) => [u + 0.7, v]);

    expect(gridDefect(shifted)).toBe("out-of-frame");
  });

  test("page size follows the length of the curve, not the photo size", () => {
    const half = buildGrid((u, v) => [0.25 + u * 0.5, v]);

    expect(measurePageSize(half, { width: 1001, height: 501 })).toEqual({
      width: 501,
      height: 501,
    });
  });

  test("chaining two corrections adds their moves", () => {
    const right = buildGrid((u, v) => [u + 0.1, v]);
    const down = buildGrid((u, v) => [u, v + 0.2]);

    const chained = composeGrids(right, down);
    const corner = sampleGrid(chained, 0, 0);

    expect(corner.x).toBeCloseTo(0.1, 5);
    expect(corner.y).toBeCloseTo(0.2, 5);
  });
});

describe("remapImage", () => {
  test("a straight lattice at the same size copies the image", () => {
    const size = { width: 64, height: 48 };
    const rgba = solid(size.width, size.height, [0, 0, 0]);
    for (let p = 0; p < rgba.length; p += 4) rgba[p] = (p / 4) % 251;

    const out = remapImage(rgba, size, identity, size, [9, 9, 9]);

    expect([...out]).toEqual([...rgba]);
  });

  test("paints the fill colour where the page runs past the photo", () => {
    const size = { width: 40, height: 40 };
    const shifted = buildGrid((u, v) => [u + 0.5, v]);

    const out = remapImage(solid(40, 40, [10, 20, 30]), size, shifted, size, [200, 100, 50]);

    expect([...out.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...out.subarray(39 * 4, 40 * 4)]).toEqual([200, 100, 50, 255]);
  });

  test("paper colour is the median over the grid nodes", () => {
    const size = { width: 100, height: 100 };
    const rgba = solid(100, 100, [240, 240, 230]);
    // A dark band over a fifth of the page stands in for text.
    rgba.fill(0, 0, 100 * 20 * 4);

    expect(paperColour(rgba, size, identity)).toEqual([240, 240, 230]);
  });
});

describe("UnwarpMapping", () => {
  test("scales a box from the page to a larger photo", () => {
    const mapping = new UnwarpMapping(
      identity,
      { width: 101, height: 101 },
      { width: 201, height: 401 }
    );

    expect(mapping.boxToSource({ x: 10, y: 10, width: 20, height: 5 })).toEqual({
      x: 20,
      y: 40,
      width: 40,
      height: 20,
    });
  });

  test("covers the whole bent outline of a box on a curled page", () => {
    const page = { width: 301, height: 301 };
    const mapping = new UnwarpMapping(curl(0.1, 0), page, page);
    const box = { x: 0, y: 140, width: 300, height: 20 };

    const mapped = mapping.boxToSource(box);
    const middleOfTopSide = mapping.pointToSource(150, 140);

    // The top side bows down in the middle; a box built from the corners
    // alone would stop above that point's far side.
    expect(mapped.y).toBeLessThanOrEqual(Math.floor(mapping.pointToSource(0, 140).y));
    expect(mapped.y + mapped.height).toBeGreaterThanOrEqual(
      Math.ceil(mapping.pointToSource(150, 160).y)
    );
    expect(middleOfTopSide.y).toBeGreaterThan(mapped.y);
  });

  test("clips a box to the photo", () => {
    const size = { width: 101, height: 101 };
    const mapping = new UnwarpMapping(
      buildGrid((u, v) => [u - 0.5, v]),
      size,
      size
    );

    const mapped = mapping.boxToSource({ x: 0, y: 0, width: 100, height: 100 });

    expect(mapped.x).toBe(0);
    expect(mapped.width).toBe(50);
  });
});
