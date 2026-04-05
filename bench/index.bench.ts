import { bench, run, summary } from "mitata";
import { PaddleOcrService } from "../src";

const service = new PaddleOcrService();

await service.initialize();

const imgFile = Bun.file(import.meta.dir + "/../assets/receipt.jpg");

const fileBuffer = await imgFile.arrayBuffer();

summary(() => {
  bench("cached infer", async () => await service.recognize(fileBuffer));
});

summary(() => {
  bench(
    "no cache infer",
    async () => await service.recognize(fileBuffer, { noCache: true }),
  );
});

run().then((_) => {
  service.destroy();
});
