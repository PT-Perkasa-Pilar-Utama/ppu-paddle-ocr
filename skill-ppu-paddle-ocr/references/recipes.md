# `ppu-paddle-ocr` recipes

Copy-paste recipes for the most common workflows. Each one assumes the matching install (`npm install ppu-paddle-ocr onnxruntime-node` for Node/Bun, `npm install ppu-paddle-ocr onnxruntime-web` for the browser).

## 1. Warm the cache in CI / Docker

First-run model downloads can add 5-15 seconds to a cold container. Pre-fetch them at build time so requests don't pay that latency.

**Dockerfile:**

```dockerfile
FROM oven/bun:1 AS warm
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
RUN bun -e 'import("ppu-paddle-ocr").then(m => m.PaddleOcrService.downloadModels({ verbose: true }))'

FROM oven/bun:1
WORKDIR /app
COPY --from=warm /root/.cache/ppu-paddle-ocr /root/.cache/ppu-paddle-ocr
COPY --from=warm /app/node_modules ./node_modules
COPY . .
CMD ["bun", "run", "server.ts"]
```

**Inline in a Bun script:**

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";
await PaddleOcrService.downloadModels({ verbose: true });
console.log("Models cached. Subsequent initialize() calls hit the cache.");
```

`downloadModels` is **static** - call it on the class.

---

## 2. Long-running server: one warm service per process

The single biggest performance win for a server is initializing once at boot and sharing that instance across all requests.

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";
import { Hono } from "hono";

const ocr = new PaddleOcrService({
  recognition: { strategy: "per-line" },
});
await ocr.initialize();
console.log("OCR ready");

const app = new Hono();

app.post("/ocr", async (c) => {
  const buf = await c.req.arrayBuffer();
  const result = await ocr.recognize(buf, { flatten: true });
  return c.json(result);
});

const handleShutdown = async () => {
  await ocr.destroy();
  process.exit(0);
};
process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);

export default app;
```

**Don't** call `service.destroy()` per request. Each `initialize()` rebuilds two ONNX sessions from disk - multi-second cost.

---

## 3. Switching languages mid-process

Keep the detection session warm, swap just the recognition model and dictionary.

```ts
const MODEL =
  "https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";
const DICT =
  "https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/refs/heads/main";

const service = new PaddleOcrService();
await service.initialize();

// English (default) - process the first batch
for (const img of englishBatch) await service.recognize(img);

// Switch to Thai
await service.changeRecognitionModel(
  `${MODEL}/recognition/multi/thai/v5/th_PP-OCRv5_mobile_rec_infer.onnx`
);
await service.changeTextDictionary(`${DICT}/recognition/multi/thai/v5/ppocrv5_th_dict.txt`);

for (const img of thaiBatch) await service.recognize(img);
```

If the language batch is short and called once, prefer per-call overrides instead - `recognize(img, { dictionary: thaiDict })` - since it doesn't rebuild the recognition session.

If the language is known per request and you have many concurrent requests, run **two services** (one per language) instead of swapping - swapping is racy under concurrency.

---

## 4. INT8 quantization for x86-64 / WASM throughput

Recognition matmuls dynamically quantize to INT8 with no measured accuracy loss on receipts (99.22% -> 99.22%) and 20-50% speedup on CPUs with VNNI and on WebAssembly.

Generate the quantized recognition model once (Python):

```bash
pip install onnxruntime onnx sympy
python examples/quantize-onnx.py /path/to/en_PP-OCRv5_mobile_rec_infer.onnx
# -> en_PP-OCRv5_mobile_rec_infer_int8.onnx
```

Use it:

```ts
const service = new PaddleOcrService({
  model: {
    recognition: "https://example.com/en_PP-OCRv5_mobile_rec_infer_int8.onnx",
    // detection and dictionary stay default
  },
});
```

**Do not use INT8 on Apple Silicon** - the FP32 NEON/Accelerate kernels outperform the INT8 MLAS path. Restrict INT8 deployment to x86-64 (preferably with VNNI) and to WASM browser builds.

INT8 `.ort` variants are also published in [ppu-paddle-ocr-models](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models).

---

## 5. WebGPU benchmarking on the browser

WebGPU runs by default when supported. To compare WebGPU vs WASM head-to-head on the same machine:

```ts
import { PaddleOcrService, isWebGpuAvailable } from "ppu-paddle-ocr/web";

const buf = await (await fetch("/sample.jpg")).arrayBuffer();

async function bench(label: string, sessionOpts?: any) {
  const svc = new PaddleOcrService({ session: sessionOpts });
  await svc.initialize();
  // warm-up
  await svc.recognize(buf);
  const N = 20;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) await svc.recognize(buf, { noCache: true });
  const dt = (performance.now() - t0) / N;
  console.log(`${label}: ${dt.toFixed(1)} ms/iter`);
  await svc.destroy();
}

if (await isWebGpuAvailable()) await bench("webgpu");
await bench("wasm", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
```

Key gotchas:

