import { beforeAll, describe, expect, test } from "bun:test";
import { Contours, ImageProcessor, cv } from "ppu-ocv";
import { extractBoxesFromContours } from "../src/core/detection/box-geometry.js";

/**
 * Each contour that `Contours.iterate` hands out is a new cv.Mat on the
 * OpenCV WASM heap, and the garbage collector never frees it. A leaked
 * contour per detection call filled the 1 GiB heap after a few thousand
 * pages in a long-running process.
 *
 * @see https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/issues/163
 */

beforeAll(async () => {
  await ImageProcessor.initRuntime();
});

describe("extractBoxesFromContours", () => {
  test("frees every contour, including the ones below minBoxArea", () => {
    const map = new cv.Mat(100, 100, cv.CV_8UC1, new cv.Scalar(0));
    // A 40x20 blob that becomes a box, and a 3x3 blob below minBoxArea.
    cv.rectangle(map, new cv.Point(10, 10), new cv.Point(49, 29), new cv.Scalar(255), -1);
    cv.rectangle(map, new cv.Point(80, 80), new cv.Point(82, 82), new cv.Scalar(255), -1);

    const contours = new Contours(map, { mode: cv.RETR_LIST, method: cv.CHAIN_APPROX_SIMPLE });
    const handedOut: cv.Mat[] = [];
    const iterate = contours.iterate.bind(contours);
    contours.iterate = (callback) =>
      iterate((contour: cv.Mat) => {
        handedOut.push(contour);
        callback(contour);
      });

    try {
      const boxes = extractBoxesFromContours(contours, 100, 100, 1, 100, 100, 20, 0, 0);

      expect(boxes).toEqual([{ x: 10, y: 10, width: 40, height: 20 }]);
      expect(handedOut).toHaveLength(2);
      expect(handedOut.every((contour) => contour.isDeleted())).toBe(true);
    } finally {
      contours.destroy();
      map.delete();
    }
  });
});
