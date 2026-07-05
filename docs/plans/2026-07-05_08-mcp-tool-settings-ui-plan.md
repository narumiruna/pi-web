# 08. MCP / 外部工具設定 UI 實作計畫

## Goal
提供 MCP 與外部工具的設定、啟停、測試連線 UI，降低使用者連接 GitHub、DB、Figma、Sentry 等工具的成本。

## Context
目前 Control room 已顯示 models/tools/skills。MCP config 的實際來源需先依 Pi SDK/agent 設定確認，避免猜錯檔案格式。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Unknowns
- Pi 目前 MCP server 設定檔位置與 schema 需要確認。

## Plan
- [ ] 閱讀 Pi SDK/agent MCP 相關文件或 source，確認 config path、schema、reload 行為；verify with notes added to this plan or implementation PR description。
- [ ] 新增 server config helper，讀寫 MCP servers 設定並保留未知欄位；verify with fixture round-trip tests。
- [ ] 新增 `/api/mcp` endpoints：list/save/test server command；verify with mocked server command tests。
- [ ] 在 Control room 加 MCP section，支援新增 stdio server、啟停、測試連線、顯示 tools/resources；verify with browser manual check。
- [ ] 將 MCP tools 與現有 tools list 做連結，讓使用者知道哪些工具來自哪個 server；verify by UI showing source label。

## Risks
- 錯寫 Pi config 會破壞使用者環境；必須先備份原檔並保留未知欄位。

## Rollback / Recovery
- 每次保存 MCP config 前寫 `.bak`，UI 提供 restore last backup；verify with config helper test。

## Completion Checklist
- [ ] MCP config schema 已被實際文件/source 驗證，evidence recorded in implementation notes。
- [ ] MCP UI 可新增/停用/test 一個 stdio server，verified by browser manual check。
- [ ] Config round-trip 不遺失未知欄位，verified by Vitest fixture。
- [ ] 專案通過 `npm run ci`。
