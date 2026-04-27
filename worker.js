// ========================================
// 設定區：修改這裡來調整基本設定
// ========================================

// 允許存取的前端網址（你的 GitHub Pages 網址）
const ALLOWED_ORIGIN = 'https://tjc-km.github.io';

// 刪除區資料夾 ID（移至此資料夾視為刪除）
const TRASH_FOLDER_ID = '1WySxHQ_iHr0wuBHdc7laT_N2CNfH3iCm';

// 類別設定 Google Sheet ID
const SHEET_ID = '1xuSBVb1bonQldMgaOZfhu4T2knqt91AJjTzG-YqoBn4';

// LINE 排程 Sheet ID
const SCHEDULE_SHEET_ID = '1oNBqAG8F041o9ts-7pIsJCt9dLyIyWhhEX6bxUVOV9k';

// 安排表來源資料夾（xlsx 原始檔，民國年命名）
const SCHEDULE_SOURCE_FOLDER_ID = '1dCj76vGVwzOLnzUg2gPpbCne5HSxz7N1';

// 安排表輸出資料夾（產生 Google Sheet，西元年命名）
const SCHEDULE_OUTPUT_FOLDER_ID = '1gCCmXEbRLQMgZsUvhk5y7K3rTtKSTCdM';

// ========================================
// CORS 設定：讓瀏覽器允許跨網域請求
// 每次請求都會帶上這些 headers
// ========================================
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Password, X-File-Meta',
    'Access-Control-Max-Age': '86400', // 預檢請求快取 24 小時
  };
}

