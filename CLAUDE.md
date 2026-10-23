# LimingUploader — 專案說明與開發規則

## 架構概覽

| 檔案 | 說明 |
|------|------|
| `index.html` | 主要前端頁面，部署於 GitHub Pages |
| `gallery.html` | 分享用圖庫頁（也可上傳），部署於 GitHub Pages |
| `upload.js` | 上傳引擎（分段續傳、斷線自動繼續、略過已存在檔案、關掉頁面後可一鍵繼續：檔案記在 IndexedDB），index.html 與 gallery.html 共用；修改後要更新兩個頁面引用處的 `?v=` 版本號 |
| `mp3-trim.js` | MP3 去頭去尾（直接切 frame、不重新壓縮），index.html 檔案列表的「剪輯」使用；修改後要更新 index.html 引用處的 `?v=` 版本號 |
| `print.html` | A4 圖片列印工具（手機選圖、旋轉、縮放、上中下位置，直接列印或存成 PDF），純前端不上傳也不呼叫 Worker；首頁入口是類別設定 Sheet 裡一列 `type = link` 的類別 |
| `worker.js` | Cloudflare Worker 後端，需手動部署（見「Worker 部署方式」，已納入 git 版控） |

**後端 API：** `https://liminguploader.c3012312.workers.dev`  
**前端網址：** `https://tjc-km.github.io/LimingUploader/`  
**相簿分享短連結：** `https://share.liming-tjc.org/s/<資料夾 ID>`（同一個 Worker 的自訂網域；`liming-tjc.org` 由使用者管理，主網站在 GitHub Pages，只有 `share` 子網域指向 Worker）

---

## 核心常數（worker.js）

```
ALLOWED_ORIGIN    = 'https://tjc-km.github.io'
TRASH_FOLDER_ID   = '1WySxHQ_iHr0wuBHdc7laT_N2CNfH3iCm'
SHEET_ID          = '1xuSBVb1bonQldMgaOZfhu4T2knqt91AJjTzG-YqoBn4'  ← 類別設定 Sheet
SCHEDULE_SHEET_ID = '1oNBqAG8F041o9ts-7pIsJCt9dLyIyWhhEX6bxUVOV9k'  ← LINE 排程 Sheet
```

---

## Google Sheet 結構

### 類別設定 Sheet（SHEET_ID）— Sheet1 頁籤
| 欄 | 說明 |
|----|------|
| A | 類別名稱 |
| B | Icon |
| C | 類型（drive / link） |
| D | Google Drive 資料夾 ID |
| E | 外部連結 URL |
| F | 排序（asc / desc） |
| G | noUpload（TRUE = 不顯示上傳區） |
| H | enabled（TRUE = 顯示此類別） |
| I | linePublish（TRUE = 顯示 LINE 發布按鈕） |
| J | trashFolderId（此類別專屬的刪除區資料夾 ID，需與類別資料夾在同一個 Shared Drive；留空 fallback 到全域 TRASH_FOLDER_ID） |

### 類別設定 Sheet（SHEET_ID）— Users 頁籤（含標題列）
| 欄 | 說明 |
|----|------|
| A | userId（LINE userId） |
| B | userName（LINE 顯示名稱） |

### 類別設定 Sheet（SHEET_ID）— Config 頁籤（含標題列，A = key、B = value）
| key | 說明 |
|-----|------|
| `convert_prompt` | 安排表轉檔改用 Gemini 解析時的提示詞（`{{year}}`、`{{month}}` 為佔位符） |
| `convert_notify` | 每月自動轉檔完成或失敗時要用小幫手 LINE 通知的人：填小幫手 Sheet `Users` 頁籤裡的顯示名稱，多人用逗號分隔 |

### LINE 排程 Sheet（SCHEDULE_SHEET_ID）— Schedule 頁籤（含標題列）
| 欄 | 說明 |
|----|------|
| A | 發送時間 |
| B | 對象 ID（ALL / userId） |
| C | 對象名稱 |
| D | 訊息類型（text / image / flex） |
| E | 內容 / 圖片 URL |
| F | 標題 |
| G | 描述 + 按鈕 |
| H | 建立時間 |
| I | 狀態（待發送 / 已發送 / 失敗：...） |

### LINE 小幫手 Sheet（SCHEDULE_HELPER_SHEET_ID，「Line發送功能(小幫手)」）
由小幫手 LINE 帳號發送，每月自動轉檔的通知寫在這裡。
- `Schedule` 頁籤（含標題列）：A 發送時間（`yyyy/MM/dd HH:mm`）｜B 對象 userId｜C 類型（text / image / flex）｜D 內容/檔名｜E 標題(flex)｜F 副標｜按鈕｜網址｜G 狀態（**留空 = 待發送**，發送後變 `sent` / `failed: ...`）｜H 發送時間（由發送程式填）｜I 對象名稱
- `Users` 頁籤（含標題列）：A userId｜B 顯示名稱｜C 加入時間｜D isAdmin｜E 通知安排表

