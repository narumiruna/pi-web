# pi-web

Local-first TypeScript web UI for [Pi Coding Agent](https://github.com/earendil-works/pi).

## Features

- Browse saved Pi sessions from `~/.pi/agent/sessions`.
- Start/resume sessions with streaming chat, abort, compact, steer/follow-up.
- Switch model, thinking level, and active tools.
- Use slash commands, prompt templates, skills, and image prompts.
- Browse/read workspace files, including image previews.
- Use a basic web terminal in a tab next to chat.

## Local development

Requirements: Node.js 22+ and an already configured Pi install/API key.

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

## Docker

```bash
docker compose up --build
```

Open <http://127.0.0.1:30141>.

The compose file mounts:

- `~/.pi/agent:/home/node/.pi/agent` for Pi config/auth/sessions.
- `${PI_WEB_WORKSPACE:-.}:/workspace` as the editable workspace.

Container sessions use `/workspace`; mount the host project you want Pi to edit there:

```bash
PI_WEB_WORKSPACE=/path/to/project docker compose up --build
```

## Checks

```bash
npm run typecheck
npm run build
npm test
```

## Scope

This is intentionally small: one Fastify process, Vite/React client, no auth, no remote machine fleet, no plugins, no separate session daemon.