// ========================================
// 主程式進入點
// 所有請求都會先經過這裡
// ========================================
export default {
  async fetch(request, env) {
    const headers = corsHeaders();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 瀏覽器在跨域請求前會先發 OPTIONS 預檢請求
    // 直接回應 204 讓瀏覽器知道可以繼續
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      // ========================================
      // 公開路由：不需要密碼，任何人都可以讀取
      // ========================================

      // 取得類別設定（公開，從 Google Sheet 讀取）
      if (path === '/categories' && method === 'GET') {
        const token = await getAccessToken(env);
        return await getCategories(token, headers);
      }

      // 列出指定資料夾下的子資料夾（公開）
      if (path === '/folders' && method === 'GET') {
        const token = await getAccessToken(env);
        const folderId = url.searchParams.get('folderId') || env.FOLDER_ID;
        return await listFolders(token, folderId, headers);
      }

      // 列出指定資料夾內的檔案（公開）
      if (path === '/files' && method === 'GET') {
        const token = await getAccessToken(env);
        const folderId = url.searchParams.get('folderId');
        return await listFiles(token, folderId, headers);
      }

      // 取得發送對象清單（公開，從 Users 頁籤讀取）
      if (path === '/users' && method === 'GET') {
        const token = await getAccessToken(env);
        return await getUsers(token, headers);
      }

      // 【暫時端點】讀取 Drive 中 xlsx 的內容（轉為 Google Sheet 再讀取，用完請移除）
      if (path === '/drivecsv' && method === 'GET') {
        const token = await getAccessToken(env);
        const fileId = url.searchParams.get('fileId');
        return await readXlsxAsSheet(token, fileId, headers);
      }

      // ========================================
      // 私密路由：需要密碼，才能新增或上傳
      // 專門用來驗證密碼的路由（不做任何 Drive 操作）
      if (path === '/auth' && method === 'POST') {
        const { password: inputPassword } = await request.json();
        if (inputPassword === env.UPLOAD_PASSWORD) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        } else {
          return new Response(JSON.stringify({ ok: false }), {
            status: 401,
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
      }

      // ========================================

      // 驗證密碼（只有私密路由才會執行到這裡）
      const password = request.headers.get('X-Password');
      if (password !== env.UPLOAD_PASSWORD) {
        return new Response(
          JSON.stringify({ error: '密碼錯誤，沒有權限執行此操作' }),
          {
            status: 401,
            headers: { ...headers, 'Content-Type': 'application/json' },
          }
        );
      }

      // 取得 Google OAuth Token（私密路由共用）
      const token = await getAccessToken(env);

      // 新增資料夾（需要密碼）
      if (path === '/folders' && method === 'POST') {
        const { name, parentId } = await request.json();
        return await createFolder(
          token,
          name,
          parentId || env.FOLDER_ID, // 沒有指定父資料夾就放在根目錄
          headers
        );
      }

      // 取得大檔案上傳網址（需要密碼）
      // 代理上傳：接收瀏覽器的檔案，轉傳給 Google Drive
      if (path === '/upload' && method === 'POST') {
        const { fileName, mimeType, folderId } = JSON.parse(
          decodeURIComponent(request.headers.get('X-File-Meta') || '{}')
        );

        const fileBuffer = await request.arrayBuffer();
        const boundary = '-------CloudflareWorkerBoundary';

        // 組合 multipart 請求內容
        const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
        const metaPart = [
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          metadata,
          '',
        ].join('\r\n');

        const filePart = `--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`;
        const ending = `\r\n--${boundary}--`;

        // 把文字和二進位檔案合併成一個 ArrayBuffer
        const encoder = new TextEncoder();
        const metaBytes = encoder.encode(metaPart);
        const filePartBytes = encoder.encode(filePart);
        const endingBytes = encoder.encode(ending);

        const body = new Uint8Array(
          metaBytes.byteLength + filePartBytes.byteLength +
          fileBuffer.byteLength + endingBytes.byteLength
        );
        let offset = 0;
        body.set(metaBytes, offset); offset += metaBytes.byteLength;
        body.set(filePartBytes, offset); offset += filePartBytes.byteLength;
        body.set(new Uint8Array(fileBuffer), offset); offset += fileBuffer.byteLength;
        body.set(endingBytes, offset);

        // 一次送出 multipart 請求
        const uploadRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: body,
          }
        );

        const result = await uploadRes.text();
        console.log('Google 回應狀態：', uploadRes.status);
        console.log('Google 回應內容：', result);
        return new Response(result, {
          status: uploadRes.status,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      // 重新命名檔案或資料夾（需要密碼）
      if (path === '/rename' && method === 'PATCH') {
        const { id, newName } = await request.json();
        return await renameItem(token, id, newName, headers);
      }

      // 移至刪除區（需要密碼）
      if (path === '/move' && method === 'PATCH') {
        const { id, fromParentId } = await request.json();
        return await moveItem(token, id, fromParentId, headers);
      }

      // 新增 LINE 排程（需要密碼）
      if (path === '/schedule' && method === 'POST') {
        const body = await request.json();
        return await addScheduleRow(token, body, headers);
      }

      // 音檔重點整理（需要密碼）
      if (path === '/summarize' && method === 'POST') {
        const { fileId, fileName } = await request.json();
        return await summarizeAudio(token, env, fileId, fileName, headers);
      }

      // 安排表轉檔（需要密碼）
      if (path === '/convert' && method === 'POST') {
        const { fileName } = await request.json();
        return await convertSchedule(token, env, fileName, headers);
      }

      // 找不到對應路由
      return new Response('Not found', { status: 404, headers });

    } catch (err) {
      // 統一錯誤處理：把錯誤訊息回傳給前端方便除錯
      return new Response(
        JSON.stringify({ error: err.message }),
        {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

// ========================================
// Google OAuth：取得存取 Token
// 用 Service Account 的 JSON 金鑰產生 JWT
// 再換成 Google API 的 access token
// ========================================
async function getAccessToken(env) {
  // 從環境變數讀取 Service Account 金鑰
  const key = JSON.parse(env.SERVICE_ACCOUNT_KEY);
  const now = Math.floor(Date.now() / 1000);

  // 建立 JWT Header（指定演算法）
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // 建立 JWT Payload（聲明這個 token 的用途和有效期）
  const payload = btoa(JSON.stringify({
    iss: key.client_email,           // 發行者：Service Account email
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets', // 權限範圍：Drive + Sheets 讀寫
    aud: 'https://oauth2.googleapis.com/token',     // 接收者：Google Token 端點
    iat: now,                        // 發行時間
    exp: now + 3600,                 // 有效期：1 小時後過期
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // 用私鑰簽署 JWT
  const signingInput = `${header}.${payload}`;
  const privateKey = await importPrivateKey(key.private_key);
  const signature = await signJWT(signingInput, privateKey);
  const jwt = `${signingInput}.${signature}`;

  // 用 JWT 換取 Google access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('無法取得 Google Token：' + JSON.stringify(data));
  }
  return data.access_token;
}

// 將 PEM 格式的私鑰轉換成 Web Crypto API 可用的格式
async function importPrivateKey(pem) {
  const pemContent = pem
    .replace(/-----[^-]+-----/g, '') // 移除 PEM 標頭和結尾
    .replace(/\s/g, '');             // 移除所有空白和換行
  const der = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// 用私鑰對 JWT 內容進行 RS256 簽署
async function signJWT(input, key) {
  const encoded = new TextEncoder().encode(input);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoded);
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ========================================
// Google Drive API 操作函式
// ========================================

// 列出根資料夾下的所有子資料夾
async function listFolders(token, rootFolderId, headers) {
  // 查詢條件：在根資料夾內、是資料夾類型、沒有被刪除
  const query = encodeURIComponent(
    `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,createdTime)&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 在指定位置新增資料夾
async function createFolder(token, name, parentId, headers) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,                                                    // 資料夾名稱
      mimeType: 'application/vnd.google-apps.folder',         // 指定為資料夾類型
      parents: [parentId],                                     // 放在哪個資料夾裡
    }),
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 列出指定資料夾內的所有檔案（不含子資料夾）
async function listFiles(token, folderId, headers) {
  // 查詢條件：在指定資料夾內、不是資料夾類型、沒有被刪除
  const query = encodeURIComponent(
    `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,size,createdTime,mimeType)&orderBy=createdTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 重新命名檔案或資料夾
async function renameItem(token, fileId, newName, headers) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: data.error?.message || '改名失敗' }),
      { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 將檔案或資料夾移至刪除區（不真正刪除）
async function moveItem(token, fileId, fromParentId, headers) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${TRASH_FOLDER_ID}&removeParents=${fromParentId}&supportsAllDrives=true&fields=id,parents`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: data.error?.message || '移動失敗' }),
      { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 從 Google Sheet 讀取類別設定
async function getCategories(token, headers) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A:I`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();

  if (!data.values || data.values.length < 2) {
    return new Response(JSON.stringify({ categories: [] }), {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 第一列是標題，從第二列開始是資料
  const [, ...rows] = data.values;
  const categories = rows
    .filter(row => (row[7] || '').toUpperCase() === 'TRUE') // enabled = TRUE 才顯示
    .map(row => ({
      name:     row[0] || '',
      icon:     row[1] || '📁',
      type:     row[2] || 'drive',   // 'drive' 或 'link'
      id:       row[3] || null,      // Google Drive 資料夾 ID
      url:      row[4] || null,      // 外部連結（type=link 時）
      sort:     row[5] || 'asc',     // 'asc' 或 'desc'
      noUpload:     (row[6] || '').toUpperCase() === 'TRUE',
      linePublish:  (row[8] || '').toUpperCase() === 'TRUE', // I欄：是否顯示 LINE 發布按鈕
    }));

  return new Response(JSON.stringify({ categories }), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 從 Google Sheet 的 Users 頁籤讀取發送對象清單
async function getUsers(token, headers) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SCHEDULE_SHEET_ID}/values/Users!A:B`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();

  // Sheets API 回傳錯誤時直接揭露訊息，方便除錯
  if (data.error) {
    console.error('[getUsers] Sheets API error:', JSON.stringify(data.error));
    return new Response(
      JSON.stringify({ users: [], error: `Sheets API: ${data.error.message}` }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (!data.values || data.values.length < 2) {
    // 無資料（只有標題列或空白）
    return new Response(JSON.stringify({ users: [] }), {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const [, ...rows] = data.values; // 跳過標題列
  const users = rows
    .filter(row => row[0] && row[1])
    .map(row => ({ userId: row[0], userName: row[1] }));

  return new Response(JSON.stringify({ users }), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 新增一列 LINE 排程到排程 Sheet
// 欄位：A發送時間 B對象ID C對象名稱 D訊息類型 E內容/圖片URL F標題 G描述+按鈕 H建立時間 I狀態
async function addScheduleRow(token, body, headers) {
  const { time, targetId, targetName, type, content, title, subBtn } = body;
  const createdAt = new Date().toISOString().replace('T', ' ').substring(0, 16);

  const row = [time, targetId, targetName, type, content || '', title || '', subBtn || '', createdAt, '待發送'];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SCHEDULE_SHEET_ID}/values/Schedule!A:I:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    }
  );
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 向 Google Drive 申請一個 Resumable Upload 網址
// 前端拿到這個網址後，直接把檔案上傳到 Google，不經過 Worker
// 這樣可以支援超大檔案，也不會佔用 Worker 的資源
async function getUploadUrl(token, fileName, mimeType, folderId, headers) {
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': mimeType, // 告訴 Google 即將上傳的檔案類型
      },
      body: JSON.stringify({
        name: fileName,        // 上傳後的檔案名稱
        parents: [folderId],   // 放在哪個資料夾
      }),
    }
  );
  // Google 會回傳一個臨時的上傳網址（有效期約 1 週）
  const uploadUrl = res.headers.get('Location');
  return new Response(JSON.stringify({ uploadUrl }), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// 【暫時函式】讀取 Drive 中 xlsx 檔案的所有 cell 值
// 策略 1：直接用 Sheets API 讀（有時 Drive xlsx 可直接讀取）
// 策略 2：下載 xlsx 二進位，解析 ZIP 內的 XML
async function readXlsxAsSheet(token, fileId, headers) {
  if (!fileId) {
    return new Response(JSON.stringify({ error: 'fileId 必填' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 策略 1：直接用 Sheets API 嘗試（對 Drive xlsx 有時可行）
  const sheetsRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/A1:ZZ200`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (sheetsRes.ok) {
    const data = await sheetsRes.json();
    return new Response(JSON.stringify({ source: 'sheets', ...data }), {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 策略 2：下載 xlsx 二進位，用簡易 ZIP 解析器讀取 XML
  const dlRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!dlRes.ok) {
    const err = await dlRes.text();
    return new Response(JSON.stringify({ error: 'download failed: ' + err }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const buf = await dlRes.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // 用 Central Directory（ZIP 尾端）解析，確保 compSize 正確
  function read32(off) { return bytes[off] | (bytes[off+1]<<8) | (bytes[off+2]<<16) | (bytes[off+3]<<24); }
  function read16(off) { return bytes[off] | (bytes[off+1]<<8); }

  // 從尾端找 End of Central Directory (PK\x05\x06)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i]===0x50 && bytes[i+1]===0x4B && bytes[i+2]===0x05 && bytes[i+3]===0x06) { eocd = i; break; }
  }
  if (eocd === -1) return new Response(JSON.stringify({ error: 'EOCD not found' }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });

  const cdCount  = read16(eocd + 8);
  const cdOffset = read32(eocd + 16);

  // 解析 Central Directory entries (PK\x01\x02)
  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (read32(pos) !== 0x02014B50) break;
    const compMethod = read16(pos + 10);
    const compSize   = read32(pos + 20);
    const uncompSize = read32(pos + 24);
    const fnLen      = read16(pos + 28);
    const extraLen   = read16(pos + 30);
    const cmtLen     = read16(pos + 32);
    const lhOffset   = read32(pos + 42);
    const filename   = new TextDecoder().decode(bytes.slice(pos+46, pos+46+fnLen));
    // 從 local file header 算出實際資料起點
    const lfnLen     = read16(lhOffset + 26);
    const lextraLen  = read16(lhOffset + 28);
    const dataStart  = lhOffset + 30 + lfnLen + lextraLen;
    entries.push({ filename, compMethod, compSize, uncompSize, dataStart });
    pos += 46 + fnLen + extraLen + cmtLen;
  }

  // 找 sharedStrings.xml 和 sheet1.xml
  const ssEntry = entries.find(e => e.filename.includes('sharedStrings'));
  const shEntry = entries.find(e => e.filename.match(/worksheets\/sheet1\.xml/));

  async function decompress(entry) {
    const compressed = bytes.slice(entry.dataStart, entry.dataStart + entry.compSize);
    if (entry.compMethod === 0) return new TextDecoder().decode(compressed);
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const result = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return new TextDecoder().decode(result);
  }

  // 解析 sharedStrings
  let sharedStrings = [];
  if (ssEntry) {
    const ssXml = await decompress(ssEntry);
    const matches = [...ssXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    // 按 <si> 分組
    const siParts = ssXml.split('<si>');
    for (let si of siParts.slice(1)) {
      const ts = [...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]);
      sharedStrings.push(ts.join(''));
    }
  }

  if (!shEntry) {
    return new Response(JSON.stringify({ error: 'sheet1.xml not found', entries: entries.map(e=>e.filename) }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const shXml = await decompress(shEntry);

  // 解析 <row> 與 <c>，還原格子值
  const rowMatches = [...shXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  const grid = {};
  for (const rm of rowMatches) {
    const rowNum = parseInt(rm[1]);
    const rowXml = rm[2];
    const cells = [...rowXml.matchAll(/<c r="([A-Z]+\d+)"(?:\s+[^>]*)?\s+t="([^"]*)"[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>|<c r="([A-Z]+\d+)"[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>/g)];
    for (const cm of cells) {
      const ref = cm[1] || cm[4];
      const type = cm[2] || '';
      const val = cm[3] !== undefined ? cm[3] : cm[5];
      let cellVal = val;
      if (type === 's') cellVal = sharedStrings[parseInt(val)] || val;
      if (!grid[rowNum]) grid[rowNum] = {};
      grid[rowNum][ref.replace(/\d+/, '')] = cellVal;
    }
  }

  return new Response(JSON.stringify({ source: 'zip', sharedStrings, grid }), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// ========================================
// 音檔重點整理：Drive → Gemini → Notion
// ========================================
async function summarizeAudio(driveToken, env, fileId, fileName, headers) {
  const GEMINI_KEY = env.GEMINI_API_KEY;
  const NOTION_TOKEN = env.NOTION_TOKEN;
  const NOTION_PAGE_ID = env.NOTION_PARENT_PAGE_ID;

  if (!GEMINI_KEY)    throw new Error('未設定 GEMINI_API_KEY 環境變數');
  if (!NOTION_TOKEN)  throw new Error('未設定 NOTION_TOKEN 環境變數');
  if (!NOTION_PAGE_ID) throw new Error('未設定 NOTION_PARENT_PAGE_ID 環境變數');

  // 1. 從 Google Drive 下載音檔
  const dlRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${driveToken}` } }
  );
  if (!dlRes.ok) throw new Error(`Drive 下載失敗 (${dlRes.status})`);
  const audioBytes = await dlRes.arrayBuffer();

  // 2. 上傳到 Gemini Files API（multipart）
  const enc = new TextEncoder();
  const boundary = 'gem_' + Date.now();
  const meta = JSON.stringify({ file: { display_name: fileName } });
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: audio/mpeg\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.byteLength + audioBytes.byteLength + tail.byteLength);
  body.set(head);
  body.set(new Uint8Array(audioBytes), head.byteLength);
  body.set(tail, head.byteLength + audioBytes.byteLength);

  const upRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  const upData = await upRes.json();
  if (!upData.file?.uri) throw new Error('Gemini 上傳失敗：' + JSON.stringify(upData));

  const fileUri      = upData.file.uri;
  const geminiName   = upData.file.name;

  // 3. 等待檔案狀態變為 ACTIVE
  let state = upData.file.state || 'PROCESSING';
  for (let i = 0; i < 6 && state !== 'ACTIVE'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const chk = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${geminiName}?key=${GEMINI_KEY}`
    );
    state = (await chk.json()).state;
  }
  if (state !== 'ACTIVE') throw new Error('Gemini 檔案處理逾時，請稍後再試');

  // 4. 呼叫 Gemini 整理重點
  const prompt = `
這是一段基督教會聚會的錄音，請以繁體中文整理成一份「聚會講義」：

# <h2>今日主題：....<h2>

📍 第一大點標題
📖 核心經文：[書名 章:節]
💡 教導重點：
- [內容：請以條列式整理該段落核心教導，每點約 50-100 字]
- [內容：...]

📍 第二大點標題
📖 核心經文：[書名 章:節]
💡 教導重點：
- [內容：...]

（請依據錄音長度，整理 3–5 個大點）

---

# 📖 聖經經文複習
列出音頻中提及的所有聖經經文，格式：
- 書名 章:節 ── 完整經文(和合本-神版)

---

# ⏱️ 整理日期：[今天日期]

# 📝 注意事項
- 格式限制：嚴格禁止使用雙星號（**），確保匯入 Notion 後畫面簡潔。
- 人名規範：只用姓氏加「弟兄」或「姊妹」（如：陳弟兄、王姊妹），不呈現全名。
- 聖經版本：和合本-神版，禁止使用"上帝"。
- 真實性：只整理音頻實際提到的內容，勿自行補充。
  `;

  const genRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { file_data: { mime_type: 'audio/mpeg', file_uri: fileUri } },
          { text: prompt }
        ]}],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    }
  );
  const genData = await genRes.json();
  if (genData.error) throw new Error('Gemini 生成失敗：' + genData.error.message);
  const text = genData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Gemini 未回傳內容');

  // 5. 寫入 Notion
  const today = new Date().toISOString().slice(0, 10);
  const title = `${fileName.replace(/\.mp3$/i, '')}  編:${today}`;

  const notionRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { page_id: NOTION_PAGE_ID },
      properties: { title: { title: [{ text: { content: title } }] } },
      children: markdownToNotionBlocks(text),
    }),
  });
  const notionData = await notionRes.json();
  if (notionData.object === 'error') throw new Error('Notion 寫入失敗：' + notionData.message);

  return new Response(
    JSON.stringify({ ok: true, notionUrl: notionData.url, title }),
    { headers: { ...headers, 'Content-Type': 'application/json' } }
  );
}

// Gemini 回傳的 Markdown 轉換成 Notion blocks
function markdownToNotionBlocks(text) {
  const blocks = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (blocks.length >= 98) break; // Notion 上限 100 blocks

    if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2',
        heading_2: { rich_text: [{ text: { content: line.slice(3).trim() } }] } });
    } else if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1',
        heading_1: { rich_text: [{ text: { content: line.slice(2).trim() } }] } });
    } else if (/^[-•]\s/.test(line)) {
      blocks.push({ object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ text: { content: line.replace(/^[-•]\s+/, '').slice(0, 2000) } }] } });
    } else {
      blocks.push({ object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: line.trim().slice(0, 2000) } }] } });
    }
  }
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  blocks.push({ object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ text: { content: '由 Gemini AI 自動整理' },
      annotations: { italic: true, color: 'gray' } }] } });
  return blocks;
}

