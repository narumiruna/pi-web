# 18. Agent 品質評估 / Golden Tasks 實作計畫

## Goal
建立一組可重複執行的 golden tasks，衡量不同模型/設定在成本、時間、測試通過率與人工接受度上的表現。

## Context
Agent 產品長期需要知道哪個模型與設定真的有效。第一版做本地、少量、可手動審核的 evaluation，不做雲端 benchmark。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 不追求通用 SWE-bench。
- 不自動把評估結果上傳。

## Plan
- [ ] 定義 golden task Markdown schema：title、cwd、prompt、allowed tools、verification command、expected files；verify with parser unit tests。
- [ ] 新增 `docs/golden-tasks/` 範例 2-3 個小任務，避免依賴外部服務；verify by reviewing files。
- [ ] 新增 server runner，依序建立 session、送 prompt、等待完成、執行 verification command、記錄 tokens/cost/duration；verify with mocked session runner tests。
- [ ] 新增 Evaluation UI，選模型/任務、顯示 pass/fail/cost/time 與人工 accept/reject；verify with browser manual check using mocked result。
- [ ] 保存 results 到 `PI_WEB_DATA_DIR/evaluations.json`，支援匯出 JSON；verify with store tests。

## Risks
- 真實 agent run 成本高且不穩；第一版需允許 dry-run/mocked runner 測 UI 與資料流程。

## Completion Checklist
- [ ] Golden task schema parser 有測試，verified by `npm test -- golden`。
- [ ] 至少 2 個範例 task 存在，verified by `find docs/golden-tasks -type f`。
- [ ] Evaluation UI 可顯示一次 run 的 pass/fail/cost/time，verified by manual or mocked browser check。
- [ ] 專案通過 `npm run ci`。
