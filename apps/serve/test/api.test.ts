import { describe, expect, test } from "bun:test";
import { app } from "../src/app.js";
import { config } from "../src/core/config.js";

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

  test("https host outside the allowlist is rejected, subdomains of an entry pass the host check", async () => {
    // The allowlist is read from env at boot; push an entry for this test and
    // remove it after so the empty-allowlist tests above stay valid.
    config.sourceUrlAllowlist.push("cdn.example.org");
    try {
      const other = await expectError(
        await app.request("/v1/ocr", json({ source: "https://evil.example.com/a.jpg" })),
        400
      );
      expect(other.data.message).toContain("not in SOURCE_URL_ALLOWLIST");

      // A subdomain clears the host check and reaches fetch(), which fails on
      // the unresolvable host: an upstream failure, reported as 502 with the
      // host named, never a 500.
      const sub = await expectError(
        await app.request("/v1/ocr", json({ source: "https://img.cdn.example.org/a.jpg" })),
        502
      );
      expect(sub.data.message).toContain("img.cdn.example.org");
    } finally {
      config.sourceUrlAllowlist.pop();
    }
  });

  test("malformed https source is 400, not a crash", async () => {
    const body = await expectError(await app.request("/v1/ocr", json({ source: "https://" })), 400);
    expect(body.data.message).toContain("Invalid source URL");
  });

  test("malformed data: URI without a comma is 400", async () => {
    const body = await expectError(
      await app.request("/v1/ocr", json({ source: "data:image/png;base64" })),
      400
    );
    expect(body.data.message).toContain("Malformed data: URI");
  });

  test("a tiny non-image data: URI is rejected as unsupported type", async () => {
    const body = await expectError(
      await app.request("/v1/ocr", json({ source: "data:text/plain;base64,aGVsbG8gd29ybGQ=" })),
      400
    );
    expect(body.data.message).toContain("Unsupported image type");
  });

  test("malformed JSON on a validated route is 400, not 500", async () => {
    const res = await app.request("/v1/ocr/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    const body = await expectError(res, 400);
    expect(body.data.message).toContain("JSON");
  });

  test("multipart without a file field is 400", async () => {
    const form = new FormData();
    form.append("strategy", "per-line");
    await expectError(await app.request("/v1/ocr", { method: "POST", body: form }), 400);
  });
});

describe("unwarping (server started without UNWARPING_ENABLED)", () => {
  // A 1x1 PNG: it passes the image sniff, and the request is rejected before
  // any model loads.
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  test("is off by default and GET /v1/models reports it", async () => {
    expect(config.unwarpingEnabled).toBe(false);
    const body = await (await app.request("/v1/models")).json();
    expect(body.data.unwarping).toEqual({ enabled: false });
  });

  const jsonRoutes = [
    ["/v1/ocr", { source: pixel }],
    ["/v1/detect", { source: pixel }],
    ["/v1/ocr/batch", { sources: [pixel] }],
    ["/v1/ocr/stream", { sources: [pixel] }],
    ["/v1/ocr/async", { sources: [pixel] }],
  ] as const;

  test.each(jsonRoutes)(
    "unwarp: true on %s is a 400 that names the setting",
    async (path, body) => {
      const res = await app.request(path, json({ ...body, unwarp: true }));
      expect(res.status).toBe(400);
      const error = await res.json();
      expect(error.status).toBe("error");
      expect(error.data.message).toContain("UNWARPING_ENABLED=true");
      expect(error.data.requestId).toBeString();
    }
  );

  test("unwarp: true as a multipart field is a 400 on /v1/ocr and /v1/detect", async () => {
    for (const path of ["/v1/ocr", "/v1/detect"]) {
      const form = new FormData();
      form.append("file", new File([Buffer.from(pixel.split(",")[1] ?? "", "base64")], "p.png"));
      form.append("unwarp", "true");
      const res = await app.request(path, { method: "POST", body: form });
      expect(res.status).toBe(400);
      expect((await res.json()).data.message).toContain("UNWARPING_ENABLED=true");
    }
  });

  test("a non-boolean unwarp is a validation error", async () => {
    const res = await app.request("/v1/ocr", json({ source: pixel, unwarp: "yes" }));
    expect(res.status).toBe(400);
    expect((await res.json()).data.message).toContain("unwarp");
  });
});
