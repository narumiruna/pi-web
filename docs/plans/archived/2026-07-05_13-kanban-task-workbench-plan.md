# 13. 任務卡 / Kanban 式工作台實作計畫

## Goal
把多個 agent 任務從單純 chat list 升級成任務卡工作台，支援 pending/running/review/done 狀態與 session/worktree 連結。

## Context
目前 sidebar 以 sessions 為中心；多任務平行後需要更清楚的任務層。第一版用本地 JSON metadata，不引入看板套件。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不做團隊即時協作。
- 不做複雜 drag-and-drop library。

## Plan
- [ ] 定義 task card schema：id、title、status、sessionId、cwd/worktree、created/updated；verify with TypeScript type and unit validation。
- [ ] 新增 metadata store `PI_WEB_DATA_DIR/tasks.json` 與 `/api/tasks` CRUD endpoints；verify with read/write endpoint tests。
- [ ] 在 UI 新增 Workbench tab，使用原生按鈕或 HTML drag/drop 移動欄位；verify with browser manual check。
- [ ] 建 session/import issue/worktree 時可選擇建立 task card；verify by API response and UI card creation。
- [ ] 任務進入 `review` 時顯示 diff/validation/checkpoint links；verify by manual flow after agent completion。

## Risks
- Task 與 session 可能不同步；UI 需顯示 missing session/worktree 狀態而不是 crash。

## Completion Checklist
- [ ] Workbench 可新增、移動、刪除 task card，verified by browser manual check。
- [ ] Task metadata 重啟後保留，verified by Vitest store test。
- [ ] Missing linked session 顯示 graceful warning，verified by unit/manual test。
- [ ] 專案通過 `npm run ci`。
