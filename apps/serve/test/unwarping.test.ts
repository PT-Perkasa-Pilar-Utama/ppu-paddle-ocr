import { afterAll, describe, expect, test } from "bun:test";
import { PaddleOcrService } from "ppu-paddle-ocr";
import { loadReceiptFixture } from "../../../tests/unwarping-fixture.js";

// The config is read once per process, so the enabled case runs against a real
// server started with UNWARPING_ENABLED=true. That also covers the model
// loading at startup, which an in-process app.request() test cannot.
const free = Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { data() {} } });
const port = free.port;
free.stop(true);
const base = `http://127.0.0.1:${port}`;

const server = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: `${import.meta.dir}/..`,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    UNWARPING_ENABLED: "true",
    RATE_LIMIT_ENABLED: "false",
    SECRET_KEY: "",
  },
  stdout: "ignore",
  stderr: "ignore",
});

afterAll(async () => {
  server.kill("SIGTERM");
  await server.exited;
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const toDataUri = (bytes: ArrayBuffer, mime: string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

const photo = await loadReceiptFixture();
const flat = toDataUri(photo.flat, "image/jpeg");
const curled = toDataUri(photo.curled, "image/png");

describe("server started with UNWARPING_ENABLED=true", () => {
  // Models load inside a test, not a hook: CI's Bun rejects a hook timeout.
  test("warms the unwarping model at startup and reports it", async () => {
    await PaddleOcrService.downloadModels({ unwarping: true });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await fetch(`${base}/ready`)
        .then((r) => r.ok)
        .catch(() => false);
      if (!ready) await sleep(500);
    }
    expect(ready).toBe(true);
    const models = await (await fetch(`${base}/v1/models`)).json();
    expect(models.data.unwarping).toEqual({ enabled: true });
  }, 60_000);

  test("a request that omits unwarp uses the server default (on)", async () => {
    const res = await post("/v1/ocr", { source: curled });
    expect(res.status).toBe(200);
    expect(photo.accuracy((await res.json()).data.text)).toBeGreaterThan(90);
  }, 60_000);

  test("unwarp: false overrides the default for that request", async () => {
    const res = await post("/v1/ocr", { source: curled, unwarp: false });
    expect(res.status).toBe(200);
    expect(photo.accuracy((await res.json()).data.text)).toBeLessThan(60);
  }, 60_000);

  test("unwarp: true is accepted on detect, batch, stream, and async", async () => {
    const detect = await post("/v1/detect", { source: flat, unwarp: true });
    expect(detect.status).toBe(200);
    expect((await detect.json()).data.boxes.length).toBeGreaterThan(0);

    const batch = await post("/v1/ocr/batch", { sources: [curled], unwarp: true });
    expect(batch.status).toBe(200);
    const { results } = (await batch.json()).data;
    expect(photo.accuracy(results[0].text)).toBeGreaterThan(90);

    const stream = await post("/v1/ocr/stream", { sources: [flat], unwarp: true });
    expect(stream.status).toBe(200);
    const text = await stream.text();
    expect(text).toContain("event: fulfilled");
    expect(text).toContain("event: done");

    const queued = await post("/v1/ocr/async", { sources: [flat], unwarp: true });
    expect(queued.status).toBe(202);
  }, 120_000);
});