---

## 開發規則（Claude 必須遵守）

### ✅ 允許
- 修改 `index.html` 的功能與樣式
- 修改 `worker.js` 新增 API 路由
- 在既有架構下新增功能

### ❌ 禁止
- **不可更動** `ALLOWED_ORIGIN`、`TRASH_FOLDER_ID`、`SHEET_ID`、`SCHEDULE_SHEET_ID` 這四個常數
- **不可刪除** 任何現有 API 路由（`/categories`、`/folders`、`/files`、`/users`、`/auth`、`/upload`、`/rename`、`/move`、`/schedule`）
- **不可變更** Google Sheet 的欄位順序（只能在最後新增欄位）
- **不可跳過 worktree 流程**，所有變更必須在 worktree（`main-local` 分支）完成後，merge 到 `main` 再 push（Claude Code 負責執行 merge 與 push）

### 部署流程
1. 在 worktree 修改 `index.html` 或 `worker.js`
2. `git add` → `git commit`（worktree 自動 commit 到 `main-local`）
3. `cd` 到主專案 → `git merge main-local` → `git push origin main`
4. `worker.js` 異動時另外提醒使用者手動部署到 Cloudflare（見下方「Worker 部署方式」）

### Worker 部署方式
使用者有兩台電腦，兩台的部署方式不同，部署到的都是同一個 Worker `liminguploader`：

| 電腦 | 專案位置 | 部署方式 |
|------|----------|----------|
| 這台 | `C:\Users\c3012\source\repos\00.TjcProject\06.LimingUploader` | 把專案根目錄的 `worker.js` 貼到 Cloudflare Dashboard（連結在「注意事項」） |
| 另一台 | `source\github\Projects\LimingUploader` | 在那台執行 `wrangler deploy` |

- 開始改之前、部署之前都要先 `git pull`，用 `main` 最新的 `worker.js` 部署。後部署的版本會整個蓋掉先部署的，另一台還沒 push 的修改會不見
- repo 裡的 `wrangler.jsonc`（name `tjclm-drive`）**不是**線上用的設定，不要在這個 repo 直接跑 `wrangler deploy`，否則會部署到另一個叫 `tjclm-drive` 的 Worker
- 用 wrangler 部署時，設定檔要和線上一致：
  - name 是 `liminguploader`
  - `triggers.crons` 是 `0 0 20,25 * *`
  - `routes` 要有分享短連結的自訂網域：`[{ "pattern": "share.liming-tjc.org", "custom_domain": true }]`
  - 一般變數 `FOLDER_ID`、`GEMINI_API_KEY`、`NOTION_PARENT_PAGE_ID`、`UPLOAD_PASSWORD` 都要寫進去，設定檔沒寫到的一般變數部署後會被刪掉
- `NOTION_TOKEN`、`SERVICE_ACCOUNT_KEY` 是用 Secret 存的，兩種部署方式都不會動到

---

## 排程（Cloudflare Cron Triggers）

| Cron | 執行內容 |
|------|----------|
| `0 0 20,25 * *` | `runMonthlyConvert`：每月 20 號台灣 08:00 自動轉檔「下個月」安排表；25 號只補做還沒轉好的月份（不覆蓋已轉好的）；完成或失敗都用小幫手 LINE 通知 Config 頁籤 `convert_notify` 指定的人 |
| 其他任何 Cron | `runDailySummarize`：整理前一天的錄音重點 |

- 每月轉檔的 Cron 字串必須和 `worker.js` 的 `MONTHLY_CONVERT_CRON` 一模一樣，否則會被當成每日錄音整理
- Cron 可以在 Dashboard 設定；用 wrangler 部署時，設定檔的 `triggers.crons` 也要寫同一個字串

---

## 注意事項
- `worker.js` 以 git 專案根目錄的版本為主，`C:\Users\c3012\Downloads\worker.js` 已廢棄，請勿再編輯
- 修改 `worker.js` 後必須提醒使用者重新部署：在這台貼到以下連結，或在另一台用 `wrangler deploy`（見「Worker 部署方式」）：
  **https://dash.cloudflare.com/8e2eb47cb86e3cfb953c89dd148b6137/workers/services/view/liminguploader/production**
- `Users` 頁籤**有標題列**，程式讀取時會跳過第一列
- `Schedule` 頁籤**有標題列**，程式讀取時會跳過第一列
- 錄音「剪輯」用到 Worker 的 `/audio`（串流雲端上的 MP3，支援 Range）與 `/replace-url`（建立取代 MP3 內容的續傳網址），兩者都只接受 MP3；取代前會把原本的版本設成永久保留，剪錯可從 Google 雲端硬碟的「管理版本」還原，檔案 ID 與連結不變
