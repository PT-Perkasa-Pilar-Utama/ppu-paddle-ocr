import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PaddleOcrService } from "ppu-paddle-ocr";
import { app } from "../src/app.js";
import { shutdownService } from "../src/lib/service.js";

const receipt = await Bun.file(`${import.meta.dir}/../../../assets/receipt.jpg`).arrayBuffer();
const dataUri = `data:image/jpeg;base64,${Buffer.from(receipt).toString("base64")}`;

const json = (body: unknown) =>
  ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as const;

const upload = () => {
  const form = new FormData();
  form.append("file", new File([receipt], "receipt.jpg", { type: "image/jpeg" }));
  return { method: "POST", body: form } as const;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeAll(async () => {
  await PaddleOcrService.downloadModels();
  // Warm the lazily-created service so per-test timeouts aren't hit by init.
  await app.request("/v1/ocr", upload());
}, 60_000);

afterAll(async () => {
  await shutdownService();
});

describe("POST /v1/ocr (success)", () => {
  test("multipart upload returns an enveloped result with metadata", async () => {
    const res = await app.request("/v1/ocr", upload());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data.text).toBeString();
    expect(body.data.text.length).toBeGreaterThan(0);
    expect(body.metadata.id).toBeString();
    expect(body.metadata.confidence).toBeGreaterThan(0);
    expect(body.metadata.speed).toBeGreaterThan(0);
    expect(body.metadata.engine).toBe("opencv");
  });

  test("JSON data: URI source works", async () => {
    const res = await app.request("/v1/ocr", json({ source: dataUri, flatten: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(Array.isArray(body.data.results)).toBe(true);
  });
});

describe("POST /v1/ocr/batch", () => {
  test("returns one result per source", async () => {
    const res = await app.request("/v1/ocr/batch", json({ sources: [dataUri, dataUri] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data.results).toHaveLength(2);
  });

  test("empty sources array is a validation error", async () => {
    const res = await app.request("/v1/ocr/batch", json({ sources: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe("error");
  });
});

describe("POST /v1/ocr/stream", () => {
  test("emits one SSE event per image then done", async () => {
    const res = await app.request("/v1/ocr/stream", json({ sources: [dataUri, dataUri] }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect((text.match(/event: fulfilled/g) ?? []).length).toBe(2);
    expect(text).toContain("event: done");
  });
});

describe("async tasks lifecycle", () => {
  test("submit → poll → result", async () => {
    const submit = await app.request("/v1/ocr/async", json({ sources: [dataUri] }));
    expect(submit.status).toBe(202);
    const { data } = await submit.json();
    expect(data.taskId).toBeString();

    let status = "queued";
    for (let i = 0; i < 30 && status !== "done"; i++) {
      const s = await app.request(`/v1/tasks/${data.taskId}`);
      status = (await s.json()).data.status;
      if (status !== "done") await sleep(100);
    }
    expect(status).toBe("done");

    const result = await app.request(`/v1/tasks/${data.taskId}/result`);
    expect(result.status).toBe(200);
    expect((await result.json()).data.results).toHaveLength(1);
  });

  test("unknown task id is 404 for status and result", async () => {
    const id = crypto.randomUUID();
    expect((await app.request(`/v1/tasks/${id}`)).status).toBe(404);
    expect((await app.request(`/v1/tasks/${id}/result`)).status).toBe(404);
  });

  test("DELETE cancels a task", async () => {
    const submit = await app.request("/v1/ocr/async", json({ sources: [dataUri] }));
    const { data } = await submit.json();
    const del = await app.request(`/v1/tasks/${data.taskId}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await del.json()).data.status).toBe("cancelled");
  });
});
