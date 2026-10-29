# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/web/Dockerfile .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Baked into the client bundle at build time
ARG NEXT_PUBLIC_API_URL=https://api.swapchan.com
ARG NEXT_PUBLIC_REOWN_PROJECT_ID=
ARG NEXT_PUBLIC_GA_ID=
ARG NEXT_PUBLIC_CROSSMINT_CLIENT_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_REOWN_PROJECT_ID=$NEXT_PUBLIC_REOWN_PROJECT_ID NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID NEXT_PUBLIC_CROSSMINT_CLIENT_KEY=$NEXT_PUBLIC_CROSSMINT_CLIENT_KEY
RUN pnpm --filter @swapchan/web... build

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
