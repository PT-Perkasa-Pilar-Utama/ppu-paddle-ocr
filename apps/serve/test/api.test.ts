import { describe, expect, test } from "bun:test";
import { app } from "../src/app.js";

const json = (body: unknown) =>
  ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as const;

describe("system routes", () => {
  test("GET /health is 200 ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /ready is 503 before models are warmed", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("not_ready");
  });

  test("GET /v1/models lists engines, strategies, defaults", async () => {
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engines).toContain("opencv");
    expect(body.strategies).toContain("per-line");
    expect(body.default).toHaveProperty("engine");
  });

  test("GET /metrics returns Prometheus text", async () => {
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ppu_ocr_model_ready");
  });

  test("GET /openapi.json and /docs are served", async () => {
    expect((await app.request("/openapi.json")).status).toBe(200);
    expect((await app.request("/docs")).status).toBe(200);
  });

  test("unknown route is a 404 envelope", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("POST /v1/ocr input validation (pre-inference)", () => {
  test("invalid JSON body is 400", async () => {
    const res = await app.request("/v1/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  test("missing source is a validation error", async () => {
    const res = await app.request("/v1/ocr", json({ strategy: "per-line" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_error");
  });

  test("local filesystem path source is rejected", async () => {
    const res = await app.request("/v1/ocr", json({ source: "/etc/passwd" }));
    expect(res.status).toBe(400);
  });

  test("http (non-https) source is rejected", async () => {
    const res = await app.request("/v1/ocr", json({ source: "http://example.com/a.jpg" }));
    expect(res.status).toBe(400);
  });

  test("https source is rejected when the allowlist is empty (default)", async () => {
    const res = await app.request("/v1/ocr", json({ source: "https://example.com/a.jpg" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("SOURCE_URL_ALLOWLIST");
  });

  test("multipart without a file field is 400", async () => {
    const form = new FormData();
    form.append("strategy", "per-line");
    const res = await app.request("/v1/ocr", { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  test("bad strategy enum is a validation error", async () => {
    const res = await app.request("/v1/ocr", json({ source: "data:,x", strategy: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_error");
  });
});
