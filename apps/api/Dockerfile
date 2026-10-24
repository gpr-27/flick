# Build from the repo root:  docker build -f apps/api/Dockerfile -t flick-api .

# Stage 1: install everything, compile TypeScript, then drop dev dependencies.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci \
 && npm run build -w @chat/shared -w @chat/contracts -w @chat/db -w @chat/uploads -w @chat/ai -w @chat/link-preview -w @chat/api \
 && npm prune --omit=dev

# Stage 2: only compiled code and production dependencies, run as the unprivileged "node" user.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# node_modules links to the workspace packages, so they are copied along with their built dist/.
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1
CMD ["node", "dist/main.js"]
