# Repository Guidelines

## Scope and layout
- Work from the repository root. Use `just` first to discover repo recipes; the default recipe runs `just --list`.
- If `GOAL.md` is present, read it before planning and do not edit it directly.
- `src/client/` is the React/Vite browser UI. `src/server/` is the Fastify/Node server, CLI, Pi SDK compatibility layer, terminal, file, and image APIs.
- Tests live beside source as `src/**/*.test.ts`. Build output in `dist/`, dependencies in `node_modules/`, and ignored runtime state under `data/` are not hand-edited.
- No nested `AGENTS.md` files currently exist; this file applies repo-wide.

## Commands
- Setup: `npm ci`.
- Development: `npm run dev` starts the server watcher and Vite UI; Vite listens on `127.0.0.1:30142` and proxies API/WebSocket traffic to `127.0.0.1:30141`.
- Production check/run: `npm run build`, then `npm start`.
- Verification gates: `npm run lint` (Biome), `npm run typecheck`, `npm test`, and `npm run ci` for the CI-equivalent sequence.
- Docker helpers from `just`: `just up`, `just down`, `just devup`, `just devdown`. Do not run `just publish`, `npm publish`, or release/versioning commands unless explicitly asked.

## Code style and conventions
- Use TypeScript ESM. Local support is Node.js `>=22`; GitHub Actions uses Node.js 24.
- Biome owns formatting and linting with 2-space indentation; do not add another formatter or linter.
- Keep changes bounded. Reuse existing helpers such as `src/client/api.ts`, `src/server/pathSafety.ts`, `src/server/fileTypes.ts`, and `src/server/workspaceImages.ts` before adding new utilities.
- Do not add dependencies unless they solve a current problem better than existing code or platform APIs.
- Strict: when touching a source file over 1000 lines, or one that would exceed 1000 lines after the change, split it into focused files before adding code.

## Testing and safety
- Add or update Vitest coverage for behavior changes in parsing, path safety, image handling, CLI/port logic, or compatibility routes.
- Run the smallest relevant check while developing, then `npm run ci` before finishing non-trivial changes.
- Never commit secrets or local auth/session data. `.env*`, `data/pi/agent/auth.json`, sessions, npm cache, bins, and workspace runtime files are ignored for a reason.
- Treat file-system, terminal, WebSocket, and Docker changes as trust-boundary changes: keep path validation via `resolveInside`, avoid logging API keys, and preserve local-only bind defaults unless a task explicitly changes them.
