# 02. Git Diff Review / Hunk Accept / Revert 實作計畫

## Goal
讓使用者能在 Web UI 中檢視 agent 造成的 Git diff，並接受或回復單檔/單 hunk 變更。

## Context
目前有檔案瀏覽與 session UI，但沒有 Git diff review。Server 已有 path safety helper `resolveInside`，可重用於工作區路徑檢查。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不實作完整 Git merge/conflict editor。
- `accept` 代表標記已審核，不自動 commit。

## Plan
- [ ] 新增 server git helper 以 `git -C <cwd> diff --binary --src-prefix=a/ --dst-prefix=b/` 讀取變更；verify with temp git repo test。
- [ ] 新增 `/api/git/diff?cwd=` endpoint，回傳檔案清單、patch、stat、是否為 git repo；verify with `npm test -- gitDiff`。
- [ ] 新增 `/api/git/revert` endpoint，支援 file revert 與 hunk reverse patch via `git apply -R --cached?` 不改 staged 狀態以外的檔案；verify with temp repo tests for file and hunk。
- [ ] 新增 client `DiffPane`，顯示 file list、patch text、accept/revert actions；verify with `npm run typecheck` and browser manual check。
- [ ] 在 agent 任務完成後顯示 diff review CTA；verify by running a prompt that edits a tracked file and seeing diff CTA。

## Risks
- Patch parser 容易出錯；第一版可用原始 patch text 搭配 hunk boundaries，避免做完整語法樹。
- Binary files 只能 file-level revert。

## Completion Checklist
- [ ] Tracked text file 的 single hunk 可被回復，verified by temp repo Vitest。
- [ ] Diff review UI 可接受/標記已審核單檔，verified by browser manual check。
- [ ] Path safety 未被繞過，verified by tests covering `../` cwd/path attempts。
- [ ] 專案通過 `npm run ci`。
