# 09. Repo Instructions / Skills / Rules 管理器實作計畫

## Goal
讓使用者能在 Web UI 中查看與編輯 repo instructions、skills、prompt templates，提升 agent 輸出一致性。

## Context
目前 UI 已列出 commands、skills、tools，但沒有 instruction/rule 管理。Repo 已有 `AGENTS.md`，Pi 也使用 skills 與 prompt templates。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不做 marketplace 或遠端同步。
- 不自動改寫使用者規則內容，只提供編輯與驗證。

## Plan
- [ ] 盤點 Pi 會讀取的 instruction/prompt/skill 路徑與現有 repo `AGENTS.md`，列出可管理檔案；verify with source/docs notes in PR。
- [ ] 新增 safe file editor endpoints，限制只能讀寫 cwd 內 `AGENTS.md`、`.pi/` 或明確允許的 instruction paths；verify with path traversal tests。
- [ ] 在 Control room 新增 Rules section，顯示 discovered files、狀態、最後修改時間；verify with browser manual check。
- [ ] 提供 Markdown editor save/restore original，並在 save 後重新載入 session commands/skills；verify by editing temp AGENTS.md fixture/manual check。
- [ ] 加入簡單 lint：空檔、超大檔、可能含 secret 的行給 warning；verify with unit tests for lint helper。

## Risks
- 編輯錯誤 instructions 會影響 agent 行為；需要 backup/restore 與清楚提示。

## Completion Checklist
- [ ] UI 可編輯 repo `AGENTS.md` 並保存，verified by browser manual check。
- [ ] Path restrictions 有測試，verified by `npm test -- instructions`。
- [ ] Save 前 backup/restore 可用，verified by fixture test。
- [ ] 專案通過 `npm run ci`。
