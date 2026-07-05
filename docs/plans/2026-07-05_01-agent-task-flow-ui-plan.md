# 01. Agent 任務流程 UI 實作計畫

## Goal
讓 `pi-web` 在每次任務中清楚呈現 `Plan → Act → Verify` 流程，使用者能看見 agent 正在規劃、執行哪些工具、是否完成驗證。

## Context
目前 `src/server/index.ts` 已透過 SSE 傳送 `agent_start`、`tool_execution_*`、`agent_end`、`prompt_done`，`src/client/main.tsx` 已接收事件並更新聊天訊息。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 不在第一版實作全新的 workflow engine。
- 不要求模型一定輸出結構化 plan；先用現有事件與訊息推導狀態。

## Plan
- [ ] 盤點現有 SSE 事件與 `ChatPane` 顯示路徑，列出可映射到 Plan/Act/Verify 的事件；verify with `src/server/index.ts`、`src/client/main.tsx` 檢視紀錄。
- [ ] 新增 `src/client/agentTimeline.ts`，把 session events/messages 轉成 timeline items；verify with `npm test -- agentTimeline`。
- [ ] 在 `ChatPane` 加入輕量 timeline 區塊，顯示 plan text、tool calls、驗證結果與失敗狀態；verify with browser manual check and `npm run typecheck`。
- [ ] 對 `tool_execution_start/update/end` 補齊 UI 狀態與錯誤樣式，讓失敗工具可一鍵引用到輸入框；verify with mocked event unit test or manual SSE event replay。
- [ ] 更新 README 的功能清單一行，說明任務流程可視化；verify with `rg "Plan.*Act.*Verify|任務流程" README.md docs/plans`。

## Risks
- 歷史 session 缺少完整事件，只能顯示從 messages 推導的簡化 timeline。

## Completion Checklist
- [ ] `Plan → Act → Verify` UI 已在 active session 顯示，verified by browser manual test。
- [ ] Timeline reducer 有測試覆蓋主要事件，verified by `npm test -- agentTimeline`。
- [ ] 專案仍通過品質門檻，verified by `npm run ci`。
