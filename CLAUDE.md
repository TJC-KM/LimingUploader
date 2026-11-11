# LimingUploader — 專案說明與開發規則

## 架構概覽

| 檔案 | 說明 |
|------|------|
| `index.html` | 主要前端頁面，部署於 GitHub Pages |
| `gallery.html` | 分享用圖庫頁（也可上傳），部署於 GitHub Pages |
| `upload.js` | 上傳引擎（分段續傳、斷線自動繼續、略過已存在檔案、關掉頁面後可一鍵繼續：檔案記在 IndexedDB），index.html 與 gallery.html 共用；修改後要更新兩個頁面引用處的 `?v=` 版本號 |
| `mp3-trim.js` | MP3 去頭去尾（直接切 frame、不重新壓縮），index.html 檔案列表的「剪輯」使用；修改後要更新 index.html 引用處的 `?v=` 版本號 |
| `print.html` | A4 圖片列印工具（手機選圖、旋轉、縮放、上中下位置，直接列印或存成 PDF），純前端不上傳也不呼叫 Worker；說明見「A4 圖片列印」一節 |
| `planner.html` | 年度活動規劃（各團契預排全年活動，標出撞期、太近的日子），經 Worker 的 `/plan` 讀寫 Google 試算表「黎明教會行事曆」；說明見「年度活動規劃」一節 |
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
- **不可刪除** 任何現有 API 路由（`/categories`、`/folders`、`/files`、`/users`、`/auth`、`/upload`、`/rename`、`/move`、`/schedule`、`/plan`、`/plan/delete`）
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

## 年度活動規劃（`planner.html`）

各團契、成人詩班、宣道股、教育股和教會先把想辦的活動填上去，畫面會標出同一群人「撞期」或「太近」的日子，趁日期還是暫定的時候就能調開。資料存在 Google 試算表，由寶庫的 Worker 讀寫。2026-11-11 建立。

要解決的問題：社青、中堅、迦勒、全家信主團契、成人詩班、中區的社青／中堅／迦勒聯契和其他活動，常常擠在年底，而且大家多半只在安息日見面，等發現同一群人連著好幾個週末都有活動時，已經來不及調。

### 從哪裡進去 [同工]

- 打開 `https://tjc-km.github.io/LimingUploader/planner.html`，不用登入
- 契長可以直接用自己那一頁的網址，加到手機主畫面：網址後面加 `#g-youth`（社青團契）、`#g-core`（中堅團契）、`#g-caleb`（迦勒團契）、`#g-family`（全家信主團契）、`#g-choir`（成人詩班）、`#g-mission`（宣道股）、`#g-edu`（教育股）、`#g-church`（教會與中區）；全年總表是 `#overview`
- **黎明寶庫首頁目前沒有入口**
  - 🔧 要在寶庫首頁放方塊：類別設定 Sheet 的 Sheet1 加一列，A 填「年度活動規劃」、B 填圖示（例如 🗓️）、C 填 `link`、E 填上面的網址、H 填 `TRUE`。改完重新整理首頁就出現，不用部署

### 怎麼用 [同工]

1. 首頁按「我是…」底下自己負責的那一個
2. 「全年的週末」每一格是一天：上面一排是週六（安息日）、下面一排是週日；那個月有平日活動時會多一排「平日」。點一格看那天和前後 7 天有什麼
3. 按右下角「新增活動」，填：
   - 活動名稱
   - 日期；好幾天的活動再填「到哪一天」
   - 誰會參加：「社青自己」「社青家屬」「全教會都可以參加」（以社青為例）。宣道股、教育股是「全教會都可以參加」或「宣道股同工」「教育股同工」。「教會與中區」那一頁的中區聯契，要選對應的聯契，系統才知道是哪個團契的人
   - 日期定了嗎：「暫定，還可以調」或「確定了」
   - 時間、備註可以不填
4. 選日期的當下，面板會列出前後 7 天的活動、會不會撞期；有撞到時會列出「附近不會撞到的日子」，點一下就改過去
5. 按「儲存」。別人重新整理，或切到別的 App 再切回來，就看得到
6. 要改或刪除，在自己那一頁的活動清單按「修改」；「刪除」要按兩次
7. 「看全年總表」一天一列列出全年的活動和提醒，可以勾「只看有問題的日子」；每個月最後一行是「空著的週末」

### 怎麼判斷撞期、太近 [同工]

