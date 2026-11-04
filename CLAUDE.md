# LimingUploader — 專案說明與開發規則

## 架構概覽

| 檔案 | 說明 |
|------|------|
| `index.html` | 主要前端頁面，部署於 GitHub Pages |
| `gallery.html` | 分享用圖庫頁（也可上傳），部署於 GitHub Pages |
| `upload.js` | 上傳引擎（分段續傳、斷線自動繼續、略過已存在檔案、關掉頁面後可一鍵繼續：檔案記在 IndexedDB），index.html 與 gallery.html 共用；修改後要更新兩個頁面引用處的 `?v=` 版本號 |
| `mp3-trim.js` | MP3 去頭去尾（直接切 frame、不重新壓縮），index.html 檔案列表的「剪輯」使用；修改後要更新 index.html 引用處的 `?v=` 版本號 |
| `print.html` | A4 圖片列印工具（手機選圖、旋轉、縮放、上中下位置，直接列印或存成 PDF），純前端不上傳也不呼叫 Worker；說明見「A4 圖片列印」一節 |
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

## A4 圖片列印（`print.html`）

寶庫 repo 裡一個獨立的網頁：在手機上選一張照片，旋轉、縮放、放在紙的上中下，直接列印或存成一頁 A4 的 PDF。照片只在手機上處理，不上傳、不呼叫 Worker。2026-09-16 上線。

### 從哪裡進去 [同工]

- 整合平台（liming-tjc.org）首頁「友站」裡的「A4 圖片列印」，技術頁也有一個
- 直接打開 `https://tjc-km.github.io/LimingUploader/print.html`，不用登入
- **黎明寶庫首頁目前沒有入口**：類別設定 Sheet 沒有這一列（2026-11-04 查）
  - 🔧 要在寶庫首頁放方塊：Sheet1 加一列，A 填名稱（例如「A4 圖片列印」）、B 填圖示（例如 🖨️）、C 填 `link`、E 填上面的網址、H 填 `TRUE`。改完重新整理首頁就出現，不用部署

### 怎麼用 [同工]

1. 用瀏覽器打開。在 LINE 裡點連結，頁面會自動改用外部瀏覽器開；沒跳成功時會出現黃色提示，點右上角選單改用瀏覽器開啟
2. 按「選擇照片」，選一張
3. 調整：
   - 旋轉：「↺ 左轉」「↻ 右轉」，每次 90 度
   - 位置：放在紙的「上」「中」「下」（預設「上」）
   - 大小：按「−」「＋」或拉桿，10%～100%；100% 是剛好放滿紙張扣掉四邊各 1 公分
   - 預覽圖上的藍色虛線就是可以印的範圍
4. 按「🖨️ 列印」或「📄 存成 PDF」，列印時紙張選 A4
   - iPhone：「存成 PDF」會跳出分享選單，可以直接選「列印」或「儲存到檔案」
   - Android：「存成 PDF」直接下載到「下載」資料夾，打開後再印
5. 要印下一張，按「換一張照片」

### 常見問題 [同工]

| 狀況 | 原因 | 怎麼辦 |
|------|------|--------|
| 在 LINE 裡按「列印」沒反應 | LINE 的內建瀏覽器不能列印 | 點右上角選單，改用瀏覽器開啟 |
| 按「列印」沒反應 | 有些手機瀏覽器不支援網頁直接列印 | 改按「存成 PDF」，打開 PDF 後再列印 |
| 印表機印得很慢 | 印表機收到圖片常會切成相片模式 | 改用「存成 PDF」再印，PDF 會用一般文件模式 |
| 出現「PDF 已準備好，請再按一次『存成 PDF』」 | **正常**。PDF 還在產生時就按了，iPhone 只允許「點下去的當下」跳出分享選單 | 再按一次就好 |
| 出現「無法讀取這張圖片，請改選 JPG 或 PNG」 | 瀏覽器解不開這種圖片格式 | 改選 JPG、PNG，或用手機截圖再選截圖 |
| 出現「照片太大或格式不支援」 | 照片縮小後還是畫不出來 | 換一張試試 |
| 印出來四邊有白邊 | **正常**。刻意留各 1 公分安全邊界，避開印表機印不到的地方 | 不能印滿版；大小最多到 100% |

### 運作方式與設計原因 [維護]

