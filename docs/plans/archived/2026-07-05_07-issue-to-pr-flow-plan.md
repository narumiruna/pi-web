# 07. Issue → Task → PR Flow 實作計畫

## Goal
讓使用者能從 GitHub issue 建立 agent 任務，完成後用 draft PR 交付，形成從需求到審查的最短工作流。

## Context
市場主流 agent 產品都在推 issue-to-PR。`pi-web` 目前已有 session、cwd、terminal，可先用本機 `git` 與可選 `gh` CLI 完成 MVP。

## Pi Integrity Boundary
- `pi-web` stays an auxiliary UI around `pi-coding-agent`; do not fork, patch, or replace Pi core behavior.
- Prefer Pi SDK/public CLI/config surfaces; if a capability is missing, expose a graceful fallback instead of mutating Pi internals.
- Keep Pi session files, auth, model selection, tools, and extension behavior as the source of truth unless the plan explicitly writes a user-owned config file with backup/restore.

## Non-Goals
- 第一版不做 Jira/Linear。
- 不自行管理 GitHub OAuth；優先使用本機已登入的 `gh`。

## Plan
- [ ] 新增 `src/server/githubIssue.ts`，用 `gh issue view --json` 讀 issue title/body/url，未安裝或未登入時回傳可理解錯誤；verify with mocked command tests。
- [ ] 新增 `/api/issues/import` endpoint，接受 GitHub issue URL/number，回傳 normalized task payload；verify with unit tests for URL parsing。
- [ ] UI 新增「Import issue」入口，把 issue 轉成 prompt draft，包含 title、body、acceptance criteria；verify with browser manual check。
- [ ] 整合 worktree：可選擇為 issue 建 branch/worktree 並開 session；verify by imported issue creating session cwd on worktree。
- [ ] 新增 `/api/pr/create`，用 `gh pr create --draft` 建 PR，body 包含 summary/testing；verify with mocked command tests。

## Risks
- `gh` 不存在或未登入會阻斷完整 flow；UI 必須提供「只建立 task prompt」fallback。

## Completion Checklist
- [ ] GitHub issue URL 可轉成 agent prompt draft，verified by browser manual check。
- [ ] 無 `gh` 時有明確 fallback，不 crash，verified by mocked test。
- [ ] Draft PR 建立 command 被正確組裝，verified by unit test with mocked runner。
- [ ] 專案通過 `npm run ci`。
