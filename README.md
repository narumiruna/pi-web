# pi-web

Local-first TypeScript web UI for [Pi Coding Agent](https://github.com/earendil-works/pi).

## Features

- Chat with Pi sessions from the browser, including streaming replies, abort, compact, follow-up/steer, and image prompts.
- Resume, rename, delete, export, fork, and inspect saved sessions from `~/.pi/agent/sessions`.
- Switch model, thinking level, active tools, slash commands, prompt templates, and skills.
- Paste images directly into the chat box with `Ctrl+V`, preview attachments, and send them with the prompt.
- Use a web terminal tab backed by a persistent local shell.
- Browse workspace files, read text files, preview images, and auto-refresh file changes.
- Use the Control room tab for projects, workspaces, git status, machines, auth/API keys, model switching, tool toggles, model-invoked skill toggles, plugins, and pi packages.
- Run in one Fastify process with a Vite/React client and a small compatibility layer for the routes this UI uses.

## Local development

Requirements: Node.js 22+, npm, and a configured Pi install/API key.

```bash
npm install
npm run dev
```

Open the Vite UI at <http://127.0.0.1:30142>. The API server runs on `127.0.0.1:30141`.

Production build/run:

```bash
npm run build
npm start
```

Open <http://127.0.0.1:30141>.

CLI:

```bash
mkdir example
cd example
pi-web
# open the printed http://127.0.0.1:30141 URL
```

CLI workspace precedence is `--cwd`, then `PI_WEB_CWD`, then `WORKSPACE_ROOT`, then the current directory.

```bash
npx @narumitw/pi-web
pi-web --cwd /path/to/project --port 30141
node dist/server/cli.js --cwd /path/to/project --port 30141
```

## Docker

Production-like compose uses `compose.yml` and stores data under `./data`:

```bash
just up      # docker compose up -d --build --remove-orphans
just down    # docker compose down --remove-orphans
```

Development compose uses `compose.dev.yml` and mounts this repo at `/workspace`:

```bash
just devup
just devdown
```

Open <http://127.0.0.1:30141>.

The image installs `uv`, Rust/Cargo, and the latest uv-managed Python by default. Pin versions with build args:

```bash
UV_VERSION=0.11.26 PYTHON_VERSION=3.12 RUST_VERSION=1 docker compose build
```

Compose sets `WORKSPACE_ROOT=/workspace` and mounts:

- `./data/pi/agent:/home/node/.pi/agent` for Pi config/auth/sessions.
- `./data/workspace:/workspace` in `compose.yml`.
- `./:/workspace` in `compose.dev.yml`.

## Configuration

Useful environment variables:

- `HOST` / `PORT`: server bind host and port.
- `PI_WEB_CWD`: default workspace directory; falls back to `WORKSPACE_ROOT` then `process.cwd()`.
- `PI_WEB_DATA_DIR`: project/machine/config storage directory; defaults to `~/.pi-web`.
- `PI_WEB_CONFIG`: config JSON path override.
- `PI_WEB_SHELL`: shell used by web terminals; defaults to `/bin/sh`.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`: provider keys for container/runtime use.

## Checks

```bash
npm run lint   # biome ci
npm run ci     # biome ci + typecheck + tests + build
```
