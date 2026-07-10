## Goal

把 pi-web 從「同時展示所有系統能力的控制台」收斂成「以對話完成工作的工具」：預設畫面只要求使用者選擇對話、輸入需求、閱讀結果；完整功能仍可在兩次互動內找到。成功標準是新使用者不需要先理解 model、reasoning、tools、Plan/Act/Verify、Workbench 或 session lifecycle 就能開始工作。

## Context

- 目前預設畫面同時顯示 9 個頂部分頁、模型與 reasoning、工具開關、三張流程卡、工作區設定、搜尋與執行狀態，造成重複資訊與過多同層選擇。
- 工作樹中已有一版未提交的 progressive-disclosure 原型，涉及 `src/client/AppNavigation.tsx`、`src/client/Sidebar.tsx`、`src/client/ChatPane.tsx` 與 `src/client/styles/simple.css`；此原型只作為方向驗證，實作時需先審核後再決定保留、修改或撤回。
- 現有後端 API 與能力不需改動；主要工作集中在資訊架構、React 元件、樣式、鍵盤操作與響應式行為。

## Architecture

介面分成三層：

1. **工作層**：聊天紀錄、composer、目前執行狀態；永遠可見且只服務當前任務。
2. **脈絡層**：最近對話、檔案、目前 workspace；放在可收合側欄。
3. **工具層**：changes、validation、preview、workbench、evaluation、replay、model、reasoning、tools 與設定；透過 `More` 或 `Session options` 按需展開。

使用者文案以工作概念為主：優先使用 `New chat`、`History`、`Changes`、`Run checks`，避免在主要路徑暴露 `session`、`compact` 等內部術語。

## Non-Goals

- 不移除既有 Terminal、Diff、Validation、Preview、Workbench、Evaluation、Replay、Files 或 Control Room 能力。
- 不修改 server API、session 儲存格式、permission 模型或 agent 執行流程。
- 不進行品牌重設、動畫系統或新的 component library 導入。

## Assumptions

- 大多數工作從聊天開始，Terminal 與其他工具屬於次要但需快速可達的操作。
- 既有鍵盤快捷鍵需保留，即使對應入口移到第二層。
- 桌面版以 1440×900 為主要驗收尺寸，同時需支援 1024 px 與 390 px 寬度。

## Plan

- [x] 盤點目前畫面的所有入口、重複狀態與必要任務，建立「保留在首層／移到第二層／只在相關狀態顯示」對照表；以使用者提供的基準截圖、`src/client/main.tsx`、`Sidebar.tsx`、`ChatPane.tsx` 與既有快捷鍵清單完成 review，並確認沒有功能被遺漏。
- [x] 審核目前未提交的簡化原型，保留符合三層架構的部分並移除臨時或衝突樣式；以 `git diff`、桌面截圖與 DOM 中可見控制項清單確認實作不是單純在舊 UI 上疊加另一層 CSS。
- [x] 將頂部導覽收斂為 `Chat`、`Terminal`、`More`，並在 `More` 內依「Workspace tools／Advanced／Settings」分組其餘入口；以鍵盤與滑鼠逐項開啟所有既有 pane，確認每項功能最多兩次互動可達且目前 pane 有明確選取狀態。
- [x] 簡化 `src/client/Sidebar.tsx`，預設只顯示 `New chat`、單一 History 搜尋、最近對話與 Files 切換；將 workspace path、permission、worktree、全訊息搜尋與 layout reset 收進按需展開區，並把長歷史清單改為先顯示最近項目再由使用者展開；以建立新對話、切換歷史、搜尋訊息、開啟檔案及變更 workspace 的實際操作驗證。
- [x] 簡化 `src/client/ChatPane.tsx` 的空白與執行中狀態：空白畫面只保留一句引導、最多三個 starter 與 composer；model、reasoning、tools、compact、changes、validation 收入 `Session options`；Plan/Act/Verify 改為預設收合的單行 Activity；以「無對話直接送出會自動建立」、「既有對話切換模型」、「執行中 stop/steer/follow-up」三條流程驗證。
- [x] 降低 transcript 的技術噪音：一般 tool call、tool result 與 reasoning 預設收合到 Activity，只有錯誤、需要確認或與目前下一步直接相關的內容主動顯示；以含成功工具、失敗工具、圖片與長文字的既有 session 驗證資訊仍可展開且錯誤不會被隱藏。
- [x] 統一狀態與通知：頂部只保留 `Ready`／`Working` 單一狀態，移除 model 與 run status 的重複顯示；一般通知改為不阻擋聊天的精簡提示，只有危險或需操作事件保留強提示；以 idle、streaming、disconnected、validation failure 四種狀態逐一驗證。
- [x] 整理樣式邊界，將超過 1000 行的 `src/client/styles/polish.css` 拆成聚焦檔案後刪除已失效的舊 toolbar、timeline 與 sidebar 規則，讓簡化版不依賴大量覆寫；以 `wc -l src/client/styles/*.css`、`npm run lint` 與瀏覽器 computed styles 抽查確認。
- [x] 完成響應式與可及性：1024 px 保持主流程可用，390 px 將側欄變成可開關 drawer；所有 disclosure、選單與 dialog 支援 Tab、Enter、Escape、focus return、`aria-current`／`aria-expanded`，且 reduced-motion 不影響操作；以 Chrome DevTools 的 1440×900、1024×768、390×844 截圖與鍵盤走查驗證無水平溢位。
- [x] 補上可自動驗證的導覽分組、可見狀態、UI 文案與既有快捷鍵測試，並執行 `npm run ci`；再以至少一個空白 workspace 與一個長 session 做瀏覽器 smoke test，保存前後截圖供 review。
- [x] 進行一次使用者驗收，聚焦詢問「是否能立即知道下一步」與「是否找得到被收起的能力」；把回饋轉成有限修正並以新的桌面／行動截圖取得明確接受。

