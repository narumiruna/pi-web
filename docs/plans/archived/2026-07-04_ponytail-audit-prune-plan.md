## Goal

Cut the remaining over-engineered pieces identified by the repo-wide ponytail audit while preserving the current browser UI, terminal, chat, image preview, Docker, and CLI behavior. Success means fewer tracked/runtime files, fewer compatibility routes, less UI/settings machinery, and no new dependencies.

## Context

- A previous overengineering cleanup is archived at `docs/plans/archived/2026-07-03_overengineering-cleanup-plan.md`; this plan only covers new remaining cuts.
- Current largest touched-risk files are `src/server/index.ts` (915 lines), `src/client/styles/polish.css` (888 lines with local uncommitted UI polish), and `src/client/ControlRoom.tsx` (834 lines).
- There is an active UI polish plan and local edits in `src/client/styles/polish.css`; do not mix CSS pruning with that work unless the user explicitly accepts the merge.

## Non-Goals

- Do not remove API-key authentication, model switching, terminal, chat image paste/display, file explorer watch, or Docker/CLI launch behavior.
- Do not redesign the UI beyond deleting unnecessary dashboard/details layers.
- Do not add dependencies.

## Plan

- [ ] Remove tracked Pi runtime seed state under `data/pi/agent/` except `.gitkeep` to avoid shipping local settings and skills; verify with `git ls-files data/pi/agent` showing only `.gitkeep` and `README.md` still documenting runtime mounts.
- [ ] Inventory compatibility routes actually called by `src/client` before deletion; verify with `rg "(/api/|api\()" src/client README.md` and a kept-route list in the implementation notes.
- [ ] Delete uncalled compatibility file/project/activity routes from `src/server/compatFiles.ts` and any now-unused helpers from `src/server/compatShared.ts`; verify with `npm run typecheck` and `rg "project-directories|/api/files/\*|/api/activity" src README.md` showing no kept client dependency.
- [ ] Decide whether subscription/OAuth login is out of scope for this app; verify with explicit user acceptance before deleting `login-jobs` UI/server code, or mark this task not applicable if subscription login must stay.
- [ ] If accepted, replace `AuthSettings` with API-key-only save/clear UI and remove auth job types/state/routes; verify with `rg "login-jobs|Subscription|AuthJob" src` returning no matches and `npm run typecheck`.
- [ ] Shrink `ControlRoom` to plain sections for session, git, model/API keys, tools, skills, and theme; remove metric cards, advanced project/machine/package dashboard, raw JSON details drawer, and related polling; verify with `wc -l src/client/ControlRoom.tsx` below the current count and a browser smoke test of each remaining section.
- [ ] Replace SVG conversion with direct static SVG serving for image preview; remove `rsvg-convert` code and `imagemagick librsvg2-bin` Docker packages; verify with updated `src/server/workspaceImages.test.ts`, `rg "rsvg|imagemagick|librsvg" Dockerfile src` returning no matches, and `npm test`.
- [ ] After the active UI polish work is finished or explicitly merged, collapse duplicated CSS overrides in `src/client/styles/*.css` so each selector has one owner where practical; verify with `wc -l src/client/styles/*.css` keeping files under 1000 lines and screenshot/user acceptance for unchanged UI.
- [ ] Remove fallback message hashing and its dedicated test if SDK/message IDs cover normal rendering; verify with `rg "stableHash|performanceHelpers" src` returning no matches and `npm test`.
- [ ] Convert `compose.dev.yml` to a minimal override that only changes the workspace volume from `./data/workspace` to `./`; verify with `docker compose -f compose.yml -f compose.dev.yml config`.
- [ ] Run final repo checks after implementation; verify `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass.

## Risks

- Removing compatibility routes can break undocumented clients; mitigate by deleting only routes not used by this UI and documenting removed route groups in the implementation response.
- Removing OAuth/subscription login is a product decision; require explicit user acceptance before deleting it.
- CSS pruning conflicts with the active UI polish plan; defer or merge deliberately to avoid clobbering local changes.

## Rollback / Recovery

- Revert the cleanup commit if a removed route or login flow is still required.
- Restore Docker image packages if direct SVG serving is rejected by browser smoke tests.

## Completion Checklist

- [ ] Tracked runtime seed state is removed, verified by `git ls-files data/pi/agent` and unchanged compose mounts.
- [ ] Unused compatibility routes are pruned without breaking current UI, verified by client route grep, browser smoke test, and `npm run typecheck`.
- [ ] OAuth/subscription login is either explicitly removed with user acceptance or marked not applicable with the user decision recorded in this plan.
- [ ] Control room is smaller and still exposes required settings, verified by browser smoke test and `wc -l src/client/ControlRoom.tsx`.
- [ ] SVG preview works without OS conversion packages, verified by `npm test` and no `rsvg|imagemagick|librsvg` matches in Docker/source.
- [ ] CSS remains under the 1000-line source-file rule and preserves accepted UI, verified by `wc -l src/client/styles/*.css` and screenshot/user acceptance.
- [ ] Final implementation passes `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
