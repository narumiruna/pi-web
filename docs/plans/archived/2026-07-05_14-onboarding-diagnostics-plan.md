# 14. Onboarding / Diagnostics 實作計畫

## Goal
在使用者第一次啟動或設定異常時，清楚檢查 Pi auth、API keys、models、workspace、Node/runtime、shell 與常見環境問題。

## Context
目前 README 說明需要 Node 22+、npm、Pi install/API key。UI 若啟動後 models/auth 失敗，只會顯示較零散錯誤。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 不自動替使用者申請/儲存第三方 API key。
- 不做跨平台完整系統修復。

## Plan
- [ ] 新增 `src/server/diagnostics.ts`，檢查 Node version、agentDir、auth file existence、env API keys、available models、cwd write access、shell；verify with unit tests using mocked env/fs。
- [ ] 新增 `/api/diagnostics` endpoint，回傳 pass/warn/fail items 與修復建議；verify with endpoint tests。
- [ ] 在 Control room 加 Diagnostics section，失敗時置頂顯示 actionable fix；verify with browser manual check。
- [ ] 首次載入 models 失敗時自動顯示 diagnostics link；verify by mocked failed `/api/models` manual/dev test。
- [ ] 更新 README troubleshooting 小節，列出 diagnostics 可檢查項目；verify with `rg "Diagnostics|troubleshooting" README.md`。

## Risks
- Diagnostics 可能誤判；所有項目應顯示 evidence/path/env name，避免只給籠統錯誤。

## Completion Checklist
- [ ] `/api/diagnostics` 回傳 pass/warn/fail，verified by endpoint/unit tests。
- [ ] UI 能引導缺 API key 或無 model 的使用者，verified by manual mocked state。
- [ ] README 有 troubleshooting 說明，verified by `rg`。
- [ ] 專案通過 `npm run ci`。
