# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build

ARG SOURCE_COMMIT
ARG ENTITY_RELEASE_BRANCH=main
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN release_sha="${SOURCE_COMMIT:-}" \
    && test -n "$release_sha" \
    && printf '%s' "$release_sha" | grep -Eq '^[0-9a-f]{40}$' \
    && printf '%s' "$release_sha" > /tmp/entity-release-sha
RUN --mount=type=cache,target=/root/.npm \
    set -eu; \
    for attempt in 1 2 3 4; do \
      npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 && break; \
      if [ "$attempt" -eq 4 ]; then exit 1; fi; \
      rm -rf node_modules; \
      sleep $((attempt * 5)); \
    done
RUN npm run build
RUN node scripts/entity-release-info.mjs \
      --root /app \
      --sha "$(cat /tmp/entity-release-sha)" \
      --branch "$ENTITY_RELEASE_BRANCH" \
      --environment curacel \
      --write >/dev/null

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime-deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/app/package.json ./packages/app/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/desktop/package.json ./packages/desktop/package.json
COPY packages/mobile/package.json ./packages/mobile/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY electron/package.json ./electron/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
      --workspace=@entity/server \
      --workspace=@entity/db \
      --include-workspace-root \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000

FROM caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS caddy

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl dumb-init libcap2-bin \
    && rm -rf /var/lib/apt/lists/*
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
RUN setcap -r /usr/bin/caddy

ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=3000 \
    ENTITY_CONFIG=/app/entity.config.yaml \
    ENTITY_DB_MODE=LOCAL \
    ENTITY_TASK_DB_PATH=/data/entity.sqlite \
    ENTITY_DOCUMENTS_DB_PATH=/data/documents.sqlite \
    WORKSPACE=/workspace \
    HOME=/workspace/home \
    XDG_CONFIG_HOME=/workspace/caddy/config \
    XDG_DATA_HOME=/workspace/caddy/data \
    ENTITY_CLICKCLACK_SIDECAR=0 \
    ENTITY_CHAT_CLICKCLACK_BRIDGE=0 \
    ENTITY_AGENT_ENABLED=false \
    ENTITY_AGENT_NATIVE_EDITOR=false \
    ENTITY_FS_MULTISOURCE=true \
    ENTITY_FS_INDEXER_ENABLED=false

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=node:node /app/packages/server/package.json ./packages/server/package.json
COPY --from=runtime-deps --chown=node:node /app/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=node:node /app/packages/server/dist ./packages/server/dist
COPY --from=build --chown=node:node /app/packages/server/src/plugins ./packages/server/src/plugins
COPY --from=build --chown=node:node /app/packages/app/dist ./packages/app/dist
COPY --from=build --chown=node:node /app/RELEASE.json /app/VERSION ./
COPY --chown=node:node docker/entity.config.yaml ./entity.config.yaml
COPY --chown=node:node docker/entrypoint.sh docker/bootstrap-principals.cjs docker/supervise.sh docker/Caddyfile ./docker/

RUN chmod +x /app/docker/entrypoint.sh /app/docker/supervise.sh \
    && mkdir -p /data /workspace/home /workspace/output /workspace/memory /workspace/logs /workspace/caddy/config /workspace/caddy/data \
    && chown -R node:node /data /workspace /app

USER node
EXPOSE 8080
VOLUME ["/data", "/workspace"]

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["/app/docker/supervise.sh"]
