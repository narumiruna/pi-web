# 12. Session Search / Timeline / Bookmark 實作計畫

## Goal
讓使用者能搜尋歷史 sessions、按時間線檢視重要事件，並 bookmark 重要訊息或任務結果。

## Context
目前 `/api/sessions` 與 `/api/sessions/:id/messages` 已能列 session 與讀 messages。需要加搜尋 API 與少量 metadata storage。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不做向量搜尋。
- 不改寫 Pi 原始 session 檔案格式。

## Plan
- [ ] 新增 server `sessionSearch.ts`，掃描 SessionManager entries 做文字搜尋，回傳 sessionId、message excerpt、timestamp/role；verify with fixture tests。
- [ ] 新增 bookmark metadata store 於 `PI_WEB_DATA_DIR/bookmarks.json`，用 sessionId + message index/leaf id 保存；verify with read/write tests。
- [ ] 新增 `/api/search/sessions` 與 `/api/bookmarks` endpoints；verify with endpoint tests。
- [ ] 在 Sidebar 加搜尋框與結果列表，點擊結果載入 session 並定位訊息；verify with browser manual check。
- [ ] 在 ChatPane 訊息上加入 bookmark toggle，Control room 顯示 bookmarks；verify with manual check。

## Risks
- 大量 sessions 搜尋可能慢；第一版使用 debounce、limit、取消舊請求，不建索引。

## Completion Checklist
- [ ] 可搜尋歷史 session 文字並開啟結果，verified by browser manual check。
- [ ] Bookmark 可新增/移除/重載後保留，verified by Vitest metadata test。
- [ ] 不修改原始 session 檔案，verified by fixture checksum test。
- [ ] 專案通過 `npm run ci`。
