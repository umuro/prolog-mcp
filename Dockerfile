# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
# --ignore-scripts skips the prepublish hook (which runs tsc before src/ is copied)
RUN npm ci --ignore-scripts
COPY src/ ./src/
RUN npx tsc

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# SWI-Prolog 9.x from Debian bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends swi-prolog \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production Node deps (--ignore-scripts skips the prepublish/build hook)
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Built JS + Prolog server
COPY --from=builder /app/dist ./dist/
COPY prolog/ ./prolog/

# KB data volume — mount host path here to persist the knowledge base
ENV KB_DIR=/data/prolog-mcp
ENV SWIPL_PORT=7474

# MCP stdio: keep container stdin open (-i flag required at runtime)
ENTRYPOINT ["node", "dist/index.js"]
