# Build from the repo root:  docker build -f apps/worker/Dockerfile -t flick-worker .

# Stage 1: install everything, compile TypeScript, then drop dev dependencies.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci \
 && npm run build -w @chat/shared -w @chat/contracts -w @chat/db -w @chat/uploads -w @chat/worker \
 && npm prune --omit=dev

# Stage 2: only compiled code and production dependencies, run as the unprivileged "node" user.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/database/package.json ./packages/database/
COPY --from=build --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /app/packages/uploads/package.json ./packages/uploads/
COPY --from=build --chown=node:node /app/packages/uploads/dist ./packages/uploads/dist
COPY --from=build --chown=node:node /app/apps/worker/package.json ./apps/worker/
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
USER node
WORKDIR /app/apps/worker
EXPOSE 9465
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:9465/health/live || exit 1
CMD ["node", "dist/main.js"]
