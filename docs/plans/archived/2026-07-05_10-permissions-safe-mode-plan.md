# 10. 權限與安全模式實作計畫

## Goal
提供安全模式與權限設定，讓使用者能控制 agent 可用 tools、command/file/network 風險，降低誤操作與資料外洩風險。

## Context
目前 UI 可開關 active tools。更細的 per-tool approval 需先確認 Pi SDK 是否有 hook；第一版先做 profiles 與安全啟動模式。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Unknowns
- Pi SDK 是否支援 tool invocation 前的同步 approval hook。

## Plan
- [ ] 檢查 Pi SDK tool/extension 執行流程，確認能否攔截 tool call approval；verify with source notes in implementation PR。
- [ ] 新增 permission profiles：`safe`、`ask`、`full`，保存於 `PI_WEB_DATA_DIR`，映射到 active tools defaults；verify with unit tests for profile resolution。
- [ ] 新增 session create 時的 profile 選擇，safe profile 預設停用高風險工具；verify by `/api/sessions` active tools response。
- [ ] 若 SDK 支援 approval hook，加入 per-command/file-write confirmation；若不支援，UI 顯示「profile-only」限制；verify with manual tool execution check。
- [ ] 新增 Safe Mode 啟動選項，停用 extensions/MCP/custom instructions 或提示使用 CLI safe mode；verify with server status showing safe mode flag。

## Risks
- 假安全比沒有安全更糟；UI 必須明確顯示目前能限制的是 tools profile 還是真正 per-call approval。

## Completion Checklist
- [ ] 使用者可用 safe profile 建 session，verified by active tools API/manual check。
- [ ] 權限設定保存並套用到新 session，verified by unit test。
- [ ] UI 清楚標示目前安全保證範圍，verified by browser manual check。
- [ ] 專案通過 `npm run ci`。
