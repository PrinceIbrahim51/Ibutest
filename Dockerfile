# syntax=docker/dockerfile:1.7
# IbuTest server + web client. Multi-stage build; the runtime image contains only the
# compiled bundle and production dependencies and runs as an unprivileged user.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY desktop/package.json desktop/
COPY mobile/package.json mobile/
# Desktop/mobile toolchains are not needed for the server image.
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build -w @ibutest/client && npm run build -w @ibutest/server

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY desktop/package.json desktop/
COPY mobile/package.json mobile/
RUN npm ci --omit=dev --workspace @ibutest/server --include-workspace-root=false --no-audit --no-fund --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    CLIENT_DIST_DIR=/app/client/dist \
    MIGRATIONS_DIR=/app/server/drizzle \
    UPLOAD_DIR=/data/uploads \
    PGLITE_DATA_DIR=/data/pglite
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/server/dist ./server/dist
COPY --from=build --chown=root:root /app/server/drizzle ./server/drizzle
COPY --from=build --chown=root:root /app/server/package.json ./server/package.json
COPY --from=build --chown=root:root /app/client/dist ./client/dist
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
