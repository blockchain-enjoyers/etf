# Meridian backend (NestJS API + indexer + keeper + jobs) for Railway.
# Build context = REPO ROOT (Yarn 4 workspaces). On Railway set, for this service:
#   Root Directory = /          Dockerfile Path = backend/Dockerfile
# ---------------------------------------------------------------------------

# ---- build: install all workspaces, build contracts -> sdk -> backend ----
FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable
# prisma.config.ts reads env("DATABASE_URL") at load; generate never connects, so a dummy is fine.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY . .
RUN yarn install --immutable
RUN yarn workspace @meridian/contracts build \
 && yarn workspace @meridian/sdk build \
 && yarn workspace @meridian/backend prisma:generate \
 && yarn workspace @meridian/backend build

# ---- runtime: slim image + openssl (Prisma query engine needs libssl) ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/backend
# Railway sets PORT; main.ts binds 0.0.0.0:$PORT. Apply pending migrations, then start
# (env is injected by Railway — the package.json `start` uses --env-file, so don't use it here).
CMD ["sh", "-c", "npx prisma migrate deploy && node --import ./dist/otel.js dist/main.js"]
