import { bench, run, summary } from "mitata";
import { PaddleOcrService } from "../src";

const opencvService = new PaddleOcrService({
  processing: { engine: "opencv" },
});

const canvasService = new PaddleOcrService({
  processing: { engine: "canvas-native" },
});

await opencvService.initialize();
await canvasService.initialize();

const imgFile = Bun.file(import.meta.dir + "/../assets/receipt.jpg");

const fileBuffer = await imgFile.arrayBuffer();

// Warm up both services so first-run overhead doesn't skew results
await opencvService.recognize(fileBuffer, { noCache: true });
await canvasService.recognize(fileBuffer, { noCache: true });

summary(() => {
  bench("cached infer", async () => await opencvService.recognize(fileBuffer));
});

summary(() => {
  bench(
    "opencv: no cache",
    async () => await opencvService.recognize(fileBuffer, { noCache: true }),
  );

  bench(
    "canvas-native: no cache",
    async () => await canvasService.recognize(fileBuffer, { noCache: true }),
  );
});

run().then((_) => {
  opencvService.destroy();
  canvasService.destroy();
});
