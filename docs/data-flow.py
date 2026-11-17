# 產生黎明寶庫（LimingUploader）資料流程圖 docs/data-flow.svg
# 用法：python docs/data-flow.py　（改圖請改這支，不要手改 SVG；畫法見 ~/.claude/rules/diagram-dataflow.md）
import os
import sys
from xml.sax.saxutils import escape

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data-flow.svg')
FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif"
BLUE, GREEN, GOLD, GRAY, DARK = '#7c9cc4', '#7fa87f', '#c9a15c', '#8b93a6', '#4a5164'
LINE_H, PAD_TOP, PAD_BOT, HEAD = 19, 14, 10, 30

parts = []
def add(s): parts.append(s)

def box_h(n):
    return HEAD + PAD_TOP + n * LINE_H + PAD_BOT

class Box:
    def __init__(self, x, y, w, lines):
        self.x, self.y, self.w = x, y, w
        self.h = box_h(len(lines))
    @property
    def bottom(self): return self.y + self.h
    @property
    def right(self): return self.x + self.w

def box(x, y, w, title, lines, color, bold_first=False):
    b = Box(x, y, w, lines)
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{b.h}" fill="#ffffff" stroke="{color}" stroke-width="1.6" rx="7"/>')
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{HEAD}" fill="{color}" rx="7"/>')
    add(f'<rect x="{x}" y="{y + HEAD - 8}" width="{w}" height="8" fill="{color}"/>')
    add(f'<text x="{x + 14}" y="{y + 20}" font-size="14.5" font-weight="700" fill="#ffffff">{escape(title)}</text>')
    for i, t in enumerate(lines):
        ty = y + HEAD + PAD_TOP + 4 + i * LINE_H
        weight = ' font-weight="700"' if (bold_first and i == 0) else ''
        fill = '#1a1d24' if (bold_first and i == 0) else '#4a5164'
        add(f'<text x="{x + 14}" y="{ty}" font-size="12.5"{weight} fill="{fill}">{escape(t)}</text>')
    return b

