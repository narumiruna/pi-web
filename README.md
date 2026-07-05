# pi-web

## Quick start

Run once:

```bash
npx --yes @narumitw/pi-web@latest
```

Or install globally:

```bash
npm install -g @narumitw/pi-web
pi-web
```

Open the printed URL (without `--port`/`PORT`, it starts at <http://127.0.0.1:30141> and uses the next free port if busy).

As a Pi extension:

```bash
pi install npm:@narumitw/pi-web
# then in pi: /pi-web
```

`/pi-web` starts the local service and live-syncs the current Pi session.

Local-first TypeScript web UI for [Pi Coding Agent](https://github.com/earendil-works/pi).

## Features

- Chat with Pi sessions from the browser, including streaming replies, abort, compact, follow-up/steer, and image prompts.
- Resume, rename, delete, export, fork, and inspect saved sessions from `~/.pi/agent/sessions`.
- Switch model, thinking level, active tools, slash commands, prompt templates, and skills.
- Paste images directly into the chat box with `Ctrl+V`, preview attachments, and send them with the prompt.
- Use a web terminal tab backed by a persistent local shell, save command snippets, and send recent output back to the chat draft.
- Browse workspace files, read text files, preview images, and auto-refresh file changes.
- Review git diffs, create checkpoints, rewind local changes, and run validation commands from package scripts.
- Visualize agent task flow as Plan → Act → Verify, import GitHub issues, manage kanban task cards, and create draft PRs.
- Preview localhost browser apps, attach screenshots, export/replay sessions, and run golden-task evaluations.
- Use the Control room tab for auth/API keys, usage/cost estimates, diagnostics/troubleshooting, permissions safe mode, MCP/external tool config, repo rules, model switching, tool toggles, model-invoked skill toggles, and bookmarks.
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

CLI workspace precedence is `--cwd`, then `PI_WEB_CWD`, then `WORKSPACE_ROOT`, then the current directory.

```bash
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

- `HOST` / `PORT`: server bind host and port. CLI auto-falls back from 30141 only when PORT is not set.
- `PI_WEB_CWD`: default workspace directory; falls back to `WORKSPACE_ROOT` then `process.cwd()`.
- `PI_WEB_DATA_DIR`: pi-web metadata storage for checkpoints, tasks, bookmarks, MCP config, permissions, and evaluations; defaults to `./data/pi-web`.
- `PI_WEB_CONFIG`: config JSON path override.
- `PI_WEB_SHELL`: shell used by web terminals; defaults to `/bin/sh`.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`: provider keys for container/runtime use.

## Keyboard shortcuts

- `Ctrl/⌘+N`: new session
- `Ctrl/⌘+K`: focus prompt
- `Ctrl/⌘+D`: open diff review
- `Ctrl/⌘+Shift+T`: open validation
- `?`: shortcut help

## Troubleshooting

Open Control room → Diagnostics to check Node.js, agent directory, API key hints, workspace write access, and shell setup. Usage/cost values are provider/SDK estimates and may show `0`/`—` when unavailable.

## Checks

```bash
npm run lint   # biome ci
npm run ci     # biome ci + typecheck + tests + build
```
