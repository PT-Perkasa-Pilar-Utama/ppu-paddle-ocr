/** Minimal, hand-maintained OpenAPI 3.1 description of the API. */
export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "ppu-paddle-ocr-serve",
    version: "0.1.0",
    description: "REST API serving ppu-paddle-ocr. POST an image, get OCR JSON.",
  },
  paths: {
    "/v1/ocr": {
      post: {
        summary: "Recognize a single image",
        description:
          "multipart/form-data with a `file` field, or JSON `{ source, strategy?, flatten?, engine? }`.",
        responses: { "200": { description: "OCR result" }, "413": { description: "Too large" } },
      },
    },
    "/v1/ocr/batch": {
      post: {
        summary: "Recognize many images",
        description:
          "JSON `{ sources: string[], strategy?, flatten?, engine?, concurrency?, settle? }`.",
        responses: { "200": { description: "Array of results" } },
      },
    },
    "/v1/ocr/stream": {
      post: {
        summary: "Stream batch results (SSE)",
        description: "Same body as /v1/ocr/batch; emits one SSE event per image as it finishes.",
        responses: { "200": { description: "text/event-stream" } },
      },
    },
    "/v1/ocr/async": {
      post: {
        summary: "Enqueue a batch job",
        responses: { "202": { description: "{ taskId, status }" } },
      },
    },
    "/v1/tasks/{id}": {
      get: {
        summary: "Task status",
        responses: { "200": { description: "status" }, "404": { description: "unknown" } },
      },
      delete: { summary: "Cancel a task", responses: { "200": { description: "cancelled" } } },
    },
    "/v1/tasks/{id}/result": {
      get: {
        summary: "Task result",
        responses: { "200": { description: "result" }, "409": { description: "not ready" } },
      },
    },
    "/v1/models": {
      get: {
        summary: "Engines, strategies, defaults",
        responses: { "200": { description: "ok" } },
      },
    },
    "/health": { get: { summary: "Liveness", responses: { "200": { description: "ok" } } } },
    "/ready": {
      get: {
        summary: "Readiness",
        responses: { "200": { description: "ready" }, "503": { description: "loading" } },
      },
    },
    "/metrics": {
      get: { summary: "Prometheus metrics", responses: { "200": { description: "text" } } },
    },
  },
} as const;

/** Scalar API reference UI, loaded from CDN, pointed at /openapi.json. */
export const scalarHtml = `<!doctype html>
<html>
  <head>
    <title>ppu-paddle-ocr-serve — API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
