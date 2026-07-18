# 06. Parallel Sessions with Git Worktrees 實作計畫

## Goal
支援多個 agent 任務在同一 repo 中平行執行，每個任務使用獨立 Git worktree，避免互相覆蓋。

## Context
目前 session 可指定 `cwd`，因此 worktree 功能可建立新 cwd 後重用現有 session flow。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不自動 merge 多個 worktree 的成果。
- 不支援非 Git workspace 的平行隔離。

## Plan
- [ ] 新增 server git worktree helper，支援 list/create/remove，worktree root 預設在 `PI_WEB_DATA_DIR/worktrees`；verify with temp git repo tests。
- [ ] 新增 `/api/worktrees` endpoints，建立 worktree 時產生 branch name `pi-web/<slug>` 並回傳 cwd；verify with endpoint tests。
- [ ] 在 New Session UI 增加「Parallel task in new worktree」選項；verify with browser manual check。
- [ ] 建立 worktree 後自動以該 cwd 開新 session，並在 sidebar 顯示 worktree badge；verify by checking session cwd and UI badge。
- [ ] 提供 remove worktree action，要求 dirty check clean 才允許刪除；verify with temp repo clean/dirty tests。

## Risks
- Worktree 刪除可能造成資料遺失；dirty worktree 必須拒絕刪除或要求明確 force。

## Completion Checklist
- [ ] 可從 UI 建立 worktree-backed session，verified by browser manual check。
- [ ] Dirty worktree 不會被普通刪除，verified by Vitest temp repo case。
- [ ] Session cwd 正確指向 worktree，verified by API response/manual check。
- [ ] 專案通過 `npm run ci`。
