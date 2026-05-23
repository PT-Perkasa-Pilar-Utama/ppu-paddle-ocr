import { describe, expect, test } from "bun:test";
import { app } from "../src/app.js";

const json = (body: unknown) =>
  ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as const;

describe("response envelope + system routes", () => {
  test("GET /health is an enveloped success with a request id", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.version).toBeString();
    expect(body.metadata.id).toBeString();
    expect(body.data).toEqual({ alive: true });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  test("GET /ready is a 503 error envelope before models are warmed", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.data.message).toContain("loading");
    expect(body.data.requestId).toBeString();
  });

  test("GET /v1/models returns enveloped data", async () => {
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data.engines).toContain("opencv");
    expect(body.data.strategies).toContain("per-line");
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

  test("unknown route is a 404 error envelope", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.data.message).toBe("Route not found");
  });
});

describe("POST /v1/ocr input validation (pre-inference)", () => {
  const expectError = async (res: Response, status: number) => {
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.data.message).toBeString();
    expect(body.data.requestId).toBeString();
    return body;
  };

  test("invalid JSON body is 400", async () => {
    const res = await app.request("/v1/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    await expectError(res, 400);
  });

  test("missing source is 400", async () => {
    await expectError(await app.request("/v1/ocr", json({ strategy: "per-line" })), 400);
  });

  test("local filesystem path source is rejected", async () => {
    await expectError(await app.request("/v1/ocr", json({ source: "/etc/passwd" })), 400);
  });

  test("http (non-https) source is rejected", async () => {
    await expectError(
      await app.request("/v1/ocr", json({ source: "http://example.com/a.jpg" })),
      400
    );
  });

  test("https source is rejected when the allowlist is empty (default)", async () => {
    const body = await expectError(
      await app.request("/v1/ocr", json({ source: "https://example.com/a.jpg" })),
      400
    );
    expect(body.data.message).toContain("SOURCE_URL_ALLOWLIST");
  });

  test("a tiny non-image data: URI is rejected as unsupported type", async () => {
    const body = await expectError(
      await app.request("/v1/ocr", json({ source: "data:text/plain;base64,aGVsbG8gd29ybGQ=" })),
      400
    );
    expect(body.data.message).toContain("Unsupported image type");
  });

  test("multipart without a file field is 400", async () => {
    const form = new FormData();
    form.append("strategy", "per-line");
    await expectError(await app.request("/v1/ocr", { method: "POST", body: form }), 400);
  });
});
