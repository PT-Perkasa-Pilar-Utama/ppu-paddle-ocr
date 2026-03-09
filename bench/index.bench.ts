import { bench, run, summary } from "mitata";
import { PaddleOcrService } from "../src";

const service = new PaddleOcrService();

await service.initialize();

const imgFile = Bun.file(import.meta.dir + "/../assets/receipt.jpg");
const deskewFile = Bun.file(import.meta.dir + "/../assets/tilted.png");

const fileBuffer = await imgFile.arrayBuffer();
const deskewBuffer = await deskewFile.arrayBuffer();

summary(() => {
  bench("cached infer", async () => await service.recognize(fileBuffer));
});

summary(() => {
  bench(
    "no cache infer",
    async () => await service.recognize(fileBuffer, { noCache: true }),
  );
});

summary(() => {
  bench("deskew img", async () => await service.deskewImage(deskewBuffer));
});

run().then((_) => {
  service.destroy();
});