def arrow(points, color, dashed=False, label=None, lx=None, ly=None, anchor='middle'):
    d = 'M' + ' L'.join(f'{px} {py}' for px, py in points)
    dash = ' stroke-dasharray="5 4"' if dashed else ''
    mid = {BLUE: 'ab', GREEN: 'ag', GOLD: 'ao', GRAY: 'ay'}[color]
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.8"{dash} marker-end="url(#{mid})"/>')
    if label:
        add(f'<text x="{lx}" y="{ly}" font-size="11.5" fill="{color}" font-weight="700" text-anchor="{anchor}">{escape(label)}</text>')

def overlap_mid(a, b, label):
    # 兩個方塊上下重疊範圍的正中間；重疊太少就停下來，免得箭頭貼著框邊
    top, bottom = max(a.y, b.y), min(a.bottom, b.bottom)
    assert bottom - top >= 30, f'{label} 的箭頭：兩個方塊只重疊 {bottom - top}px'
    return (top + bottom) // 2

def hline(a, b, color, label, y=None):
    # 兩個方塊之間的水平箭頭，沒指定高度就取重疊範圍的正中間
    if y is None:
        y = overlap_mid(a, b, label)
    arrow([(a.right, y), (b.x, y)], color, label=label, lx=(a.right + b.x) // 2, ly=y - 6)
    return y

# 欄位置：每欄之間至少留 80px 放標籤
AX, AW = 30, 270
BX, BW = 385, 420
IX, IW = BX + 15, BW - 30
CX, CW = 905, 300
DX, DW = 1320, 290
W = DX + DW + 30

# 處理欄的方塊行數，先算出 Worker 外框的高度
B_TOP = 112
B_ORDER = ['b1', 'b2', 'b4', 'b5', 'b6']
B_LINES = {'b1': 7, 'b2': 3, 'b4': 7, 'b5': 4, 'b6': 3}
GAP = 12
y = B_TOP + 58
B_Y = {}
for k in B_ORDER:
    B_Y[k] = y
    y += box_h(B_LINES[k]) + GAP
B_BOTTOM = y - GAP + 16

add('<text x="30" y="40" font-size="20" font-weight="700" fill="#1a1d24">黎明寶庫 LimingUploader：資料流程</text>')
add('<text x="30" y="63" font-size="13" fill="#5c6270">四個畫面：① 寶庫首頁　② 分享圖庫　③ LINE 分享卡片　④ 教會活動　｜　藍＝照片與檔案　綠＝教會活動　金＝安排表與 AI　灰＝設定、只讀</text>')
for x, t in [(AX, '來源'), (BX, '處理'), (CX, '資料'), (DX, '畫面（讀資料都經由 Worker）')]:
    add(f'<text x="{x}" y="100" font-size="14" font-weight="700" fill="#1a1d24">{escape(t)}</text>')

# B 欄：Worker
add(f'<rect x="{BX}" y="{B_TOP}" width="{BW}" height="{B_BOTTOM - B_TOP}" fill="#f1f3f7" stroke="#b9c2d4" rx="8"/>')
add(f'<text x="{BX + 14}" y="{B_TOP + 22}" font-size="14.5" font-weight="700" fill="#1a1d24">Cloudflare Worker：liminguploader</text>')
add(f'<text x="{BX + 14}" y="{B_TOP + 42}" font-size="12" fill="#5c6270">網頁呼叫（只接受 tjc-km.github.io）＋每月 20、25 號 08:00 排程</text>')
B1 = box(IX, B_Y['b1'], IW, '寶庫：資料夾與檔案', [
    '新增資料夾、改名',
    '刪除＝搬到刪除區（類別專屬的，沒設用全域）',
    '上傳：給續傳網址，瀏覽器直接傳到 Drive',
    '　100MB 以下也可以由 Worker 轉傳',
    '錄音剪輯：讀雲端上的 MP3（/audio）',
    '　取代原檔：檔案 ID 不變，原版本永久保留',
    '不用密碼：有網址的人都能用這些功能',
], BLUE)
B2 = box(IX, B_Y['b2'], IW, 'LINE 發布', [
    '發送對象 ← LINE 排程試算表的 Users',
    '寫一列到 Schedule：時間、對象、圖片或卡片',
    '狀態「待發送」，由另一個系統依時間送出',
], BLUE)
B4 = box(IX, B_Y['b4'], IW, '安排表轉檔', [
    '每月 20 號 08:00 轉「下個月」的安排表',
    '　25 號只補做還沒轉好的，不覆蓋',
    '也可以在 ① 寶庫首頁按「轉檔」',
    'xlsx 匯成暫存試算表 → 程式解析',
    '　解析不出來才請 Gemini（convert_prompt）',
    '寫進「<年>年安排表」的月份頁籤',
    '成功、失敗都寫一列到小幫手的 LINE 排程',
], GOLD)
B5 = box(IX, B_Y['b5'], IW, '教會活動（/plan）', [
    '不用密碼，有網址的人都能新增、修改',
    '新增、修改：檢查後寫 A～I 欄和 K 欄',
    '刪除：只填 L 欄（刪除時間），不刪整列',
    '名稱、備註前面加 \' 照字存，不會變成公式',
], GREEN)
B6 = box(IX, B_Y['b6'], IW, '網頁服務（只讀）', [
    '類別、資料夾、檔案清單 → ① ②',
    '分享卡片頁 ③：查相簿名稱和封面，再轉到 ②',
    '活動清單 → ④（已刪除、認不得的列不給）',
], GRAY)

# C 欄：資料（對齊處理欄，箭頭才能畫成水平線）
C1 = box(CX, B1.y, CW, 'Google Drive 各類別資料夾', [
    '照片、影片、文件、錄音的正本',
    '大多在共用雲端硬碟',
    '　聚會錄音在 lmf@ 的雲端硬碟',
    '刪除區：被刪的檔案搬到這裡',
    '✎ 可以直接在雲端硬碟整理',
], DARK, bold_first=True)
C2 = box(CX, max(B2.y, C1.bottom + 14), CW, 'LINE 排程試算表（兩本）', [
    '主帳號：Users 發送對象、Schedule 待發送',
    '小幫手：安排表轉檔的通知',
    '實際發送由另一個系統（GAS）負責',
], GRAY)
C4 = box(CX, max(B4.y, C2.bottom + 14), CW, 'Gemini（Google AI，外部）', [
    '解析安排表（程式解析不出來時）',
    'worker.js 裡寫死 gemini-flash-latest',
    '金鑰：Cloudflare 變數 GEMINI_API_KEY',
], GOLD)
C5 = box(CX, C4.bottom + 14, CW, '「<年>年安排表」試算表', [
    '在 Drive 安排表輸出資料夾',
    '每月一個頁籤（民國年月，例 11512）',
    '✎ 可以直接修正',
], DARK)
C6 = box(CX, max(B5.y, C5.bottom + 14), CW, '試算表「黎明教會行事曆」', [
    '活動分頁：一列一個活動，A～L 欄',
    '✎ 可以直接改；刪除填 L 欄，不刪列',
    '知道連結的人可以檢視',
], DARK)
C7 = box(CX, C6.bottom + 14, CW, '國定假日資料（外部）', [
    'GitHub ruyut/TaiwanCalendar',
    '人事行政總處辦公日曆表轉成 JSON',
    '經 jsDelivr，網頁直接讀，不經 Worker',
], GRAY)

# A 欄：來源
A1 = box(AX, B1.y, AW, '手機、電腦裡的檔案', [
    '照片、影片、文件',
    '在 ① 寶庫首頁或 ② 圖庫選檔上傳',
    '大檔直接傳到 Google（續傳）',
    '斷線、關掉頁面可以接著傳',
], BLUE)
A3 = box(AX, B4.y, AW, '每月聚會安排表 ✎', [
    'Drive 安排表來源資料夾',
    '民國年月命名的 xlsx',
    '例：11512聚會安排表.xlsx',
], GOLD)
A4 = box(AX, max(B5.y, A3.bottom + 18), AW, '類別設定試算表 ✎', [
    'Sheet1：一列一個類別',
    '　名稱、圖示、資料夾、排序、啟用',
    '　不顯示上傳、LINE 發布、刪除區',
    'Config：',
    '　convert_prompt：給 Gemini 的提示詞',
    '　convert_notify：轉檔通知誰',
    '改完重新整理網頁就生效',
], GRAY)

# D 欄：畫面
D1 = box(DX, 120, DW, '① 黎明寶庫首頁', [
    'tjc-km.github.io/LimingUploader',
    '類別方塊 ← 類別設定 Sheet1',
    '資料夾、檔案、縮圖 ← Drive',
    '按鈕（不用密碼）：',
    '　新增資料夾、上傳、改名、刪除',
    '　LINE 發布（類別有打勾才有）',
    '　錄音：剪輯',
    '　安排表檔：轉檔',
    '讀者：同工、弟兄姊妹',
], BLUE)
D2 = box(DX, D1.bottom + 40, DW, '② 分享圖庫', [
    'gallery.html?folderId=…',
    '照片、子資料夾 ← Drive',
    '也可以直接上傳照片',
    '讀者：收到分享連結的人',
], BLUE)
D3 = box(DX, D2.bottom + 40, DW, '③ LINE 分享卡片', [
    'share.liming-tjc.org/s/<資料夾 ID>',
    '相簿名稱、封面 ← Drive',
    'LINE 顯示預覽；點開轉到 ②',
], BLUE)
D4 = box(DX, max(C6.y, D3.bottom + 24), DW, '④ 教會活動', [
    'planner.html',
    '首頁：接下來的活動 ← 行事曆',
    '排活動、各團契頁：',
    '　新增、修改、刪除 → /plan',
    '　撞期、太近在網頁裡算',
    '紅字假日 ← 國定假日資料',
    '讀者：信徒；契長、各股負責人',
], GREEN)

# A → B
hline(A1, B1, BLUE, '照片、檔案', y=A1.y + 36)
hline(A3, B4, GOLD, 'xlsx', y=A3.y + 36)
ay = A4.bottom - 22
arrow([(A4.right, ay), (BX, ay)], GRAY, label='設定', lx=(A4.right + BX) // 2, ly=ay - 6)

# B → C
hline(B1, C1, BLUE, '寫入、搬移', y=B1.y + 36)
hline(B2, C2, BLUE, '待發送')
hline(B4, C4, GOLD, '解析')
hline(B4, C5, GOLD, '月份頁籤')
hline(B5, C6, GREEN, '活動')

# C → D：Drive 一條主線往下分給 ① ② ③
tx = C1.right + 30
y1 = C1.y + 36
arrow([(C1.right, y1), (DX, y1)], BLUE, label='資料夾、檔案', lx=(tx + DX) // 2, ly=y1 - 6)
y2 = D2.y + 36
arrow([(tx, y1), (tx, y2), (DX, y2)], BLUE, label='照片', lx=(tx + DX) // 2, ly=y2 - 6)
y3 = D3.y + 36
arrow([(tx, y2), (tx, y3), (DX, y3)], BLUE, label='名稱、封面', lx=(tx + DX) // 2, ly=y3 - 6)
hline(C6, D4, GREEN, '活動', y=C6.y + 36)
hline(C7, D4, GRAY, '假日')
# ③ 卡片點開 → ② 圖庫
arrow([(DX + DW - 40, D3.y), (DX + DW - 40, D2.bottom)], BLUE, dashed=True, label='點開', lx=DX + DW - 46, ly=D3.y - 12, anchor='end')

# 整張圖的高度：最低的方塊再往下留圖例的位置
H = max(B_BOTTOM, A4.bottom, C7.bottom, D4.bottom) + 66
ly = H - 30
add(f'<text x="30" y="{ly}" font-size="12" fill="#5c6270">實線＝系統自動流動　虛線＝人點連結　✎＝管理同工可以直接改的地方　畫面上的按鈕都是送到 Worker 處理　機敏值（試算表／資料夾 ID、金鑰）不在圖上，見 worker.js 開頭的常數與 Cloudflare 的變數</text>')
add('</svg>')

head = [
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">',
    '  <!-- 黎明寶庫（LimingUploader）的資料流程。由 docs/data-flow.py 產生，改圖請改腳本重新執行，不要手改這個檔。改動 Worker 路由、排程、試算表欄位、四個畫面的區塊時要同步更新。 -->',
    '<defs>',
]
for mid, c in [('ab', BLUE), ('ag', GREEN), ('ao', GOLD), ('ay', GRAY)]:
    head.append(f'<marker id="{mid}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L8 4.5 L0 9 z" fill="{c}"/></marker>')
head.append('</defs>')
head.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#fbfbfd" stroke="#d7dae0" rx="8"/>')

open(OUT, 'w', encoding='utf-8').write('\n'.join(head + parts) + '\n')
print('wrote', OUT, W, H)
