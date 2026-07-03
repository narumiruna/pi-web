ARG UV_VERSION=0.11.26
ARG PYTHON_VERSION=
ARG RUST_VERSION=1
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv
FROM rust:${RUST_VERSION}-slim-bookworm AS rust

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG PYTHON_VERSION
COPY --from=uv /uv /uvx /usr/local/bin/
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=30141 \
    WORKSPACE_ROOT=/workspace \
    HOME=/home/node \
    UV_TOOL_BIN_DIR=/home/node/.local/bin \
    CARGO_HOME=/home/node/.cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/home/node/.cargo/bin:/home/node/.local/bin:$PATH
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /workspace /home/node/.pi/agent /home/node/.local/bin /home/node/.cargo/bin && chown -R node:node /workspace /home/node
USER node
RUN if [ -n "$PYTHON_VERSION" ]; then \
      uv python install --default --no-progress --no-config "$PYTHON_VERSION"; \
    else \
      uv python install --default --no-progress --no-config; \
    fi
RUN uv tool install rust-just
EXPOSE 30141
CMD ["node", "dist/server/index.js"]
