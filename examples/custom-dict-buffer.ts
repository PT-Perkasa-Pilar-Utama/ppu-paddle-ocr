import { PaddleOcrService } from "../src";
// import { PaddleOcrService } from "ppu-paddle-ocr";

import dict from "../examples/custom-dict.txt" with { type: "file" };

const service = new PaddleOcrService({
  debugging: {
    debug: true,
    verbose: true,
  },
  model: {
    charactersDictionary: await Bun.file(dict).arrayBuffer(),
  },
});
await service.initialize();

const imagePath = `${import.meta.dir}/../assets/receipt.jpg`;
const imgFile = Bun.file(imagePath);
const fileBuffer = await imgFile.arrayBuffer();

const startTime = Date.now();
const result = await service.recognize(fileBuffer);
const speed = Date.now() - startTime;

service.destroy();

console.log(JSON.stringify(result, null, 2));
console.log(`Operation completed in ${speed} ms`);