| 項目 | 做法 | 為什麼 |
|------|------|--------|
| 上線方式 | 一個純前端檔案，推上 GitHub 約 1 分鐘生效 | 沒有後端，**不用部署 Worker**，也不用改 Sheet |
| 存成 PDF，不存成圖片 | 上線當天（2026-09-16）就從「存成圖片」改成「存成 PDF」 | 印表機收到圖片常會切成慢速的相片模式；PDF 走一般文件模式 |
| PDF 怎麼做的 | 程式自己組一頁 A4 的 PDF，把 200 DPI（1654 × 2339 像素）的 JPEG 原封不動放進去 | 不用外部函式庫，也不重新壓縮，畫質不會再變差 |
| 版面畫進圖裡 | 白邊、位置、大小都直接畫在那張 A4 的圖上 | 不管從哪條路列印、印表機怎麼縮放到紙張，版面比例都不會跑掉 |
| 照片太大先縮小 | 先縮到面積 1200 萬像素、長邊 2400 像素以內，畫完再檢查是不是空白 | iPhone 的畫布有上限（約 1670 萬像素），超過**不會報錯，只會畫成空白**；200 DPI 列印用不到更大 |
| 照片方向 | 讀照片時瀏覽器已經依手機拍攝方向轉正，之後才套用旋轉 | 直拍的照片不會一開始就是橫的 |
| iPhone、Android 分開處理 | iPhone 跳分享選單，Android 直接下載 | iPhone 的分享選單可以直接列印；Android 的分享選單不能列印 |
| LINE | 偵測到 LINE 就在網址加 `openExternalBrowser=1` 重新開啟 | LINE 內建瀏覽器不能列印；這個參數會讓 LINE 改用外部瀏覽器 |

### 已知限制 [維護]

- 一次只能放一張照片、印一頁
- 只有直式 A4；橫的照片用「旋轉」轉過來
- 不能裁切，也不能放大超過 100%（不能印滿版無白邊）

### 程式說明 [程式]

- 常數在 `<script>` 開頭：`MARGIN`（四邊安全邊界 10 mm）、`OUTPUT_DPI`（200）、`MAX_SRC_LONG`（來源長邊上限 2400）、`AREA_CAP`（單一 canvas 面積上限 1200 萬）、`ZOOM_MIN`／`ZOOM_MAX`／`ZOOM_STEP`
- `buildLevels()` 產生來源圖和 1/2、1/4… 的縮圖鏈（縮到 128 px 為止），`pickLevel()` 繪製時挑最接近的尺寸，縮小時才不會鋸齒；`looksBlank()` 檢查 iPhone 畫成全透明的情況
- `computeLayout()` 以 mm 計算位置大小，`drawPage()` 同時給預覽（加藍色虛線）和輸出用
- 設定改動 300 ms 後 `ensureOutput()` 先把 JPEG 和 PDF 做好；`settingsVersion` 避免舊的結果蓋掉新設定。先做好是因為 iPhone 的 `navigator.share()` 只能在點擊當下呼叫，中間等太久會被拒絕
- 「列印」用 `window.print()`：`@page { size: A4 portrait; margin: 0 }`，`@media print` 只印 `#print-img`
- `buildPdf()` 手寫 PDF 結構（Catalog、Pages、Page、Image XObject 用 `DCTDecode`、內容串流），MediaBox 是 595.28 × 841.89 pt
- `freeCanvas()` 把用完的 canvas 寬高設成 0，iOS 的 canvas 總記憶體有上限，不主動釋放會越用越容易畫成空白

---

## 注意事項
- `worker.js` 以 git 專案根目錄的版本為主，`C:\Users\c3012\Downloads\worker.js` 已廢棄，請勿再編輯
- 修改 `worker.js` 後必須提醒使用者重新部署：在這台貼到以下連結，或在另一台用 `wrangler deploy`（見「Worker 部署方式」）：
  **https://dash.cloudflare.com/8e2eb47cb86e3cfb953c89dd148b6137/workers/services/view/liminguploader/production**
- `Users` 頁籤**有標題列**，程式讀取時會跳過第一列
- `Schedule` 頁籤**有標題列**，程式讀取時會跳過第一列
- 錄音「剪輯」用到 Worker 的 `/audio`（串流雲端上的 MP3，支援 Range）與 `/replace-url`（建立取代 MP3 內容的續傳網址），兩者都只接受 MP3；取代前會把原本的版本設成永久保留，剪錯可從 Google 雲端硬碟的「管理版本」還原，檔案 ID 與連結不變
- 剪輯視窗有兩個做法：「剪輯並下載」把剪好的錄音存到手機或電腦（檔名加 `_剪輯`，雲端原檔不動），「剪輯並取代」換掉雲端上的原檔。兩個都在瀏覽器裡剪，同一個視窗裡原始錄音只下載一次
  - 🔧 在 LINE 裡打開不能下載：LINE 內建瀏覽器存不了網頁產生的檔案，畫面會請使用者改用瀏覽器開啟後再剪一次
  - 下載的位置：iPhone 在「檔案」App 的「下載項目」，Android 在「下載」資料夾；剪輯處理太久時瀏覽器可能不自動下載，畫面上會留「沒有開始下載的話請按這裡」的連結