| 顏色 | 名稱 | 條件 |
|------|------|------|
| 紅 | 撞期 | 同一群人同一天有 2 個活動，或同一天有 3 個以上活動 |
| 黃 | 太近 | 同一群人 7 天內有 2 個以上活動，例如安息日接週日，或連續兩個安息日 |

誰算「同一群人」：
- 社青團契和中區社青聯契算同一群人，中堅、迦勒也一樣
- 成人詩班的人分散在各團契，詩班的活動算每個團契都有人
- 宣道股、教育股的同工也分散在各團契，股的活動不管選哪一個，都算每個團契都有人
- 帶家屬的活動：家屬可能在別的團契，算每個團契都有人
- 全教會都可以參加的活動，算每個人都有份

「空著的週末」是週六、週日都還沒有活動，日期寫週六那天。

### 常見問題 [同工]

| 狀況 | 原因 | 怎麼辦 |
|------|------|--------|
| 一打開就出現「連不上網路」或「伺服器出了問題」 | 手機沒網路，或 Worker 出問題 | 按「重新讀取」；一直不行請維護的人看 Worker |
| 按「儲存」後出現「連不上網路，請稍後再試一次」 | 網路斷了，**這次沒有存到** | 面板還開著、填的字都在，網路恢復後再按一次「儲存」 |
| 出現「找不到這個活動，可能已經被刪除了」 | 別人剛好把這個活動刪了 | 畫面會自動重新讀取；還要辦的話重新新增 |
| 看不到別人剛改的活動 | 畫面是打開的時候讀的 | 重新整理，或切到別的 App 再切回來 |
| 自己團契的活動被別人改了 | **有網址的人都能改任何團契的活動**（刻意不設密碼） | 改回來就好；改壞很多時，維護的人可以從試算表的「版本記錄」還原 |
| 黃色提醒很多 | 年底活動本來就擠 | 趁「暫定」時調開；確定要辦的可以不理 |

### 資料存在哪裡 [維護]

Google 試算表「黎明教會行事曆」（放在共用雲端硬碟，ID 寫在 `worker.js` 的 `PLANNER_SHEET_ID`）的「活動」分頁，一列一個活動，第一列是標題。寶庫 Worker 的服務帳戶已經有這份試算表的編輯權（2026-11-11 查），不用另外分享。這份試算表是「知道連結的人可檢視」，**不能放密碼、金鑰**。

| 欄 | 名稱 | 內容 | 沒填／填錯會怎樣 |
|----|------|------|----------------|
| A | 編號 | 網頁自動產生（`e` 開頭） | 沒有編號的列**不會顯示**；改了編號，網頁就改不到那一列 |
| B | 團契 | 下拉選單：社青團契、中堅團契、迦勒團契、全家信主團契、成人詩班、宣道股、教育股、教會與中區 | 別的字（例如只打「社青」）那一列**不會顯示** |
| C | 活動名稱 | | 空白會顯示「（沒有名稱）」 |
| D | 開始日期 | 日期，顯示成 2027-03-20 | 不是日期，那一列**不會顯示** |
| E | 結束日期 | 一天的活動留空 | 比開始日期早，當成一天的活動 |
| F | 誰會參加 | 下拉選單：自己、家屬、全教會；中區聯契填社青團契／中堅團契／迦勒團契（表示那個團契的人） | 空白或別的字：教會與中區、宣道股、教育股的活動當「全教會」，其他當「自己」，**不會報錯** |
| G | 狀態 | 下拉選單：暫定、確定 | 別的字當「暫定」 |
| H | 時間 | 例如 14:00 | 格式不對就不顯示時間 |
| I | 備註 | | |
| J | 建立時間 | 網頁自動填，台灣時間 | 只是紀錄 |
| K | 修改時間 | 網頁自動填 | 只是紀錄 |
| L | 刪除時間 | 網頁按「刪除」時自動填 | 有填的列**不會顯示**；刪錯了把這格清掉就回來 |

- 欄位順序不能改，只能在最後面加欄：Worker 是照欄位的位置讀寫
- B、F、G 下拉選單的字要和 `worker.js` 的 `PLAN_GROUPS`、`PLAN_AUDIENCE` 一模一樣，改了要一起改並重新部署 Worker
- 直接在試算表新增活動也可以，A 欄自己填一個不重複的編號就好

