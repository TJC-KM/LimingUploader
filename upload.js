// ========================================
// 上傳引擎（index.html、gallery.html 共用）
//
// 手機大量上傳容易因為鎖定螢幕、切換 App、網路不穩而中斷，所以：
// - 分段續傳：檔案切成 8 MB 一段傳給 Google，中斷後從斷點繼續，不必從頭傳
// - 斷網時暫停，恢復連線後自動繼續，不會把整批檔案都標成失敗
// - 上傳期間請求螢幕保持開啟（Screen Wake Lock，瀏覽器不支援就略過）
// - 目標資料夾已有同名、同大小的檔案就略過，重選同一批檔案不會重複上傳
// - 續傳網址記在 localStorage，頁面被關掉後重選同一批檔案可以接著傳
//
// ⚠️ 修改此檔後，記得更新 index.html、gallery.html 引用此檔的 ?v= 版本號
// ========================================
const LimingUploader = (() => {
  const CONCURRENCY = 4;                          // 同時上傳的檔案數
  const RETRY_DELAYS = [1, 2, 4, 8, 15, 30];      // 失敗後等幾秒再重試（次數超過就沿用最後一個）
  const MAX_STALLED = 8;                          // 網路正常卻連續失敗、毫無進度的次數上限
  const MAX_REJECTED = 3;                         // Google 明確拒絕（4xx）的次數上限
  const STALL_TIMEOUT = 60 * 1000;                // 連線超過這麼久沒有任何進度就中止重來
  const SESSION_TTL = 6 * 24 * 60 * 60 * 1000;    // Google 續傳網址約一週失效，保守抓 6 天
  const SESSIONS_KEY = 'liming-upload-sessions';  // localStorage：檔案 → 續傳網址
  const PENDING_KEY = 'liming-upload-pending';    // localStorage：還沒傳完的檔案
  const BUSY_STATES = ['checking', 'queued', 'uploading', 'retrying', 'offline'];

  let workerUrl = '';
  let chunkSize = 8 * 1024 * 1024;                // 必須是 256 KB 的倍數
  let listEl = null, statusEl = null, noticeEl = null, onDone = null;

  let tasks = [];             // 本輪上傳的檔案
  let active = 0;             // 正在上傳的檔案數
  let runFinished = true;
  let wakeLock = null, wakeLockPending = false;
  const wakeups = new Set();  // 等待重試中的計時器，網路恢復或回到頁面時提早叫醒

  function init(options) {
    workerUrl = options.workerUrl;
    listEl = options.listEl;
    statusEl = options.statusEl || null;
    noticeEl = options.noticeEl || null;
    onDone = options.onDone || null;
    if (options.chunkSize) chunkSize = options.chunkSize;
    pruneStore();
    renderNotice();
  }

  function isBusy() {
    return tasks.some(t => BUSY_STATES.includes(t.state));
  }

  function isLineBrowser() {
    return /Line\//i.test(navigator.userAgent || '');
  }

  // ── 加入上傳 ─────────────────────────────

  // items: [{ file, fileName? }]，全部上傳到同一個資料夾
  async function add(items, { folderId, folderName }) {
    if (noticeEl) noticeEl.style.display = 'none';
    // 上一輪已經結束：清掉成功與略過的，保留失敗的讓使用者還能重試
    if (!isBusy()) tasks = tasks.filter(t => t.state === 'failed');
    runFinished = false;

    const checking = [];
    const frag = document.createDocumentFragment();
    for (const { file, fileName } of items) {
      const name = fileName || file.name;
      const t = {
        file, fileName: name, folderId, folderName,
        mimeType: file.type || 'application/octet-stream',
        key: `${folderId}|${name}|${file.size}`,
        state: 'checking', note: '', error: '',
        offset: 0, loaded: 0, uploadUrl: null, needsOffsetCheck: false,
        xhr: null, lastProgressAt: 0,
      };
      const same = tasks.find(x => x.key === t.key);
      if (same && same.state !== 'failed') {
        t.state = 'skipped';
        t.note = '已在上傳清單中';
      } else {
        if (same) { tasks.splice(tasks.indexOf(same), 1); same.row.el.remove(); }
        checking.push(t);
      }
      t.row = createRow(t);
      renderRow(t);
      frag.appendChild(t.row.el);
      tasks.push(t);
    }
    listEl.prepend(frag);
    markPending(checking);
    renderStatus();

    const existing = await fetchExisting(folderId);
    checking.forEach(t => {
      if (existing.has(`${t.fileName}|${t.file.size}`)) {
        t.note = '已存在，略過';
        clearPending(t);
        setState(t, 'skipped');
      } else {
        setState(t, 'queued');
      }
    });
    pump();
  }

  // 目標資料夾現有的檔案（檔名 + 大小），用來略過已經傳過的檔案
  async function fetchExisting(folderId) {
    try {
      const res = await fetch(`${workerUrl}/files?folderId=${folderId}`);
      const data = await res.json();
      return new Set((data.files || []).map(f => `${f.name}|${f.size}`));
    } catch (e) {
      return new Set();
    }
  }

  function retryFailed() {
    tasks.filter(t => t.state === 'failed').forEach(t => { t.error = ''; t.state = 'queued'; renderRow(t); });
    runFinished = false;
    pump();
  }

  // ── 佇列 ─────────────────────────────────

  function pump() {
    while (active < CONCURRENCY) {
      const t = tasks.find(x => x.state === 'queued');
      if (!t) break;
      t.state = 'uploading';
      active++;
      runTask(t).finally(() => { active--; pump(); });
    }
    renderStatus();
    updateWakeLock();
    if (!isBusy() && !runFinished) {
      runFinished = true;
      if (onDone) onDone([...new Set(tasks.map(t => t.folderId))]);
    }
  }

  async function runTask(t) {
    let attempt = 0, stalled = 0, rejected = 0;
    while (true) {
      while (!navigator.onLine) {
        setState(t, 'offline');
        await sleep(30 * 1000);
      }
      setState(t, 'uploading');
      const offsetBefore = t.offset;
      try {
        let complete = await prepareSession(t);
        while (!complete) complete = await sendChunk(t);
        forgetSession(t.key);
        clearPending(t);
        setState(t, 'done');
        return;
      } catch (err) {
        if (err.kind === 'expired') {
          // 續傳網址失效：這個檔案重新開始
          forgetSession(t.key);
          t.uploadUrl = null;
          t.offset = t.loaded = 0;
        } else if (t.uploadUrl) {
          // 不確定 Google 收到多少，下次先查詢進度再續傳
          t.needsOffsetCheck = true;
        }
        if (err.kind === 'rejected') rejected++;
        if (t.offset > offsetBefore) { attempt = 0; stalled = 0; }
        else if (navigator.onLine && !document.hidden) stalled++; // 離線或在背景時的失敗不算數
        if (stalled >= MAX_STALLED || rejected >= MAX_REJECTED) {
          t.error = err.message;
          setState(t, 'failed');
          return;
        }
        if (!navigator.onLine) continue;
        setState(t, 'retrying');
        await sleep(RETRY_DELAYS[Math.min(attempt++, RETRY_DELAYS.length - 1)] * 1000);
      }
    }
  }

  // ── 與 Google 續傳 API 溝通 ───────────────

  // 準備續傳網址；回傳 true 代表 Google 已經收到完整檔案
  async function prepareSession(t) {
    if (!t.uploadUrl) {
      const saved = loadSession(t.key);
      if (saved) {
        t.uploadUrl = saved;
        t.needsOffsetCheck = true;
      }
    }
    if (!t.uploadUrl) {
      let data;
      try {
        const res = await fetch(`${workerUrl}/upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: t.fileName, mimeType: t.mimeType, folderId: t.folderId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (e) {
        throw uploadError('retry', '取得上傳網址失敗');
      }
      if (!data.uploadUrl) throw uploadError('rejected', '無法建立上傳（資料夾可能不存在）');
      t.uploadUrl = data.uploadUrl;
      t.offset = t.loaded = 0;
      t.needsOffsetCheck = false;
      saveSession(t.key, t.uploadUrl);
      return false;
    }
    if (t.needsOffsetCheck) {
      const complete = await putToGoogle(t, null, `bytes */${t.file.size}`);
      t.needsOffsetCheck = false;
      return complete;
    }
    return false;
  }

  function sendChunk(t) {
    const size = t.file.size;
    if (size === 0) return putToGoogle(t, null, 'bytes */0');
    const end = Math.min(t.offset + chunkSize, size);
    return putToGoogle(t, t.file.slice(t.offset, end), `bytes ${t.offset}-${end - 1}/${size}`);
  }

  // 傳送一段資料；body 為 null 時是查詢 Google 已收到多少
  // 回傳 true 代表整個檔案已完成
  function putToGoogle(t, body, contentRange) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const base = t.offset;
      t.xhr = xhr;
      t.lastProgressAt = Date.now();
      // 網路切換時連線可能卡住卻不報錯，太久沒進度就主動中止
      const watchdog = setInterval(() => {
        if (Date.now() - t.lastProgressAt > STALL_TIMEOUT) xhr.abort();
      }, 5000);
      const cleanup = () => { clearInterval(watchdog); t.xhr = null; };

      xhr.open('PUT', t.uploadUrl, true);
      xhr.setRequestHeader('Content-Range', contentRange);
      // 請 Google 用 200 + X-HTTP-Status-Code-Override 代替 308，避免瀏覽器把 308 當成轉址
      xhr.setRequestHeader('X-GUploader-No-308', 'yes');
      if (body) xhr.setRequestHeader('Content-Type', t.mimeType);
      xhr.upload.onprogress = e => {
        t.lastProgressAt = Date.now();
        if (body) { t.loaded = base + e.loaded; renderRow(t); }
      };
      xhr.onload = () => {
        cleanup();
        const status = Number(xhr.getResponseHeader('X-HTTP-Status-Code-Override')) || xhr.status;
        if (status === 308) {
          // 還沒傳完，Range 是 Google 已經收到的範圍，例如 bytes=0-8388607
          const range = xhr.getResponseHeader('Range');
          t.offset = t.loaded = range ? Number(range.split('-')[1]) + 1 : 0;
          if (body && t.offset <= base) reject(uploadError('retry', 'Google 沒有收到這段資料'));
          else resolve(false);
        } else if (status === 200 || status === 201) {
          t.offset = t.loaded = t.file.size;
          resolve(true);
        } else if (status === 404 || status === 410) {
          reject(uploadError('expired', '上傳網址已失效'));
        } else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          reject(uploadError('rejected', `Google 回應 ${status}`));
        } else {
          reject(uploadError('retry', `Google 回應 ${status}`));
        }
      };
      xhr.onerror = () => { cleanup(); reject(uploadError('retry', '網路連線中斷')); };
      xhr.onabort = () => { cleanup(); reject(uploadError('retry', '連線中斷')); };
      xhr.send(body);
    });
  }

  function uploadError(kind, message) {
    const err = new Error(message);
    err.kind = kind; // retry：可重試｜rejected：Google 拒絕｜expired：續傳網址失效
    return err;
  }

  // 等待一段時間；網路恢復或回到頁面時會提早結束
  function sleep(ms) {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); wakeups.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      wakeups.add(done);
    });
  }

  function wakeAll() {
    [...wakeups].forEach(done => done());
  }

  window.addEventListener('online', () => { wakeAll(); renderStatus(); });
  window.addEventListener('offline', () => {
    tasks.forEach(t => t.xhr && t.xhr.abort());
    renderStatus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // 回到頁面：計時器在背景可能被凍結，重設卡住偵測並立刻重試
    tasks.forEach(t => { t.lastProgressAt = Date.now(); });
    wakeAll();
    updateWakeLock();
  });
  window.addEventListener('beforeunload', e => {
    if (isBusy()) { e.preventDefault(); e.returnValue = ''; }
  });

  // 上傳期間請求螢幕保持開啟；頁面切到背景時系統會自動釋放，回到頁面再重新請求
  async function updateWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (!isBusy()) {
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
      return;
    }
    if (wakeLock || wakeLockPending || document.hidden) return;
    wakeLockPending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      wakeLock = lock;
      if (!isBusy()) updateWakeLock();
    } catch (e) {
      // 不支援或被系統拒絕（例如省電模式）就算了
    }
    wakeLockPending = false;
  }

  // ── localStorage ─────────────────────────

  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 無痕模式等情況存不了就算了 */ }
  }

  function pruneStore() {
    const now = Date.now();
    const sessions = readStore(SESSIONS_KEY);
    for (const k in sessions) if (now - sessions[k].savedAt > SESSION_TTL) delete sessions[k];
    writeStore(SESSIONS_KEY, sessions);
    const pending = readStore(PENDING_KEY);
    for (const k in pending) if (now - pending[k].updatedAt > SESSION_TTL) delete pending[k];
    writeStore(PENDING_KEY, pending);
  }

  function loadSession(key) {
    return readStore(SESSIONS_KEY)[key]?.url || null;
  }

  function saveSession(key, url) {
    const sessions = readStore(SESSIONS_KEY);
    sessions[key] = { url, savedAt: Date.now() };
    writeStore(SESSIONS_KEY, sessions);
  }

  function forgetSession(key) {
    const sessions = readStore(SESSIONS_KEY);
    delete sessions[key];
    writeStore(SESSIONS_KEY, sessions);
  }

  function markPending(list) {
    if (!list.length) return;
    const pending = readStore(PENDING_KEY);
    list.forEach(t => {
      const folder = pending[t.folderId] || (pending[t.folderId] = { folderName: t.folderName, files: {} });
      folder.files[t.key] = t.fileName;
      folder.updatedAt = Date.now();
    });
    writeStore(PENDING_KEY, pending);
  }

  function clearPending(t) {
    const pending = readStore(PENDING_KEY);
    const folder = pending[t.folderId];
    if (!folder) return;
    delete folder.files[t.key];
    if (!Object.keys(folder.files).length) delete pending[t.folderId];
    writeStore(PENDING_KEY, pending);
  }

  // ── 畫面 ─────────────────────────────────

  function setState(t, state) {
    t.state = state;
    renderRow(t);
    renderStatus();
  }

  function createRow(t) {
    const el = document.createElement('div');
    el.className = 'upload-item';
    el.innerHTML = '<div class="upload-item-header"><div class="upload-item-name"></div><div class="upload-item-status"></div></div><div class="progress-bar"><div class="progress-fill"></div></div>';
    el.querySelector('.upload-item-name').textContent = t.fileName;
    return { el, status: el.querySelector('.upload-item-status'), bar: el.querySelector('.progress-fill') };
  }

  function renderRow(t) {
    const pct = t.file.size ? Math.floor((t.loaded / t.file.size) * 100) : 0;
    const finished = t.state === 'done' || t.state === 'skipped';
    t.row.status.textContent = {
      checking: '檢查中...',
      queued: '等待中',
      uploading: `上傳中 ${pct}%`,
      retrying: `連線不穩，重試中 ${pct}%`,
      offline: `等待網路恢復 ${pct}%`,
      done: '完成 ✓',
      skipped: t.note,
      failed: '上傳失敗：' + t.error,
    }[t.state];
    t.row.status.className = 'upload-item-status' +
      ({ done: ' done', skipped: ' skipped', failed: ' error', retrying: ' waiting', offline: ' waiting' }[t.state] || '');
    t.row.bar.className = 'progress-fill' + (finished ? ' done' : '');
    t.row.bar.style.width = (finished ? 100 : Math.max(2, pct)) + '%';
  }

  function appendLine(el, text, className) {
    const div = document.createElement('div');
    div.textContent = text;
    if (className) div.className = className;
    el.appendChild(div);
  }

  function renderStatus() {
    if (!statusEl) return;
    statusEl.textContent = '';
    if (!tasks.length) { statusEl.style.display = 'none'; return; }
    statusEl.style.display = '';

    const done = tasks.filter(t => t.state === 'done').length;
    const skipped = tasks.filter(t => t.state === 'skipped').length;
    const failed = tasks.filter(t => t.state === 'failed');

    if (isBusy()) {
      const progress = `已完成 ${done + skipped + failed.length} / ${tasks.length}`;
      statusEl.className = 'upload-summary info';
      appendLine(statusEl, navigator.onLine
        ? `⬆️ 上傳中，${progress}`
        : `⏸ 網路中斷，恢復連線後會自動繼續（${progress}）`);
      appendLine(statusEl, '請保持此頁面開啟，不要切換 App 或鎖定螢幕；如果中斷了，回到此頁會自動繼續。', 'upload-summary-tip');
      if (isLineBrowser()) appendLine(statusEl, '在 LINE 裡切回聊天室也會中斷上傳，大量上傳建議改用瀏覽器開啟。', 'upload-summary-tip');
      return;
    }

    const counts = [`上傳 ${done} 個`];
    if (skipped) counts.push(`略過 ${skipped} 個重複檔案`);
    if (!failed.length) {
      statusEl.className = 'upload-summary ok';
      appendLine(statusEl, `✓ 全部完成：${counts.join('，')}`);
      return;
    }
    statusEl.className = 'upload-summary warn';
    appendLine(statusEl, `${counts.join('，')}，失敗 ${failed.length} 個：`);
    failed.forEach(t => appendLine(statusEl, '・' + t.fileName));
    const btn = document.createElement('button');
    btn.className = 'upload-retry-btn';
    btn.textContent = '重試失敗項目';
    btn.onclick = retryFailed;
    statusEl.appendChild(btn);
  }

  // 上次頁面被關掉時還有檔案沒傳完，提醒使用者重選同一批檔案
  function renderNotice() {
    if (!noticeEl) return;
    const folders = Object.values(readStore(PENDING_KEY)).filter(f => Object.keys(f.files).length);
    noticeEl.textContent = '';
    if (!folders.length) { noticeEl.style.display = 'none'; return; }
    noticeEl.className = 'upload-summary warn';
    appendLine(noticeEl, '⚠️ 上次有檔案還沒傳完：');
    folders.forEach(f => appendLine(noticeEl, `・📁 ${f.folderName || '未命名資料夾'}：${Object.keys(f.files).length} 個檔案`));
    appendLine(noticeEl, '請到該資料夾重新選擇同一批檔案：已經傳完的會自動略過，沒傳完的會從中斷處繼續。', 'upload-summary-tip');
    const btn = document.createElement('button');
    btn.className = 'upload-retry-btn';
    btn.textContent = '知道了';
    btn.onclick = () => { writeStore(PENDING_KEY, {}); noticeEl.style.display = 'none'; };
    noticeEl.appendChild(btn);
    noticeEl.style.display = '';
  }

  return { init, add, retryFailed, isBusy, isLineBrowser };
})();