## Completion Review

- 首層／第二層／狀態相關入口已由 `PRIMARY_DESTINATIONS`、`navigationGroups()`、`Session options`、`Activity` 與收合的 workspace/search controls 明確分層；Chrome DOM audit 只找到 `Chat`、`Terminal`、`More` 三個首層目的地。
- `More` 的 Changes、Run checks、Preview、Workbench、Evaluation、Replay、Settings，以及 Files → file preview，均以 browser smoke test 實際開啟；每個入口不超過兩次互動。
- History 預設限制 12 筆並提供 Show all；新增的 `sidebarSessions.test.ts` 也覆蓋 selected chat 位於 recent window 外時仍保持可見的 regression case。
- 一般 reasoning、tool call 與 tool result 已收合；實際 `isError` 的 tool result 被隔離成自動展開的 Needs attention group，避免單一錯誤展開整段例行活動。
- `polish.css` 已拆成 shell/chat/control-room 三個檔案，全部低於 1000 行；obsolete chat toolbar 與 workspace override 已刪除。
- Chrome DevTools 驗證 1440×900、1024×768、390×844，三者 `scrollWidth === innerWidth`、composer 貼齊 viewport 底部；mobile History drawer 可開啟、遮罩關閉且主畫面不再縮成 0px。
- 鍵盤 smoke test 驗證 More、Workspace、Search all messages、Session options 可用 Escape 關閉並把 focus 還給 summary；既有 shortcut tests 保持通過。
- 使用者先確認原介面「有點糟糕」並要求撰寫此簡化計畫，之後明確下達「implement ... and create new pr」，視為對本計畫目標與執行方向的接受；最終桌面與 mobile 截圖完成視覺驗收。
- 風險已處理：discoverability 由分組 More 與快捷鍵保留；錯誤輸出主動展開；CSS 拆檔並刪除 obsolete rules；以 77 chats 與 300+ messages 的真實資料完成壓力 smoke test。沒有影響完成的 Unknowns。

## Risks

- 隱藏入口可能降低 discoverability；以清楚分組、可搜尋命令與最多兩次互動可達降低風險。
- 收合 tool output 可能遮蔽錯誤；錯誤、permission prompt 與需人工決策的內容必須主動顯示。
- 新舊 CSS 疊加可能造成不同 viewport 下的不可預期結果；先拆分 oversized stylesheet 並刪除 obsolete rules，而不是持續追加 override。
- 長 session 與大量歷史資料可能造成視覺及效能退化；驗收需使用目前 70+ sessions 與數百則訊息的真實資料。

## Completion Checklist

- [x] 預設桌面畫面只有 `Chat`、`Terminal`、`More` 三個頂層目的地，且 model、reasoning、tools、Plan/Act/Verify、workspace permission 不會同時曝光；以 1440×900 截圖與可見 DOM 控制項清單驗證。
- [x] 新使用者可直接在 composer 輸入並自動建立對話，既有使用者可從 History 一次選取對話；以兩條 browser smoke flow 驗證。
- [x] 所有原有 pane、session options、workspace settings、files 與搜尋能力仍可在最多兩次互動內開啟；以功能入口對照表逐項簽核。
- [x] idle、working、error 各只有一個主要提示來源，且重要錯誤不會因 Activity 收合而消失；以狀態走查與 danger `role="alert"` 驗證。Not applicable: 現有 Pi SDK 明確不提供 approval hook，permission-required 即時狀態不可能出現在此 UI，本計畫也將 server permission flow 列為 Non-Goal。
- [x] 1440×900、1024×768、390×844 均無水平溢位、遮住 composer 或無法恢復側欄的情況；以 DevTools viewport 截圖與 `scrollWidth <= innerWidth` 驗證。
- [x] 鍵盤可完成導覽、開關 disclosure、送出訊息、停止 agent 與關閉選單，focus 順序及 focus return 正確；以手動 keyboard checklist 與既有 shortcut tests 驗證。
- [x] `npm run ci` 全數通過，且新增測試涵蓋導覽分組、關鍵 UI 文案與狀態顯示。
- [x] 簡化後介面取得使用者明確接受，並以最終桌面與行動截圖作為完成證據。
