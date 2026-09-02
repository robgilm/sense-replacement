# ---- build stage ----
# Debian-slim (glibc), not Alpine (musl): better-sqlite3's native addon has no
# musl prebuilt and must compile from source there, a combination with known
# native-module stability issues (a startup crash in Node's cleanup-hook
# teardown, worse on newer Node/ARM64). glibc has proper prebuilds/toolchain
# support and is far more battle-tested for this addon.
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm -r build
# Produce a pruned production install for the server (keeps compiled better-sqlite3).
# --legacy: pnpm 10+ otherwise requires inject-workspace-packages for deploy.
RUN pnpm --filter @sense/server deploy --legacy --prod /deploy/server

# ---- runtime stage ----
FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY --from=build /deploy/server ./packages/server
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
