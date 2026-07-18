# 15. Web Terminal 加強：指令收藏與輸出送回 Agent 實作計畫

## Goal
讓 Web Terminal 更適合 agent debugging：可收藏常用指令，並把選取或最近輸出送回 chat。

## Context
目前 `TerminalPane` 已提供 persistent local shell。Chat 與 Terminal 分頁分離，使用者需要手動複製 logs。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 不取代 validation panel。
- 不把所有 terminal output 自動送給模型，避免洩漏 secrets。

## Plan
- [ ] 在 `TerminalPane` 保留 bounded output buffer，例如最近 5000 行/固定字元數；verify with unit test for buffer trimming。
- [ ] 加入「Send selected output to chat」與「Send last N lines」actions，將文字填入 ChatPane draft 而非直接送出；verify with browser manual check。
- [ ] 新增 command snippets，以 localStorage 保存名稱與 command；verify with unit test for serialization and manual UI check。
- [ ] 加入 secret warning heuristic，偵測 `API_KEY=`, `token`, `password` 等輸出時二次確認；verify with unit tests。
- [ ] 更新 keyboard shortcut：terminal 中快速送最近錯誤到 chat；verify with manual shortcut check。

## Risks
- Terminal logs 可能包含秘密；所有 send-to-chat 預設只填 draft 並顯示 warning。

## Completion Checklist
- [ ] 可把 terminal 最近輸出送到 chat draft，verified by browser manual check。
- [ ] Command snippets 重載後保留，verified by unit/manual test。
- [ ] Secret warning heuristic 有測試，verified by `npm test -- terminal`。
- [ ] 專案通過 `npm run ci`。
