# Node has a stable global WebSocket, so the Gardena socket needs no `ws` dependency.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS development-dependencies-env
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS production-dependencies-env
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build-env
# Home Assistant's Supervisor passes the add-on's `version:` as BUILD_VERSION.
# Consuming it *before* the source copy gives the version bump real teeth: on
# HAOS 17+ the containerd snapshotter otherwise reuses the cached COPY layer and
# a Rebuild silently ships the old code. Changing the version changes this layer,
# which invalidates everything below it.
ARG BUILD_VERSION=dev
RUN echo "$BUILD_VERSION" > /build-version
COPY . .
COPY --from=development-dependencies-env /app/node_modules ./node_modules
RUN pnpm run build

FROM base
ARG BUILD_VERSION=dev
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=production-dependencies-env /app/node_modules ./node_modules
COPY --from=build-env /app/build ./build
# Migrations are applied at boot, so they have to ship with the image.
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY server.mjs ./server.mjs

# Surfaced on the Settings page so a rebuild that silently did nothing is
# visible rather than something you have to infer from behaviour.
ENV APP_VERSION=$BUILD_VERSION

# SQLite lives on a mounted volume; without one, schedules are lost on redeploy.
# As a Home Assistant add-on, Supervisor provides /data automatically.
ENV DATABASE_PATH=/data/gardena.db
VOLUME /data

EXPOSE 3000
# Resolves configuration from either the environment or a Home Assistant add-on
# options file before starting the server.
CMD ["node", "scripts/start.mjs"]
