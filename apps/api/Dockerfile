# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/api/Dockerfile .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @swapchan/api... build \
 && pnpm --filter @swapchan/api deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=build /out .
# Widget partner DB (SQLite) lives on the api-data volume.
RUN mkdir -p /data && chown node:node /data
ENV SWAPCHAN_DATA_DIR=/data
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]
