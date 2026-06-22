# syntax=docker/dockerfile:1
# CPU image for ppu-paddle-ocr-serve. Build from the REPO ROOT:
#   docker build -f apps/serve/Dockerfile -t ppu-paddle-ocr-serve .

# ---- dependencies ----
FROM oven/bun:1@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS deps
WORKDIR /app
# Library (root) deps — the serve app imports ppu-paddle-ocr from source, which
# pulls onnxruntime-node + ppu-ocv from the root node_modules.
# Library runtime deps only: ppu-ocv (a prod dep) plus onnxruntime-node, which
# is a peer/dev dep so we add it explicitly. --production drops the heavy
# build/test devDeps (typescript, the native tsgo compiler, oxlint, ...).
COPY package.json bun.lock ./
# --ignore-scripts skips the root `prepare: husky` (husky is a devDep, absent in
# --production); the onnxruntime native binary is then built via `bun pm trust`.
RUN bun install --production --ignore-scripts \
  && bun add onnxruntime-node --ignore-scripts \
  && bun pm trust onnxruntime-node
# Serve app: only hono + zod at runtime (its lib deps are devDeps that resolve
# from the root node_modules above).
COPY apps/serve/package.json apps/serve/bun.lock apps/serve/
RUN cd apps/serve && bun install --production

# ---- runtime ----
FROM oven/bun:1-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS runtime
WORKDIR /app

# OCI metadata — without these the ghcr package inherits the base image's
# (Bun's) description.
LABEL org.opencontainers.image.title="ppu-paddle-ocr-serve" \
      org.opencontainers.image.description="Production-grade REST API serving ppu-paddle-ocr (PaddleOCR PP-OCRv6 OCR) — Hono + Bun." \
      org.opencontainers.image.source="https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=8080 \
    EXECUTION_PROVIDERS=cpu

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/serve/node_modules ./apps/serve/node_modules
COPY src ./src
COPY package.json tsconfig.json ./
COPY apps/serve/src ./apps/serve/src
COPY apps/serve/package.json apps/serve/tsconfig.json ./apps/serve/

# Run as the unprivileged `bun` user and pre-bake the default models into its
# cache so the container has zero cold-start downloads.
USER bun
RUN bun -e "import { PaddleOcrService } from '/app/src/index.ts'; await PaddleOcrService.downloadModels();"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(Bun.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "apps/serve/src/index.ts"]
