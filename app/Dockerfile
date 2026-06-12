# Meridian frontend (Vite/React SPA) for Railway.
# Build context = REPO ROOT (Yarn 4 workspaces). On Railway set, for this service:
#   Root Directory = /          Dockerfile Path = app/Dockerfile
# VITE_* are baked at BUILD time — Railway passes this service's variables as build args.
# ---------------------------------------------------------------------------

FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable
# Railway forwards service variables as Docker build args; surface them to Vite via ENV.
ARG VITE_API_BASE_URL
ARG VITE_RPC_46630
ARG VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_USE_FIXTURES="false"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_RPC_46630=$VITE_RPC_46630 \
    VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID \
    VITE_USE_FIXTURES=$VITE_USE_FIXTURES
COPY . .
RUN yarn install --immutable
RUN yarn workspace @meridian/contracts build \
 && yarn workspace @meridian/sdk build \
 && yarn workspace @meridian/app build

# ---- runtime: tiny static server with SPA history fallback ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /srv
RUN npm install -g serve@14
COPY --from=build /app/app/dist ./dist
ENV PORT=3000
EXPOSE 3000
# -s = single-page fallback (deep links like /portfolio -> index.html)
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT}"]
