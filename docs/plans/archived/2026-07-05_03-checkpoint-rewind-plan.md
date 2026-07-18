# 03. Checkpoint / Rewind 實作計畫

## Goal
在 agent 動手前建立可回復 checkpoint，讓使用者可一鍵 rewind 到任務開始前的工作區狀態。

## Context
`pi-web` 是 local-first 工具；使用者信任核心是 AI 改壞時能回復。此功能應優先支援 Git workspace。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不支援大型非 Git 目錄完整快照。
- 不取代 Git commit/stash 工作流。

## Plan
- [ ] 新增 checkpoint storage 目錄於 `PI_WEB_DATA_DIR/checkpoints`，保存 metadata、`git diff --binary`、staged diff、untracked file copy；verify with unit tests using temp dirs。
- [ ] 在 `/api/sessions/:id/prompt` 執行前自動建立 checkpoint，失敗時不阻塞 prompt 但回報 warning；verify with server test/mocked session prompt。
- [ ] 新增 `/api/checkpoints?cwd=&sessionId=` 與 `/api/checkpoints/:id/rewind` endpoints；verify with temp git repo tests。
- [ ] 實作 rewind：反向套用 tracked diff、還原 untracked files、刪除任務後新增且未在 checkpoint 的檔案前要求確認；verify with tracked/untracked test cases。
- [ ] 在 UI 顯示 checkpoint list 與「Rewind」危險操作確認；verify with browser manual check。

## Risks
- 使用者在 checkpoint 後手動改檔，rewind 可能覆蓋新工作；必須在 UI 確認中列出將變更的檔案。

## Rollback / Recovery
- Rewind 前再建立一個 `pre-rewind` checkpoint；verify by checking checkpoint metadata after rewind。

## Completion Checklist
- [ ] Prompt 前自動 checkpoint 已建立，verified by temp repo/server test。
- [ ] Rewind 可還原 tracked 與 untracked 檔案，verified by Vitest temp repo cases。
- [ ] UI 有明確危險操作確認，verified by browser manual check。
- [ ] 專案通過 `npm run ci`。
