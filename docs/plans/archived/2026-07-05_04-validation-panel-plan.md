# 04. 測試 / Lint / Build 驗證面板實作計畫

## Goal
提供一個驗證面板，讓使用者能一鍵執行專案常用 checks，查看 logs，並把失敗結果送回 agent 修正。

## Context
README 已定義本 repo 的 `npm run lint`、`npm run typecheck`、`npm test`、`npm run ci`。目前 Web Terminal 可手動跑指令，但缺少 structured validation flow。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 不在第一版自動猜測所有語言的完整 CI。
- 不讓任意網路使用者執行 commands；保持 local-only bind 與 cwd path safety。

## Plan
- [ ] 新增 server command runner，白名單來源先讀 `package.json scripts` 與手動設定的 safe commands；verify with unit tests for command allow/deny。
- [ ] 新增 `/api/validation/run` endpoint，執行指定 command 並串流 stdout/stderr/status；verify with temp package fixture test。
- [ ] 新增 `ValidationPanel`，顯示 lint/typecheck/test/build/ci 按鈕、running 狀態、exit code、logs；verify with `npm run typecheck` and manual check。
- [ ] 加入「Send failure to chat」按鈕，把 command、exit code、tail logs 放進 prompt；verify with browser manual check。
- [ ] 在 agent timeline 的 Verify 區塊連到最近一次 validation result；verify with UI state test or manual flow。

## Risks
- Command execution 是 trust boundary；必須限制 cwd、避免 shell interpolation，並清楚顯示將執行的命令。

## Completion Checklist
- [ ] 面板可跑本 repo `npm test` 並顯示 exit code/logs，verified by browser manual check。
- [ ] 失敗 logs 可送回 chat，verified by manual prompt draft check。
- [ ] Command allow/deny 有測試，verified by `npm test -- validation`。
- [ ] 專案通過 `npm run ci`。
