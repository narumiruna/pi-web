# 05. 內建 Browser Preview + Screenshot 實作計畫

## Goal
讓使用者能在 `pi-web` 內預覽本地 web app，並把畫面截圖附加到 agent prompt 供 UI 修正。

## Context
目前支援圖片貼上與附件 prompt；可重用 `AttachedImage` flow。為了保持簡單，第一版用 iframe preview 與瀏覽器原生 screen capture，不新增 screenshot dependency。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不做自動視覺 regression testing。
- 不自動啟動任意 dev server；先讓使用者輸入 preview URL。

## Plan
- [ ] 新增 `PreviewPane`，提供 preview URL 輸入、iframe 顯示、open external button；verify with browser manual check against local Vite URL。
- [ ] 用 `navigator.mediaDevices.getDisplayMedia` + canvas 產生 PNG data URL，轉成既有 `AttachedImage`；verify by attaching screenshot to chat draft。
- [ ] 將 Preview tab 加到 `src/client/main.tsx`，並在 ChatPane 增加「Attach screenshot」入口；verify with `npm run typecheck`。
- [ ] 加入 URL validation，只允許 `http://127.0.0.1`、`http://localhost` 或使用者明確確認的 URL；verify with unit test for URL allowlist。
- [ ] 更新 README 的 preview/screenshot 使用說明；verify with `rg "Preview|screenshot" README.md`。

## Risks
- Screen Capture API 需要使用者授權且不能完全自動化；這是第一版刻意取捨，避免新增重型 browser automation dependency。

## Completion Checklist
- [ ] Preview tab 可載入 localhost app，verified by browser manual check。
- [ ] 截圖可作為 image prompt 送出，verified by manual chat send。
- [ ] URL allowlist 有測試，verified by `npm test -- preview`。
- [ ] 專案通過 `npm run ci`。
