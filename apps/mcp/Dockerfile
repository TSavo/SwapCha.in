# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/mcp/Dockerfile .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @swapchan/mcp... build \
 && pnpm --filter @swapchan/mcp deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production MCP_HOST=0.0.0.0 MCP_PORT=8788
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 8788
CMD ["node", "dist/index.js"]
