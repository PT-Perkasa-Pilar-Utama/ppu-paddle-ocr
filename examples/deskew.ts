import { mkdirSync, writeFileSync } from "fs";
import { PaddleOcrService } from "../src";
// import { PaddleOcrService } from "ppu-paddle-ocr";

const service = new PaddleOcrService({
  debugging: {
    debug: true,
    verbose: true,
  },
});
await service.initialize();

const imagePath = import.meta.dir + "/../assets/tilted.png";
const imgFile = Bun.file(imagePath);
const fileBuffer = await imgFile.arrayBuffer();

const startTime = Date.now();
const result = await service.deskewImage(fileBuffer);
const speed = Date.now() - startTime;

const outDir = "./out";
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/deskewed.png`, result.toBuffer("image/png"));

service.destroy();

console.log(`Operation completed in ${speed} ms`);
