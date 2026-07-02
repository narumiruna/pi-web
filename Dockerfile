ARG UV_VERSION=0.11.26
ARG PYTHON_VERSION=
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG PYTHON_VERSION
COPY --from=uv /uv /uvx /usr/local/bin/
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=30141 \
    WORKSPACE_ROOT=/workspace \
    HOME=/home/node \
    UV_TOOL_BIN_DIR=/home/node/.local/bin \
    PATH=/home/node/.local/bin:$PATH
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /workspace /home/node/.pi/agent /home/node/.local/bin && chown -R node:node /workspace /home/node
USER node
RUN if [ -n "$PYTHON_VERSION" ]; then \
      uv python install --default --no-progress --no-config "$PYTHON_VERSION"; \
    else \
      uv python install --default --no-progress --no-config; \
    fi
EXPOSE 30141
CMD ["node", "dist/server/index.js"]
