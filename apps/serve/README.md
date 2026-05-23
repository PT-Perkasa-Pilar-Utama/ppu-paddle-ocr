# ppu-paddle-ocr-serve

Production-grade REST API around [`ppu-paddle-ocr`](../../README.md) — Hono + Bun, dockerized. Pull the image, `docker run`, POST an image, get OCR JSON.

```bash
# Pull the published image…
docker run -p 8080:8080 ghcr.io/pt-perkasa-pilar-utama/ppu-paddle-ocr/serve:latest
# …or build locally:
docker compose -f apps/serve/docker-compose.yml up --build

curl -F file=@receipt.jpg http://localhost:8080/v1/ocr
```

Images are built and published to GitHub Container Registry on each release (slimmed with docker-slim). A CUDA image is built from `Dockerfile.cuda`.

## Why

The library is a building block; this wraps it as a service you'd be comfortable running in production: one warmed `PaddleOcrService` shared behind a **bounded inference queue** (no OOM, no VRAM blow-up), graceful lifecycle, optional auth, Prometheus metrics, and OpenAPI docs.

## Endpoints

| Method | Path                      | Purpose                                                        |
| ------ | ------------------------- | -------------------------------------------------------------- |
| POST   | `/v1/ocr`                 | Sync OCR — `multipart/form-data` (`file`) or JSON `{ source }` |
| POST   | `/v1/ocr/batch`           | Sync batch — JSON `{ sources: string[] }`                      |
| POST   | `/v1/ocr/stream`          | SSE — one event per image as it finishes                       |
| POST   | `/v1/ocr/async`           | Enqueue a batch → `202 { taskId }`                             |
| GET    | `/v1/tasks/:id`           | Task status                                                    |
| GET    | `/v1/tasks/:id/result`    | Task result (409 until done)                                   |
| DELETE | `/v1/tasks/:id`           | Cancel a task                                                  |
| GET    | `/v1/models`              | Engines, strategies, defaults                                  |
| GET    | `/health` · `/ready`      | Liveness · readiness (200 once warmed)                         |
| GET    | `/metrics`                | Prometheus                                                     |
| GET    | `/docs` · `/openapi.json` | Scalar UI · spec                                               |

### Input

`POST /v1/ocr` accepts `multipart/form-data` with a `file` field, or JSON:

```jsonc
{
  "source": "data:image/jpeg;base64,…",
  "strategy": "per-line",
  "flatten": false,
  "engine": "opencv",
}
```

`source` must be a `data:` URI or an `https` URL whose host is in `SOURCE_URL_ALLOWLIST` (empty = https disabled). **Local filesystem paths are rejected**, and URL fetches refuse redirects — so the API never reads arbitrary host files or gets steered off-allowlist.

## Configuration (env)

See [`.env.example`](.env.example) for the full annotated list.

| Var                                                    | Default            | Notes                                                               |
| ------------------------------------------------------ | ------------------ | ------------------------------------------------------------------- |
| `API_ENV`                                              | `development`      | `development` \| `production`                                       |
| `PORT` / `HOST`                                        | `8080` / `0.0.0.0` |                                                                     |
| `SECRET_KEY`                                           | —                  | If set, `Bearer <key>` required on `/v1/*` (`openssl rand -hex 32`) |
| `IP_WHITE_LIST` / `IP_DENY_LIST`                       | `*` / —            | Comma lists; `*` allows all (deny still applies)                    |
| `CORS_ORIGINS`                                         | `*`                | Comma list or `*`                                                   |
| `DOCS_ENABLED`                                         | `true`             | Serve `/docs` + `/openapi.json`                                     |
| `RATE_LIMIT_ENABLED`                                   | `true`             | Fixed-window per client IP on `/v1/*`                               |
| `RATE_LIMIT_PER_WINDOW` / `RATE_LIMIT_WINDOW_SECONDS`  | `120` / `60`       | `429` + `Retry-After` past the limit                                |
| `REQUEST_TIMEOUT_SECONDS`                              | `30`               |                                                                     |
| `MAX_UPLOAD_BYTES`                                     | `10485760`         | Per-image cap                                                       |
| `MAX_BATCH_IMAGES`                                     | `32`               |                                                                     |
| `EXECUTION_PROVIDERS`                                  | `cpu`              | Comma list, e.g. `cuda,cpu`                                         |
| `DEFAULT_STRATEGY`                                     | `per-line`         | `per-box` \| `per-line` \| `cross-line`                             |
| `DEFAULT_ENGINE`                                       | `opencv`           | `opencv` \| `canvas-native`                                         |
| `MODEL_DETECTION` / `MODEL_RECOGNITION` / `MODEL_DICT` | default v5         | Override model sources                                              |
| `MAX_CONCURRENCY`                                      | `0` (auto)         | Auto = 1 on an accelerator, 4 on CPU                                |
| `MAX_QUEUE_DEPTH`                                      | `100`              | Excess inferences get `429` + `Retry-After`                         |
| `TASK_TTL_SECONDS`                                     | `600`              | Async task retention                                                |
| `SOURCE_URL_ALLOWLIST`                                 | —                  | Comma list of allowed https hosts                                   |

## Develop

```bash
cd apps/serve
bun install
bun run dev        # watch mode
bun test           # HTTP-layer tests (no model load)
```

The app imports the library from source via a tsconfig path (`../../src`), so no build step is needed in dev. It is a standalone package (its own `node_modules`), kept out of the library's workspace so the published package and its install layout are unaffected.

## Notes & limits

- **Concurrency model.** Single-image OCR flows through the shared queue. Batch endpoints use `batchRecognize`'s own bounded concurrency (defaults to the same value); they aren't additionally gated by the single-image queue.
- **Async tasks are in-memory** (per-instance). For multi-replica deployments, swap the `TaskStore` implementation for Redis/BullMQ behind the same interface.
- **GPU** throughput is the win for the CUDA image; on CPU, ONNX Runtime already saturates cores, so concurrency mainly bounds memory.
