# 17. UI/UX 與 Keyboard Shortcuts 強化實作計畫

## Goal
提升重度使用者效率，加入一致的 keyboard shortcuts、焦點管理、command palette 基礎能力與可發現的 shortcut help。

## Context
目前 UI 有 chat/terminal/file/control room tabs，但快捷操作有限。第一版使用原生 `keydown`，不新增 hotkey library。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 不重做整套設計系統。
- 不加入大型 command palette dependency。

## Plan
- [ ] 定義 shortcut map：new session、focus prompt、send/abort、switch tabs、open diff/validation、toggle sidebar；verify with documented map in code and README。
- [ ] 新增 `src/client/shortcuts.ts`，處理跨平台 modifier 與 input/textarea 排除規則；verify with unit tests。
- [ ] 在 App 安裝全域 shortcuts，觸發現有 actions；verify with browser manual check。
- [ ] 新增 Help modal，列出 shortcuts 並支援搜尋現有 commands；verify with accessibility roles/manual keyboard navigation。
- [ ] 修補焦點管理：送出後 prompt 保持 focus，modal close 回到來源；verify with manual keyboard-only flow。

## Risks
- Shortcuts 可能和瀏覽器/terminal 衝突；Terminal focus 時只啟用少數全域 shortcuts。

## Completion Checklist
- [ ] 常用 shortcuts 可用且有 help modal，verified by browser manual keyboard test。
- [ ] Input/textarea/terminal 不被錯誤攔截，verified by unit/manual tests。
- [ ] README 或 UI help 有 shortcut 說明，verified by `rg "shortcut|keyboard" README.md src/client`。
- [ ] 專案通過 `npm run ci`。
