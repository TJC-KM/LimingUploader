// ========================================
// MP3 去頭去尾（index.html 的「剪輯」使用）
//
// MP3 由一格一格的 frame 組成（每格約 0.026 秒）。剪輯只要找出開始與結束時間所在的 frame，
// 把中間那段原封不動切出來：不重新壓縮、音質不變、幾秒就完成，手機也跑得動，精準度約 0.03 秒。
// 開頭的 Xing／Info 標頭會同步更新，播放器才會顯示正確的長度。
//
// ⚠️ 修改此檔後，記得更新 index.html 引用此檔的 ?v= 版本號
// ========================================
const Mp3Trim = (() => {
  const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]; // MPEG-1 Layer III（kbps）
  const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];      // MPEG-2／2.5 Layer III
  const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const CHUNK = 4 * 1024 * 1024; // 一次讀 4 MB，大檔案也不會一次佔用太多記憶體

  // 解析 frame header；不是合法的 MPEG Layer III header 就回傳 null
  function parseHeader(b, i) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
    const version = (b[i + 1] >> 3) & 3; // 3 = MPEG-1、2 = MPEG-2、0 = MPEG-2.5
    const layer = (b[i + 1] >> 1) & 3;   // 1 = Layer III
    const bitrateIndex = b[i + 2] >> 4;
    const rateIndex = (b[i + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
    const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
    const sampleRate = SAMPLE_RATES[version][rateIndex];
    const samples = version === 3 ? 1152 : 576;
    const padding = (b[i + 2] >> 1) & 1;
    return {
      version, sampleRate, samples, bitrate,
      mono: b[i + 3] >> 6 === 3,
      length: Math.floor((samples / 8) * bitrate / sampleRate) + padding,
    };
  }

  // 第一格裡的 Xing／Info（LAME）或 VBRI 標頭；沒有就回傳 null
  function findVbrHeader(b, i, h) {
    const sideInfo = h.version === 3 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17);
    const tagAt = at => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
    const x = i + 4 + sideInfo;
    if (tagAt(x) === 'Xing' || tagAt(x) === 'Info') return { type: 'xing', offset: 4 + sideInfo };
    if (tagAt(i + 36) === 'VBRI') return { type: 'vbri' };
    return null;
  }

  // Xing 標頭後面的 LAME 資訊記錄了編碼延遲；播放器會略過開頭這段（延遲 + 解碼器固定的 529 個取樣）
  function readPlaybackDelay(bytes, xingOffset, sampleRate) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = xingOffset + 4;
    const flags = view.getUint32(p);
    p += 4 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
    if (p + 24 > bytes.length) return 0;
    const encoder = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    if (!/^(LAME|Lavf|Lavc)/.test(encoder)) return 0;
    const encoderDelay = (bytes[p + 21] << 4) | (bytes[p + 22] >> 4);
    return (encoderDelay + 529) / sampleRate;
  }

  // 掃過整個檔案，記下每一格有聲音的 frame 位置
  async function analyze(blob) {
    const size = blob.size;
    let buf = new Uint8Array(0), bufStart = 0;
    const load = async pos => {
      bufStart = pos;
      buf = new Uint8Array(await blob.slice(pos, Math.min(size, pos + CHUNK)).arrayBuffer());
    };
    const has = (pos, n) => pos >= bufStart && pos + n <= bufStart + buf.length;

    // 開頭的 ID3v2 標籤（標題、封面等），剪完照樣保留
    await load(0);
    let pos = 0;
    if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
      const tagSize = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
      pos = 10 + tagSize + (buf[5] & 0x10 ? 10 : 0);
    }
    const id3v2End = Math.min(pos, size);

    // 結尾的 ID3v1 標籤
    let audioEnd = size;
    if (size >= 128) {
      const t = new Uint8Array(await blob.slice(size - 128, size - 125).arrayBuffer());
      if (t[0] === 0x54 && t[1] === 0x41 && t[2] === 0x47) audioEnd = size - 128;
    }

    const offsets = [];
    let first = null, vbr = null, dataEnd = pos;
    while (pos + 4 <= audioEnd) {
      if (!has(pos, 4)) await load(pos);
      const h = parseHeader(buf, pos - bufStart);
      // 不是合法的 frame（或格式和第一格不同）就是失去同步，往後一個位元組繼續找
      if (!h || (first && (h.version !== first.version || h.sampleRate !== first.sampleRate))) { pos++; continue; }
      if (!first) {
        // 第一格要確認下一格也接得上，避免把雜訊當成開頭
        if (!has(pos, h.length + 4)) await load(pos);
        const i = pos - bufStart;
        if (pos + h.length + 4 <= audioEnd && !parseHeader(buf, i + h.length)) { pos++; continue; }
        first = h;
        const found = findVbrHeader(buf, i, h);
        if (found) {
          // 這格只有標頭、沒有聲音，另外保存，剪完再更新內容放回去
          vbr = { ...found, bytes: buf.slice(i, i + h.length) };
          pos += h.length;
          dataEnd = pos;
          continue;
        }
      }
      offsets.push(pos);
      pos += h.length;
      dataEnd = Math.min(pos, audioEnd);
    }
    if (!first || !offsets.length) throw new Error('看不懂這個 MP3 檔案的格式');

    const frameDuration = first.samples / first.sampleRate;
    const delay = vbr?.type === 'xing' ? readPlaybackDelay(vbr.bytes, vbr.offset, first.sampleRate) : 0;
    return { size, id3v2End, audioEnd, dataEnd, offsets, vbr, frameDuration, delay, duration: offsets.length * frameDuration - delay };
  }

  // 保留播放器上 start～end 秒的內容，回傳新的 MP3，以及實際保留的起訖秒數
  function cut(blob, info, start, end) {
    const n = info.offsets.length;
    // 播放器的時間已經扣掉編碼延遲，換回檔案裡的時間再找 frame
    // 剪完的檔案不帶延遲資訊，開頭誤差在一格（約 0.03～0.07 秒）以內
    const d = info.delay;
    const s = Math.min(Math.max(Math.floor((start + d) / info.frameDuration), 0), n - 1);
    const e = Math.min(Math.max(Math.ceil((end + d) / info.frameDuration), s + 1), n);
    const from = info.offsets[s];
    const to = e < n ? info.offsets[e] : info.dataEnd;

    const parts = [blob.slice(0, info.id3v2End)];
    // VBRI 標頭不好更新，直接拿掉，播放器會自己估算長度
    if (info.vbr?.type === 'xing') parts.push(patchXing(info, s, e, from, to));
    parts.push(blob.slice(from, to));
    if (info.audioEnd < info.size) parts.push(blob.slice(info.audioEnd)); // ID3v1
    return {
      blob: new Blob(parts, { type: 'audio/mpeg' }),
      start: Math.max(0, s * info.frameDuration - d),
      end: e * info.frameDuration - d,
    };
  }

  // 更新 Xing／Info 標頭的 frame 數、位元組數與 TOC，讓播放器顯示正確長度、拖曳到正確位置
  function patchXing(info, s, e, from, to) {
    const b = info.vbr.bytes.slice();
    const view = new DataView(b.buffer);
    const frames = e - s;
    const bytes = b.length + (to - from);
    let p = info.vbr.offset + 4;
    const flags = view.getUint32(p);
    p += 4;
    if (flags & 1) { view.setUint32(p, frames); p += 4; }
    if (flags & 2) { view.setUint32(p, bytes); p += 4; }
    if (flags & 4) {
      for (let k = 0; k < 100; k++) {
        const frame = s + Math.min(Math.floor((k / 100) * frames), frames - 1);
        b[p + k] = Math.min(255, Math.floor(((b.length + info.offsets[frame] - from) / bytes) * 256));
      }
      p += 100;
    }
    if (flags & 8) p += 4;
    // 後面的 LAME 資訊（編碼延遲、原始長度、檢查碼）已經不符合剪過的內容，清掉以免播放器誤用
    b.fill(0, p);
    return b;
  }

  return { analyze, cut };
})();
