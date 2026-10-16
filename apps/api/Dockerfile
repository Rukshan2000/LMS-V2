# Build context: repository root
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
RUN npm ci -w @lms/api -w @lms/db --include-workspace-root
COPY apps/api apps/api
COPY packages/db packages/db
RUN npm run build -w @lms/api \
 && npm prune --omit=dev

FROM node:22-alpine
# MIGRATIONS_DIR: dist/migrate.js loads the .ts migrations below (Node strips types natively).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 MIGRATIONS_DIR=/app/packages/db/migrations
WORKDIR /app
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json ./
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/packages/db/package.json ./packages/db/
COPY --from=build --chown=node:node /repo/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=node:node /repo/packages/db/src/rls.ts ./packages/db/src/
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "dist/index.js"]