// ========================================
// 安排表轉檔功能
// ========================================

// 主流程：讀 xlsx → Gemini 解析 → 寫入 Google Sheet
async function convertSchedule(token, env, fileName, headers) {
  // 1. 解析西元年月（支援 yyyy-MM、yyyyMM 開頭）
  const ym = parseScheduleYearMonth(fileName);
  if (!ym) {
    return new Response(JSON.stringify({ error: '無法從檔名解析年月，請確認格式為 yyyy-MM 或 yyyyMM' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
  const { year, month } = ym;
  const rocYear = year - 1911; // 民國年
  const tabName = `${rocYear}${month}`; // 例：11505

  // 2. 在來源資料夾找對應 xlsx（民國年命名）
  const xlsxFile = await findScheduleXlsx(token, rocYear, month);
  if (!xlsxFile) {
    return new Response(JSON.stringify({ error: `找不到來源檔案：${rocYear}${month}安排表.xlsx（資料夾 A）` }), {
      status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  // 3. 將 xlsx 下載後重新上傳為 Google Sheet（比 copy 更可靠）
  const tempSheet = await importXlsxAsGoogleSheet(token, xlsxFile.id, `_temp_convert_${tabName}`);
  if (!tempSheet?.id) {
    return new Response(JSON.stringify({ error: `轉換 xlsx 失敗：${tempSheet?.error?.message || JSON.stringify(tempSheet)}` }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  let scheduleRows = [];
  let rawData = [];
  try {
    // 4. 讀取 sheet 所有資料
    rawData = await readAllSheetValues(token, tempSheet.id);

    // 5. 用 Gemini 解析結構化資料
    const geminiResult = await parseScheduleWithGemini(env, rawData, year, month);
    scheduleRows = geminiResult.rows;
    if (scheduleRows.length === 0) {
      return new Response(JSON.stringify({
        error: 'Gemini 解析結果為空',
        debug: {
          rawDataRows: rawData.length,
          geminiRaw: geminiResult.raw,
          finishReason: geminiResult.finishReason,
          apiError: geminiResult.apiError,
        },
      }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });
    }
  } finally {
    // 6. 無論成功與否都刪除暫存 sheet
    await driveDeleteFile(token, tempSheet.id);
  }

  // 7. 在輸出資料夾找或建立年度 Google Sheet
  const yearSheetTitle = `${year}年安排表`;
  const yearSheetId = await findOrCreateYearSheet(token, yearSheetTitle);

  // 8. 新增或更新對應月份頁籤，寫入清單資料
  await writeScheduleTab(token, yearSheetId, tabName, scheduleRows);

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${yearSheetId}/edit#gid=0`;
  return new Response(JSON.stringify({
    success: true,
    sheetId: yearSheetId,
    sheetUrl,
    tabName,
    rowCount: scheduleRows.length,
  }), { headers: { ...headers, 'Content-Type': 'application/json' } });
}

// 從檔名解析西元年月
function parseScheduleYearMonth(fileName) {
  let m = fileName.match(/^(\d{4})-(\d{2})/);
  if (m) return { year: parseInt(m[1]), month: m[2] };
  m = fileName.match(/^(\d{4})(\d{2})/);
  if (m) return { year: parseInt(m[1]), month: m[2] };
  return null;
}

// 在來源資料夾搜尋民國年命名的 xlsx
async function findScheduleXlsx(token, rocYear, month) {
  const q = `'${SCHEDULE_SOURCE_FOLDER_ID}' in parents and name contains '${rocYear}${month}' and name contains '安排表' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.files?.[0] || null;
}

// 將 Drive 檔案複製為 Google Sheet 格式
// 下載 xlsx 再以 multipart upload 轉為 Google Sheet（比 files.copy 更可靠）
// files.copy 直接複製並轉換格式，指定 parent 為 Shared Drive 輸出資料夾避免個人配額問題
async function importXlsxAsGoogleSheet(token, fileId, name) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mimeType: 'application/vnd.google-apps.spreadsheet',
        name,
        parents: [SCHEDULE_OUTPUT_FOLDER_ID],
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) return { error: data.error || { message: `HTTP ${res.status}` } };
  return data; // { id, name, ... }
}

// 讀取 Google Sheet 所有欄位值
async function readAllSheetValues(token, spreadsheetId) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:Z`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.values || [];
}

// 刪除 Drive 檔案
async function driveDeleteFile(token, fileId) {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
}

// 用 Gemini 解析安排表，回傳 [{ date, person, job }]
async function parseScheduleWithGemini(env, rawData, year, month) {
  const tableStr = rawData.map(row => row.join('\t')).join('\n');
  const prompt = `你是台灣教會聚會安排表資料整理助手。
以下是一份${year}年${parseInt(month)}月聚會安排表，從 Excel 讀出（Tab 分隔，可能含合併儲存格殘留的空值）。

請將所有人員工作安排整理成 JSON 陣列，每筆格式為：
{ "date": "${year}/${parseInt(month)}/<日>", "person": "<姓名>", "job": "<工作名稱>" }

規則：
1. 同一日期可能分多行（合併儲存格），請對應正確日期
2. 工作欄位為「-」或空白則忽略
3. 忽略表格底部的備註說明文字
4. 特殊活動行（查經、訓練、聚會等）若有指定人員也請納入
5. 姓名保留原始文字，不要增刪
6. 只輸出 JSON 陣列，不要任何說明文字或 markdown 標記

原始資料：
${tableStr}`;

  let data;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      }
    );
    data = await res.json();
    // 若成功或非過載錯誤，不再重試
    if (data.candidates || !data.error || attempt === 3) break;
    await new Promise(r => setTimeout(r, attempt * 3000));
  }
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const finishReason = data.candidates?.[0]?.finishReason || '';
  const apiError = data.error?.message || '';

  // 從回傳文字中抽取 JSON 陣列（相容 ```json ... ``` 或純文字）
  const match = rawText.match(/\[[\s\S]*\]/);
  if (!match) {
    return { rows: [], raw: rawText.slice(0, 800), finishReason, apiError };
  }
  try {
    return { rows: JSON.parse(match[0]), raw: '', finishReason, apiError };
  } catch (e) {
    return { rows: [], raw: rawText.slice(0, 800), finishReason, apiError };
  }
}

// 在輸出資料夾找或建立年度 Google Sheet
async function findOrCreateYearSheet(token, title) {
  // 先搜尋是否已存在
  const q = `'${SCHEDULE_OUTPUT_FOLDER_ID}' in parents and name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  // 直接用 Drive API 在 Shared Drive 建立，不經過個人空間（避免個人配額問題）
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [SCHEDULE_OUTPUT_FOLDER_ID],
      }),
    }
  );
  const created = await createRes.json();
  if (!created.id) throw new Error(`建立年度 Sheet 失敗：${created.error?.message || JSON.stringify(created)}`);
  return created.id;
}

// 在指定 Google Sheet 新增或更新頁籤，寫入安排資料
async function writeScheduleTab(token, spreadsheetId, tabName, rows) {
  // 取得現有頁籤清單
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  const existing = meta.sheets?.find(s => s.properties.title === tabName);

  if (existing) {
    // 清空現有頁籤
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}:clear`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }
    );
  } else {
    // 新增頁籤
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
      }
    );
  }

  // 寫入標題列 + 資料
  const values = [['日期', '人員', '工作'], ...rows.map(r => [r.date, r.person, r.job])];
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  );
}