> 🚨 刪除活動請在網頁按「刪除」，或在 L 欄填時間，不要刪掉整列。網頁存檔時是先找到那一列再寫回去，剛好有人在試算表刪列、插入列或排序時，可能寫到別的活動。真的要整理試算表，挑沒人在用的時候。

### 設計原因 [維護]

| 項目 | 做法 | 為什麼 |
|------|------|--------|
| 不設密碼 | 有網址的人都能新增、修改、刪除任何團契的活動 | 使用者決定（2026-11-11）：長輩點開就能用，不用記密碼。代價是誰都改得到別人的，改壞時從試算表的版本記錄還原 |
| 放在寶庫 | 網頁是寶庫 repo 的一個檔案，後端加在寶庫 Worker | 寶庫 Worker 的服務帳戶已經能寫這份試算表，不用另外設金鑰、另外部署 |
| 資料放 Google 試算表 | Worker 用服務帳戶讀寫 | 維護的人可以直接打開來看、改、匯出 |
| 一天一天看，不以週為單位 | 週六、週日各一格，各自判斷 | 示範版原本把週一到週日算一週、用安息日當名字，但週日的活動不少，被併進前一個安息日就看不出來。2026-11-11 使用者要求改成以天為單位 |
| 「太近」是 7 天 | `NEAR_DAYS = 7` | 剛好涵蓋「安息日接週日」和「連續兩個安息日」 |
| 詩班、各股、家屬、全教會算每個團契 | | 大家會跨團契參加（使用者確認詩班也是同一群人） |
| 只用亮色 | 手機設成深色模式，網頁也維持亮色 | 使用者要求（2026-11-11）。`<meta name="color-scheme" content="only light">` 也擋掉 Chrome 自動把網頁轉暗 |
| 刪除只填 L 欄 | 不刪列 | 見上面 🚨；也讓刪錯的可以救回來 |
| 名稱、備註照字存 | Worker 寫入時前面加 `'` | 不加的話，`=` 開頭會變成公式，像數字或日期的字會被試算表改掉 |

### 已知限制 [維護]

- 沒有登入，不知道是誰改的；試算表只記建立、修改、刪除的時間
- 各團契頁的網址（`#g-youth`…）分享到 LINE 都是同一張預覽卡片「黎明教會年度活動規劃」：LINE 抓預覽時看不到 `#` 後面
- 年份只能選兩年：1～8 月是去年和今年，9 月起是今年和明年
- 只看日期不看時間：同一天早上、下午各一個活動也算撞期
- 團契是寫在程式裡的，加團契要改程式（見下面）

### 程式說明 [程式]

- Worker 路由（不用密碼）：`GET /plan` 回傳全部活動（已刪除、認不得的列不回傳）；`POST /plan` 的 body 是 `{ event }`，有 `id` 是修改、沒有是新增，回傳存好的 `event`；`POST /plan/delete` 的 body 是 `{ id }`，只填 L 欄
- 試算表文字和前端代碼的對照在 `worker.js`：`PLAN_GROUPS`（團契代碼 → B 欄）、`PLAN_AUDIENCE`（self／family／all → F 欄）、`PLAN_DISTRICT_GROUPS`（F 欄可以填的團契）、`PLAN_CHURCH_WIDE`（F 欄空白時當「全教會」的）；`planCheck()` 檢查送來的資料，`planRowToEvent()` 把一列轉成活動
- 新增用 `append` 加 `insertDataOption=OVERWRITE`：寫進下一個空列，不插入新列，才會沿用原本設好的日期格式和下拉選單；修改時先讀整張表找到編號那一列，再寫 A～I 和 K
- `planner.html`：`GROUPS`、`PEOPLE`、`DISTRICT`、`STAFF`（各股）、`EVERYWHERE` 定義團契和「誰算同一群人」；`analyze()` 算一年的撞期、太近和空著的週末；`suggestions()` 把活動往前後挪 1～8 週各重算一次，挑出不會有提醒的日子
- 要加一個團契：`worker.js` 的 `PLAN_GROUPS`、`planner.html` 的 `GROUPS` 和 `PEOPLE`、CSS 的 `--g-<代碼>` 顏色和 `.g-<代碼>`、試算表 B 欄的下拉選單，都要加。加的是「股」（同工分散在各團契）就不加 `PEOPLE`，改加 `STAFF` 和 `PLAN_CHURCH_WIDE`
- 改了 `worker.js` 要部署 Worker（見「Worker 部署方式」）；只改 `planner.html` 推上 GitHub 約 1 分鐘生效

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
