# 16. 可分享的 Session Export / Replay 實作計畫

## Goal
讓使用者能匯出 session 為 Markdown/JSON，並在 `pi-web` 中重播 prompt、回覆、tool calls、diff/validation 摘要，方便分享與 debug。

## Context
目前可讀 session messages，但沒有完整 export/replay。此功能應避免包含 secrets，並保留本地優先。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不提供雲端分享連結。
- Replay 是唯讀，不重新執行 commands。

## Plan
- [ ] 新增 `sessionExport.ts`，把 SessionManager messages/tree/status 轉成 sanitized JSON 與 Markdown；verify with fixture tests。
- [ ] 新增 secret redaction helper，處理常見 API key/token patterns；verify with unit tests。
- [ ] 新增 `/api/sessions/:id/export?format=json|md` endpoint；verify with endpoint tests。
- [ ] 在 session actions 加 Export buttons，下載 `.json`/`.md`；verify with browser manual check。
- [ ] 新增 Replay view，載入 export JSON 後以唯讀 timeline 呈現 messages/tool calls；verify with fixture import manual check。

## Risks
- 匯出可能外洩本地路徑或 secrets；需預設 redaction 並提示使用者檢查。

## Completion Checklist
- [ ] Session 可匯出 Markdown 與 JSON，verified by browser manual download。
- [ ] Redaction helper 覆蓋常見 secret patterns，verified by unit tests。
- [ ] Replay view 可讀取 fixture JSON，verified by manual check。
- [ ] 專案通過 `npm run ci`。
