import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sampleGrid } from "../src/core/unwarping/grid.js";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";
import type { ReceiptFixture } from "./unwarping-fixture.js";
import { curl, loadReceiptFixture } from "./unwarping-fixture.js";

describe("unwarping in the OCR pipeline", () => {
  const service = new PaddleOcrService({ unwarping: { enabled: true } });
  let photo: ReceiptFixture;
  const accuracy = (text: string): number => photo.accuracy(text);
  const warp = curl(0.08, 0.05);

  beforeAll(async () => {
    photo = await loadReceiptFixture();
    await service.initialize();
  }, 30000);

  afterAll(async () => {
    await service.destroy();
  });

  test("reads a curled receipt that is unreadable without it", async () => {
    const off = await service.recognize(photo.curled, { noCache: true, unwarp: false });
    const on = await service.recognize(photo.curled, { noCache: true });

    console.log(
      `curled receipt accuracy: ${accuracy(off.text).toFixed(1)}% off, ${accuracy(on.text).toFixed(1)}% on`
    );
    expect(accuracy(off.text)).toBeLessThan(60);
    expect(accuracy(on.text)).toBeGreaterThan(90);
  }, 60000);

  test("leaves a flat receipt untouched", async () => {
    const stage = await service.unwarp(photo.flat);
    const off = await service.recognize(photo.flat, { noCache: true, unwarp: false });
    const on = await service.recognize(photo.flat, { noCache: true });

    expect(stage.status).toBe("skipped");
    expect(on.text).toBe(off.text);
    expect(accuracy(on.text)).toBeGreaterThan(95);
  }, 60000);

  test("returns boxes in the coordinates of the photo that was passed in", async () => {
    const flat = await service.recognize(photo.flat, {
      noCache: true,
      unwarp: false,
      flatten: true,
    });
    const curled = await service.recognize(photo.curled, { noCache: true, flatten: true });
    const find = (
      items: { text: string; box: { x: number; y: number; width: number; height: number } }[]
    ) => items.find((item) => item.text.includes("NPWP"));
    const onFlat = find(flat.results);
    const onCurled = find(curled.results);
    if (!onFlat || !onCurled) throw new Error("fixture line not recognized");

    // The curl grid says where a pixel of the curled photo sits in the flat
    // original, so it carries the curled box centre to the flat photo, where
    // the same line was found without any unwarping.
    const centre = sampleGrid(
      warp,
      (onCurled.box.x + onCurled.box.width / 2) / (photo.width - 1),
      (onCurled.box.y + onCurled.box.height / 2) / (photo.height - 1)
    );
    expect(
      Math.abs(centre.x * (photo.width - 1) - (onFlat.box.x + onFlat.box.width / 2))
    ).toBeLessThan(25);
    expect(
      Math.abs(centre.y * (photo.height - 1) - (onFlat.box.y + onFlat.box.height / 2))
    ).toBeLessThan(25);
  }, 60000);

  test("maps boxes back to a photo larger than the crop-source cap", async () => {
    const scale = 3;
    const large = await loadReceiptFixture(scale);
    const flat = await service.recognize(photo.flat, {
      noCache: true,
      unwarp: false,
      flatten: true,
    });

    const started = performance.now();
    const curled = await service.recognize(large.curled, { noCache: true, flatten: true });
    console.log(
      `${large.width}x${large.height} curled photo: ${Math.round(performance.now() - started)} ms end to end`
    );

    const onFlat = flat.results.find((item) => item.text.includes("NPWP"));
    const onCurled = curled.results.find((item) => item.text.includes("NPWP"));
    if (!onFlat || !onCurled) throw new Error("fixture line not recognized");
    // The stage read a 2000 px copy; the box must still be in pixels of the
    // 3x photo. Its centre, carried through the curl, lands on the flat line.
    const centre = sampleGrid(
      warp,
      (onCurled.box.x + onCurled.box.width / 2) / (large.width - 1),
      (onCurled.box.y + onCurled.box.height / 2) / (large.height - 1)
    );
    expect(large.accuracy(curled.text)).toBeGreaterThan(90);
    expect(
      Math.abs(centre.x * (photo.width - 1) - (onFlat.box.x + onFlat.box.width / 2))
    ).toBeLessThan(25);
    expect(
      Math.abs(centre.y * (photo.height - 1) - (onFlat.box.y + onFlat.box.height / 2))
    ).toBeLessThan(25);
  }, 60000);

  test("detect() maps boxes back and cuts crops from the flattened page", async () => {
    const result = await service.detect(photo.curled, { crop: true });

    expect(result.boxes.length).toBeGreaterThan(5);
    expect(result.crops).toHaveLength(result.boxes.length);
    for (const box of result.boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(photo.width);
      expect(box.y + box.height).toBeLessThanOrEqual(photo.height);
    }
  }, 60000);

  test("keeps cached results apart by stage and by result shape", async () => {
    const off = await service.recognize(photo.curled, { unwarp: false });
    const on = await service.recognize(photo.curled);
    const flattened = await service.recognize(photo.curled, { flatten: true });
    const grouped = await service.recognize(photo.curled);

    expect(on.text).not.toBe(off.text);
    expect(flattened.results.length).toBeGreaterThan(0);
    expect(grouped.lines.length).toBeGreaterThan(0);
    expect(grouped).toBe(on);
  }, 60000);

  test("a flattened first call leaves a grouped result for the next call", async () => {
    const flattened = await service.recognize(photo.flat, { unwarp: false, flatten: true });
    const grouped = await service.recognize(photo.flat, { unwarp: false });

    expect(flattened.results.length).toBeGreaterThan(0);
    expect(grouped.lines.flat()).toHaveLength(flattened.results.length);
  }, 60000);
});

describe("unwarping without the model", () => {
  const service = new PaddleOcrService();
  const image = { buffer: new ArrayBuffer(0) };

  beforeAll(async () => {
    image.buffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
    await service.initialize();
  }, 30000);

  afterAll(async () => {
    await service.destroy();
  });

  test("a call that asks for unwarping fails with the fix in the message", async () => {
    const message = /unwarping: \{ enabled: true \}/;

    expect(service.recognize(image.buffer, { unwarp: true })).rejects.toThrow(message);
    expect(service.detect(image.buffer, { unwarp: true })).rejects.toThrow(message);
    expect(service.unwarp(image.buffer)).rejects.toThrow(message);
  });
});
