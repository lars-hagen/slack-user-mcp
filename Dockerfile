FROM node:22-alpine AS builder

# Copy necessary files for the build
COPY package*.json tsconfig.json index.ts ./

WORKDIR /

RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:22-alpine AS release

COPY --from=builder /dist /app/dist
COPY --from=builder /package.json /app/package.json
COPY --from=builder /package-lock.json /app/package-lock.json

ENV NODE_ENV=production
LABEL org.opencontainers.image.title="Slack User MCP Server"
LABEL org.opencontainers.image.description="MCP server for interacting with Slack as a user"

WORKDIR /app

RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --omit-dev

ENTRYPOINT ["node", "dist/index.js"]
