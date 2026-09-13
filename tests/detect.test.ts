import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PaddleOcrService } from "../src/processor/paddle-ocr.service.js";

const imageBuffer = await Bun.file(`${import.meta.dir}/../assets/receipt.jpg`).arrayBuffer();
await PaddleOcrService.downloadModels();

describe("detect()", () => {
  const service = new PaddleOcrService();

  beforeAll(async () => {
    await service.initialize();
  });

  afterAll(async () => {
    await service.destroy();
  });

  test("returns bounding boxes without recognition", async () => {
    const result = await service.detect(imageBuffer);

    expect(result.boxes.length).toBeGreaterThan(0);
    expect(result.crops).toBeUndefined();

    for (const box of result.boxes) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
  });

  test("returns PNG crops index-aligned with boxes when crop is true", async () => {
    const result = await service.detect(imageBuffer, { crop: true });

    expect(result.crops).toHaveLength(result.boxes.length);

    const pngMagic = [0x89, 0x50, 0x4e, 0x47];
    for (const crop of result.crops ?? []) {
      expect([...new Uint8Array(crop.slice(0, 4))]).toEqual(pngMagic);
    }
  });

  test("applies per-call detection tuning without touching service defaults", async () => {
    const strict = await service.detect(imageBuffer, {
      minimumAreaThreshold: Number.MAX_SAFE_INTEGER,
    });
    expect(strict.boxes).toHaveLength(0);

    const defaults = await service.detect(imageBuffer);
    expect(defaults.boxes.length).toBeGreaterThan(0);
  });

  test("saves one crop file per box to a custom folder", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ppu-detect-"));

    try {
      const result = await service.detect(imageBuffer, { saveCropsTo: dir });

      expect(result.crops).toBeUndefined();

      const files = await fs.readdir(dir);
      expect(files.length).toBe(result.boxes.length);
      expect(files).toContain("crop_000.png");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("detectionThreshold", () => {
  const service = new PaddleOcrService();

  beforeAll(async () => {
    await service.initialize();
  });

  afterAll(async () => {
    await service.destroy();
  });

  const totalArea = (boxes: Array<{ width: number; height: number }>) =>
    boxes.reduce((sum, box) => sum + box.width * box.height, 0);

  test("defaults to no binarization", async () => {
    // `0` means "leave the probability map alone", so an explicit 0 must be
    // indistinguishable from omitting the option.
    const omitted = await service.detect(imageBuffer);
    const explicit = await service.detect(imageBuffer, { detectionThreshold: 0 });

    expect(omitted.boxes.length).toBeGreaterThan(0);
    expect(explicit.boxes).toEqual(omitted.boxes);
  });

  test("binarizing tightens the detected regions", async () => {
    const all = await service.detect(imageBuffer);
    const cut = await service.detect(imageBuffer, { detectionThreshold: 0.3 });

    // A cut has to leave text behind, not blank the map.
    expect(cut.boxes.length).toBeGreaterThan(0);

    // Only pixels above the cut survive it, so the surviving regions sit
    // closer to the text cores and cover strictly less area. Measured on
    // assets/receipt.jpg: 28 boxes / ~151k px at the default versus 22 boxes /
    // ~121k px at 0.3. A threshold that never reached the map would leave the
    // total exactly equal.
    expect(totalArea(cut.boxes)).toBeLessThan(totalArea(all.boxes));

    // A cut past the sigmoid's saturation is still not a no-op: it keeps only
    // the saturated cores, so the covered area keeps shrinking.
    const saturated = await service.detect(imageBuffer, { detectionThreshold: 0.999 });
    expect(totalArea(saturated.boxes)).toBeLessThan(totalArea(cut.boxes));
  });

  test("does not leak into service defaults", async () => {
    await service.detect(imageBuffer, { detectionThreshold: 0.999 });

    const defaults = await service.detect(imageBuffer);
    expect(defaults.boxes.length).toBeGreaterThan(0);
  });

  test("applies on the canvas-native engine too", async () => {
    const canvasNative = new PaddleOcrService({
      processing: { engine: "canvas-native" },
    });

    try {
      await canvasNative.initialize();

      const all = await canvasNative.detect(imageBuffer);
      const cut = await canvasNative.detect(imageBuffer, { detectionThreshold: 0.999 });

      expect(all.boxes.length).toBeGreaterThan(0);
      expect(totalArea(cut.boxes)).toBeLessThan(totalArea(all.boxes));
    } finally {
      await canvasNative.destroy();
    }
  });
});
