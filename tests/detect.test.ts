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
