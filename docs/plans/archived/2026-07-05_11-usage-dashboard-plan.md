# 11. Token / Cost / Usage Dashboard 實作計畫

## Goal
讓使用者能看見每個 session 的 token、cost、context usage 與工具使用次數，避免長任務成本不可見。

## Context
`WebSession.status()` 已回傳 `contextUsage`、`tokens`、`cost`、`activeTools`。第一版應重用這些資料，不新增 analytics 服務。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 不做雲端 billing reconciliation。
- 不追蹤個人跨機器統計。

## Plan
- [ ] 定義 `UsageSnapshot` client type，從現有 status 擷取 tokens/cost/context/tool count；verify with unit test for normalization。
- [ ] 在 Control room 新增 Usage card，顯示 current session cost、context percentage、input/output tokens；verify with browser manual check。
- [ ] 在 session list 顯示輕量 usage badge，沒有資料時顯示 `—`；verify with UI manual check。
- [ ] 將 SSE status 更新 append 到 in-memory usage history，畫簡單表格/迷你趨勢，不加 chart dependency；verify with simulated status events test。
- [ ] 加入 README 一行說明 usage dashboard 來源為 provider/SDK 回報估算；verify with `rg "Usage|cost|token" README.md`。

## Risks
- Cost 可能是估算或 provider 不支援；UI 必須標示 estimate/unknown。

## Completion Checklist
- [ ] Current session usage 在 Control room 可見，verified by browser manual check。
- [ ] Missing usage 不造成 crash，verified by unit test。
- [ ] No new chart dependency added，verified by `git diff package.json` review。
- [ ] 專案通過 `npm run ci`。
