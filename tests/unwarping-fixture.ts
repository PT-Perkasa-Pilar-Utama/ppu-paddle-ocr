import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { UnwarpGrid } from "../src/core/unwarping/grid.js";
import { remapImage } from "../src/core/unwarping/remap.js";
import { levenshteinDistance } from "../src/utils.js";

const COLUMNS = 31;
const ROWS = 45;

/** A grid whose node (i, j) sits where `place` puts the page point (u, v). */
export function buildGrid(place: (u: number, v: number) => [number, number]): UnwarpGrid {
  const x = new Float32Array(COLUMNS * ROWS);
  const y = new Float32Array(COLUMNS * ROWS);
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLUMNS; i++) {
      const [px, py] = place(i / (COLUMNS - 1), j / (ROWS - 1));
      x[j * COLUMNS + i] = px;
      y[j * COLUMNS + i] = py;
    }
  }
  return { columns: COLUMNS, rows: ROWS, x, y };
}

export const identity: UnwarpGrid = buildGrid((u, v) => [u, v]);

/**
 * The curl used to build the warped fixture: text lines bow by `bow` of the
 * photo height across its width, and the page leans by `shear` of its width
 * from top to bottom. Read as a grid it says, for each pixel of the curled
 * photo, where that pixel sits in the flat original.
 */
export function curl(bow: number, shear: number): UnwarpGrid {
  return buildGrid((u, v) => [
    u + shear * (v - 0.5),
    v + bow * (Math.sin(Math.PI * u) - 2 / Math.PI),
  ]);
}

export function solid(
  width: number,
  height: number,
  rgb: [number, number, number]
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < rgba.length; p += 4) {
    rgba[p] = rgb[0];
    rgba[p + 1] = rgb[1];
    rgba[p + 2] = rgb[2];
    rgba[p + 3] = 255;
  }
  return rgba;
}

/** The receipt fixture, flat and curled, with what it should read as. */
export type ReceiptFixture = {
  /** assets/receipt.jpg as encoded bytes. */
  flat: ArrayBuffer;
  /** The same photo curled by `warp` and enlarged by `curledScale`, as PNG bytes. */
  curled: ArrayBuffer;
  /** For each pixel of the curled photo, where it sits in the flat one. */
  warp: UnwarpGrid;
  /** Size of the curled photo. */
  width: number;
  height: number;
  /** Character accuracy of `text` against the receipt's ground truth, 0..100. */
  accuracy: (text: string) => number;
};

/**
 * Build the curled receipt at test time from the flat asset, so the repo
 * carries no second binary and the curl stays a number a test can change.
 *
 * ponytail: a computed curl stands in for a photo of curled paper. It bends
 * the text lines the way a curl does but has none of a real photo's shading,
 * so it proves the pipeline, not accuracy on real receipts. Add a real photo
 * with ground truth when one can be published.
 */
export async function loadReceiptFixture(curledScale = 1): Promise<ReceiptFixture> {
  const truth = (
    await Bun.file(`${import.meta.dir}/../assets/receipt-ground-truth.txt`).text()
  ).trim();
  const flat = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
  const warp = curl(0.08, 0.05);

  const image = await loadImage(Buffer.from(flat));
  const size = { width: image.width, height: image.height };
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = remapImage(
    ctx.getImageData(0, 0, size.width, size.height).data,
    size,
    warp,
    size,
    // The desk colour of the fixture, for the corners the curl pulls in.
    [201, 150, 100]
  );
  const imageData = ctx.createImageData(size.width, size.height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  // A phone photo is several times larger than the fixture; the enlarged copy
  // takes the path where the stage works on a scaled-down copy.
  const output = createCanvas(size.width * curledScale, size.height * curledScale);
  output.getContext("2d").drawImage(canvas, 0, 0, output.width, output.height);
  const png = output.toBuffer("image/png");
  const curled = new Uint8Array(png.byteLength);
  curled.set(png);

  return {
    flat,
    curled: curled.buffer,
    warp,
    width: output.width,
    height: output.height,
    accuracy: (text) =>
      ((truth.length - levenshteinDistance(text.trim(), truth)) / truth.length) * 100,
  };
}
