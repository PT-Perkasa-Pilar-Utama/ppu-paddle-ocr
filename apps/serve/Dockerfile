# syntax=docker/dockerfile:1
# CPU image for ppu-paddle-ocr-serve. Build from the REPO ROOT:
#   docker build -f apps/serve/Dockerfile -t ppu-paddle-ocr-serve .

# ---- dependencies ----
FROM oven/bun:1 AS deps
WORKDIR /app
# Library (root) deps — the serve app imports ppu-paddle-ocr from source, which
# pulls onnxruntime-node + ppu-ocv from the root node_modules.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile && bun pm trust onnxruntime-node
# Serve app deps (hono, zod, ...).
COPY apps/serve/package.json apps/serve/
RUN cd apps/serve && bun install && bun pm trust onnxruntime-node

# ---- runtime ----
FROM oven/bun:1-slim AS runtime
WORKDIR /app
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
