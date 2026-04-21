# LimingUploader — 專案說明與開發規則

## 架構概覽

| 檔案 | 說明 |
|------|------|
| `index.html` | 唯一前端檔案，部署於 GitHub Pages |
| `C:\Users\c3012\Downloads\worker.js` | Cloudflare Worker 後端，需手動部署 |

**後端 API：** `https://liminguploader.c3012312.workers.dev`  
**前端網址：** `https://tjc-km.github.io/LimingUploader/`

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

### 類別設定 Sheet（SHEET_ID）— Users 頁籤（含標題列）
| 欄 | 說明 |
|----|------|
| A | userId（LINE userId） |
| B | userName（LINE 顯示名稱） |

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
- **不可直接 push 到 `main`**，所有變更必須先在 worktree（`main-local` 分支）完成，merge 後再 push

### 部署流程
1. 在 worktree 修改 `index.html`
2. `git add` → `git commit`（worktree 自動 commit 到 `main-local`）
3. `cd` 到主專案 → `git merge main-local` → `git push origin main`
4. `worker.js` 異動時另外提醒使用者手動部署到 Cloudflare

---

## 注意事項
- `worker.js` 不在 git 版控內，存放於 `C:\Users\c3012\Downloads\worker.js`
- 修改 `worker.js` 後必須提醒使用者到 Cloudflare Dashboard 手動重新部署
- `Users` 頁籤**有標題列**，程式讀取時會跳過第一列
- `Schedule` 頁籤**有標題列**，程式讀取時會跳過第一列
