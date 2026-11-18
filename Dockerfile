# syntax=docker/dockerfile:1
# 更新时同步 .node-version；固定 patch 和 manifest digest，构建与运行使用同一基础镜像。
ARG NODE_IMAGE=node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
FROM ${NODE_IMAGE} AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
# 与 CI 共用根 packageManager 的精确版本。
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY backend/src/modules/capture/ ./backend/src/modules/capture/
COPY frontend/ ./frontend/
RUN VITE_USE_MOCK=false pnpm --filter frontend build

FROM base AS production-deps
RUN pnpm install --prod --frozen-lockfile --filter @gduf/backend

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.source="https://github.com/Tarnishedtaffy/2026gdufai"
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/app.db UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/backend/node_modules ./backend/node_modules
COPY backend/package.json ./backend/package.json
COPY backend/src/ ./backend/src/
COPY --chmod=755 tools/repair-volume-permissions.sh /usr/local/bin/repair-volume-permissions
COPY --from=build /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/data /app/uploads && chown node:node /app/data /app/uploads
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]