- Use `noCache: true` in the timing loop, otherwise you're measuring cache hits.
- Always warm up first - first inference includes graph optimization and kernel compilation.
- Detection runs once during `initialize()` setup but the session is reused - don't include `initialize()` in the per-iter timing.

---

## 6. Persistent model cache in the browser (IndexedDB)

The web build re-fetches models on every page load. For real offline / cold-start performance, cache them yourself in IndexedDB and hand `ArrayBuffer`s to the service.

```ts
import { PaddleOcrService, DEFAULT_MODEL_URLS } from "ppu-paddle-ocr/web";

async function fetchOrCache(key: string, url: string): Promise<ArrayBuffer> {
  const db = await openDB("ppu-paddle-ocr-models", 1, {
    upgrade(db) {
      db.createObjectStore("blobs");
    },
  });
  const cached = await db.get("blobs", key);
  if (cached) return cached;
  const buf = await (await fetch(url)).arrayBuffer();
  await db.put("blobs", buf, key);
  return buf;
}

const [det, rec, dict] = await Promise.all([
  fetchOrCache("det", DEFAULT_MODEL_URLS.detection),
  fetchOrCache("rec", DEFAULT_MODEL_URLS.recognition),
  fetchOrCache("dict", DEFAULT_MODEL_URLS.charactersDictionary),
]);

const service = new PaddleOcrService({
  model: { detection: det, recognition: rec, charactersDictionary: dict },
});
await service.initialize();
```

`DEFAULT_MODEL_URLS` is exported precisely so you can rebuild this flow without hardcoding the URLs.

---

## 7. Batch a directory on Bun

```ts
import { PaddleOcrService } from "ppu-paddle-ocr";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const dir = "./assets/receipts";
const service = new PaddleOcrService({ recognition: { strategy: "cross-line" } });
await service.initialize();

const files = (await readdir(dir)).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));

for (const file of files) {
  const buf = await Bun.file(join(dir, file)).arrayBuffer();
  const t0 = performance.now();
  const result = await service.recognize(buf, { noCache: true });
  console.log(
    `${file}: ${(performance.now() - t0).toFixed(0)}ms / conf ${(result.confidence * 100).toFixed(1)}%`
  );
  await Bun.write(join("./out", file.replace(/\.\w+$/, ".txt")), result.text);
}

await service.destroy();
```

`cross-line` is usually the right strategy for batch processing - fewer inferences per image at a small accuracy cost most receipts can absorb.

---

## 8. Custom dictionary for a domain (e.g. SKU codes only)

Restricting the alphabet improves accuracy on domain-specific content (license plates, SKUs, lottery tickets). The dictionary file is one character per line, with a **trailing newline**.

```ts
// custom-dict.txt:
//   0
//   1
//   2
//   ...
//   9
//   A
//   B
//   ...
//   Z
//   -
//
// (note the empty trailing line!)

const service = new PaddleOcrService({
  model: {
    charactersDictionary: "./models/sku-dict.txt",
    // recognition model still uses the default English checkpoint
  },
});
await service.initialize();
```

Or per-call:

```ts
const result = await service.recognize(buf, { dictionary: "./models/sku-dict.txt" });
```

Per-call dictionaries disable the result cache - every call re-runs recognition.

---

## 9. Debugging accuracy issues

When accuracy is unexpectedly low on a specific image, dump intermediate frames and inspect.

```ts
const service = new PaddleOcrService({
  debugging: { verbose: true, debug: true, debugFolder: "./out/debug-2026-05-14" },
});
await service.initialize();
await service.recognize("/abs/path/to/problem-image.jpg", { noCache: true });
await service.destroy();
```

Look at `./out/debug-2026-05-14/` for:

- The preprocessed detection input (is the image too dark? too small?)
- The detection probability mask (is text being missed at the edges?)
- Each cropped recognition input (are crops too tight? rotated?)

Common fixes once you've inspected:

- Crops too tight -> bump `detection.paddingHorizontal` to `0.8` or `paddingVertical` to `0.6`.
- Whole regions missed -> raise `detection.maxSideLength` to `960`+.
- Image too dark / low contrast -> preprocess with `ppu-ocv` (`grayscale().blur().threshold()`) before passing to `recognize()`.
- Garbled output on non-English text -> wrong language model. Switch the recognition model and dictionary (recipe 3).

`debug: true` only works on Node/Bun - browsers can't write to disk.

---

## 10. Graceful shutdown / resource cleanup

The pattern that handles SIGTERM, SIGINT, and uncaught errors without leaking ONNX sessions:

```ts
const service = new PaddleOcrService();
await service.initialize();

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await service.destroy();
  } catch (e) {
    console.error("destroy failed", e);
  }
  process.exit(code);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("uncaughtException", (e) => {
  console.error(e);
  shutdown(1);
});
process.on("unhandledRejection", (e) => {
  console.error(e);
  shutdown(1);
});
```

Without this, `kill -TERM` leaves the ONNX runtime holding native memory until the process is force-killed - annoying in container orchestrators that wait for clean exits.
