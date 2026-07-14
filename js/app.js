// app.js — 主流程、畫面切換、狀態、資料載入與驗證
(function () {
  'use strict';

  const G = window.Geo;
  const MockNS = window.Mock;
  const CamNS = window.Camera;

  // ---------- 全域狀態 ----------
  const state = {
    data: null,          // 解析後的 points.json
    dataHash: null,
    points: [],          // 加工後（含 category 物件、shots）
    filterCat: 'all',
    pos: null,           // {lat,lng,accuracy}
    heading: null,       // 濾波後 heading（度）
    pitch: null,         // 簡化俯仰角（度，0=水平），供 AR 浮動標記垂直定位
    compassAvailable: false,
    gpsDenied: false,
    arrivedShown: {},    // pointId -> 是否已顯示到達 toast
    // AR 模式
    ar: {
      point: null,
      shots: [],
      idx: 0,
      stream: null,
      mockCompass: null,
    },
    geoWatch: null,
    mockGeo: null,
    compass: null,
    map: null,
    mapMarkers: {},
    mapMeMarker: null,
    mapMeCircle: null,
  };

  const mock = MockNS.isMock();

  // ---------- AR 浮動目標標記設定 ----------
  const AR_FOV_DEG = 60;        // 相機水平視角（度），可調
  const AR_PITCH_RANGE_DEG = 45; // 俯仰角映射到畫面上下滿版的範圍（簡化，非精確 FOV）
  const AR_NEAR_DIST_M = 40;    // 低於此距離顯示「GPS 誤差大」警語
  const AR_MARKER_MODE_KEY = 'surveyarcam:arMarkerMode';
  const AR_WATERMARK_MODE_KEY = 'surveyarcam:arWatermarkMode'; // 拍照浮水印開關（獨立於標記開關）
  const AR_ANNOTATED_SUFFIX = '_標註'; // 帶浮水印照片的檔名後綴（放在 .jpg 前）

  // ---------- 工具 ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function hashStr(s) {
    // djb2
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms || 2600);
  }

  function sanitizeFilePart(s) {
    return String(s).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  }

  // ---------- 資料驗證 ----------
  // 回傳 {ok:true} 或 {ok:false, error:'中文訊息'}
  function validateData(d) {
    if (!d || typeof d !== 'object') return err('JSON 根必須是物件');
    if (!d.project) return err('缺少必填欄位 project（專案名稱）');
    if (!d.categories || typeof d.categories !== 'object')
      return err('缺少必填欄位 categories（類型定義）');
    if (!Array.isArray(d.points)) return err('缺少必填欄位 points（點位陣列）');
    if (!d.points.length) return err('points 為空，至少需要一個點位');
    for (let i = 0; i < d.points.length; i++) {
      const p = d.points[i];
      const where = '第 ' + (i + 1) + ' 筆點位';
      if (!p || typeof p !== 'object') return err(where + '不是物件');
      if (!p.id) return err(where + '缺少必填欄位 id');
      if (!p.name) return err(where + '（' + (p.id || '?') + '）缺少必填欄位 name');
      if (!p.category) return err(where + '（' + p.id + '）缺少必填欄位 category');
      if (!d.categories[p.category])
        return err(where + '（' + p.id + '）的 category「' + p.category + '」在 categories 中不存在');
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number')
        return err(where + '（' + p.id + '）的 lat/lng 必須是數字');
    }
    // categories 每個 shots 應為陣列（若有）
    for (const k in d.categories) {
      const c = d.categories[k];
      if (!c.label) return err('類型「' + k + '」缺少 label');
      if (c.shots && !Array.isArray(c.shots))
        return err('類型「' + k + '」的 shots 必須是陣列');
    }
    return { ok: true };
    function err(m) { return { ok: false, error: m }; }
  }

  function shotsForPoint(p) {
    if (Array.isArray(p.shots) && p.shots.length) return p.shots.slice();
    const c = state.data.categories[p.category];
    return (c && Array.isArray(c.shots)) ? c.shots.slice() : [];
  }

  // ---------- 進度（localStorage） ----------
  function progKey(pointId) {
    return 'progress:' + state.dataHash + ':' + pointId;
  }
  function getProgress(pointId) {
    try {
      return JSON.parse(localStorage.getItem(progKey(pointId)) || '{}') || {};
    } catch (e) { return {}; }
  }
  function setShotDone(pointId, shot, done) {
    const pr = getProgress(pointId);
    if (done) pr[shot] = true; else delete pr[shot];
    localStorage.setItem(progKey(pointId), JSON.stringify(pr));
  }
  function resetProgress(pointId) {
    localStorage.removeItem(progKey(pointId));
  }
  function progressCount(p) {
    const pr = getProgress(p.id);
    const shots = shotsForPoint(p);
    let done = 0;
    shots.forEach((s) => { if (pr[s]) done++; });
    return { done, total: shots.length };
  }

  // ---------- 資料載入 ----------
  function saveDataCache(jsonText, hash) {
    try {
      localStorage.setItem('surveyarcam:data', JSON.stringify({
        hash, json: jsonText, savedAt: Date.now(),
      }));
    } catch (e) { /* 容量不足時忽略 */ }
  }

  function applyData(d, jsonText) {
    const v = validateData(d);
    if (!v.ok) throw new Error(v.error);
    state.data = d;
    const text = jsonText || JSON.stringify(d);
    state.dataHash = hashStr(text);
    state.points = d.points.slice();
    saveDataCache(text, state.dataHash);
    document.title = d.project + ' — SurveyARCam';
    $('#project-name').textContent = d.project;
    state.filterCat = 'all';
    startSensors();
    renderFilters();
    renderList();
    showApp();
  }

  // ---------- 分享連結（hash #d=base64url(UTF-8 JSON)） ----------
  function base64UrlToBytes(b64url) {
    let b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad === 1) throw new Error('base64 長度不合法');
    if (pad === 2) b64 += '==';
    else if (pad === 3) b64 += '=';
    const bin = atob(b64); // 字元不合法時丟 DOMException
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // gzip bytes → 原始 bytes（原生 DecompressionStream，Chrome 80+/iOS 16.4+）
  async function gunzipBytes(bytes) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // 解析 location.hash（含或不含開頭 #），回傳 Promise：
  //   {ok:true, data, jsonText}                 — 有 z=/d= 且成功解出合法 JSON
  //   {ok:false, error:''}                       — 沒有 z=/d= 參數（非錯誤，交給下一順位）
  //   {ok:false, error:'中文錯誤訊息'}            — 有 z=/d= 但解碼/解析失敗
  // z= 為 gzip 壓縮短連結（避免 LINE 截斷）；d= 為舊版無壓縮長連結，完全保留相容。
  // 注意：DecompressionStream 是 async，本函式因此為 async；唯一呼叫端 boot() 已改 await。
  async function decodeHashData(hash) {
    try {
      const h = String(hash || '').replace(/^#/, '');
      if (!h) return { ok: false, error: '' };
      const params = new URLSearchParams(h);
      const rawZ = params.get('z');
      const rawD = params.get('d');
      if (!rawZ && !rawD) return { ok: false, error: '' };

      let bytes;
      try {
        bytes = base64UrlToBytes(rawZ || rawD);
      } catch (e) {
        return { ok: false, error: '連結內的點位資料無法解析（base64 格式錯誤）' };
      }

      if (rawZ) {
        if (typeof DecompressionStream === 'undefined') {
          // 舊瀏覽器（如 iOS <16.4）沒有原生解壓能力
          return {
            ok: false,
            error: '此瀏覽器不支援壓縮連結（#z=）。請更新系統，或改用長連結（#d=）版本。',
          };
        }
        try {
          bytes = await gunzipBytes(bytes);
        } catch (e) {
          return { ok: false, error: '連結內的點位資料無法解析（解壓縮失敗）' };
        }
      }

      let jsonText;
      try {
        jsonText = new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        return { ok: false, error: '連結內的點位資料無法解析（文字編碼錯誤）' };
      }

      let d;
      try {
        d = JSON.parse(jsonText);
      } catch (e) {
        return { ok: false, error: '連結內的點位資料無法解析（JSON 格式錯誤）' };
      }

      return { ok: true, data: d, jsonText };
    } catch (e) {
      return { ok: false, error: '連結內的點位資料無法解析' };
    }
  }

  async function loadFromUrl(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('下載失敗：HTTP ' + res.status);
    const text = await res.text();
    let d;
    try { d = JSON.parse(text); } catch (e) { throw new Error('JSON 解析失敗：' + e.message); }
    applyData(d, text);
  }

  function loadFromCache() {
    try {
      const raw = localStorage.getItem('surveyarcam:data');
      if (!raw) return false;
      const obj = JSON.parse(raw);
      const d = JSON.parse(obj.json);
      applyData(d, obj.json);
      return true;
    } catch (e) { return false; }
  }

  // ---------- 畫面切換 ----------
  function showLoadScreen() {
    $('#screen-load').classList.remove('hidden');
    $('#app').classList.add('hidden');
  }
  function showApp() {
    $('#screen-load').classList.add('hidden');
    $('#app').classList.remove('hidden');
    switchTab('list');
  }
  function switchTab(name) {
    $$('.view').forEach((v) => v.classList.add('hidden'));
    $('#view-' + name).classList.remove('hidden');
    $$('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === name));
    if (name === 'map') initMap();
  }

  // ---------- 清單 ----------
  function renderFilters() {
    const box = $('#filters');
    box.innerHTML = '';
    const cats = state.data.categories;
    const chips = [['all', '全部', null]];
    for (const k in cats) chips.push([k, cats[k].label, cats[k].color]);
    chips.forEach(([key, label, color]) => {
      const b = document.createElement('button');
      b.className = 'chip' + (state.filterCat === key ? ' active' : '');
      b.textContent = label;
      if (color) b.style.setProperty('--chip', color);
      b.onclick = () => { state.filterCat = key; renderFilters(); renderList(); };
      box.appendChild(b);
    });
  }

  function sortedFilteredPoints() {
    let pts = state.points.slice();
    if (state.filterCat !== 'all')
      pts = pts.filter((p) => p.category === state.filterCat);
    if (state.pos) {
      pts.forEach((p) => {
        p._dist = G.haversine(state.pos.lat, state.pos.lng, p.lat, p.lng);
      });
      // 注意：原本這裡有 pts.sort((a,b)=>a._dist-b._dist) 按距離重排，
      // 會打亂 points 陣列的巡迴順序（route_to_points 已排好路線序），已移除。
      // 距離只計算供顯示，清單一律維持 points 原順序。
    }
    return pts;
  }

  function distText(m) {
    if (m == null) return '';
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(2) + ' km';
  }

  function renderList() {
    const wrap = $('#list');
    wrap.innerHTML = '';
    const pts = sortedFilteredPoints();
    // GPS 提示條
    $('#gps-banner').classList.toggle('hidden', !state.gpsDenied);
    pts.forEach((p) => {
      const cat = state.data.categories[p.category];
      const pc = progressCount(p);
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.pid = p.id;
      const arrived = state.pos &&
        G.haversine(state.pos.lat, state.pos.lng, p.lat, p.lng) <=
          (state.data.arrivalRadius || 30);
      if (arrived) card.classList.add('arrived');

      const badge = '<span class="badge" style="background:' + cat.color + '">' +
        cat.label + '</span>';
      const done = pc.done === pc.total && pc.total > 0;
      const prog = '<span class="prog' + (done ? ' done' : '') + '">' +
        (done ? '✔ ' : '') + pc.done + '/' + pc.total + '</span>';
      const dist = p._dist != null
        ? '<span class="dist">' + distText(p._dist) + '</span>' : '';

      card.innerHTML =
        '<div class="card-head">' + badge + prog + dist + '</div>' +
        '<div class="card-name">' + escapeHtml(p.name) + '</div>' +
        (p.note ? '<div class="card-note">' + escapeHtml(p.note) + '</div>' : '') +
        '<div class="card-btns">' +
          '<button class="btn nav">導航</button>' +
          '<button class="btn primary go">開始勘查</button>' +
        '</div>';
      // stopPropagation：導航絕不可誤觸開始勘查/AR 等其他動作
      card.querySelector('.nav').onclick = (e) => { e.stopPropagation(); navTo(p); };
      card.querySelector('.go').onclick = (e) => { e.stopPropagation(); openDetail(p); };
      wrap.appendChild(card);
    });
    if (!pts.length) wrap.innerHTML = '<p class="empty">此篩選沒有點位</p>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Google Maps 導航：不帶 origin（手機用自身 GPS 當起點）、開車模式、新分頁
  function navTo(p) {
    const url = 'https://www.google.com/maps/dir/?api=1&destination=' +
      p.lat + ',' + p.lng + '&travelmode=driving';
    window.open(url, '_blank');
  }

  // ---------- 點位詳情 ----------
  function openDetail(p) {
    state.detailPoint = p;
    const cat = state.data.categories[p.category];
    $('#detail-name').textContent = p.name;
    $('#detail-badge').textContent = cat.label;
    $('#detail-badge').style.background = cat.color;
    $('#detail-note').textContent = p.note || '';
    $('#detail-note').classList.toggle('hidden', !p.note);
    renderDetailShots(p);
    updateDetailDist();
    $('#view-detail').classList.remove('hidden');
    $('#view-detail').scrollTop = 0;
  }

  function renderDetailShots(p) {
    const box = $('#detail-shots');
    box.innerHTML = '';
    const shots = shotsForPoint(p);
    const pr = getProgress(p.id);
    shots.forEach((s) => {
      const row = document.createElement('label');
      row.className = 'shot-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!pr[s];
      cb.onchange = () => {
        setShotDone(p.id, s, cb.checked);
        renderList();
      };
      const span = document.createElement('span');
      span.textContent = s;
      row.appendChild(cb);
      row.appendChild(span);
      box.appendChild(row);
    });
    if (!shots.length) box.innerHTML = '<p class="empty">此點沒有拍攝項目</p>';
  }

  function updateDetailDist() {
    const p = state.detailPoint;
    if (!p) return;
    const el = $('#detail-dist');
    if (state.pos) {
      const d = G.haversine(state.pos.lat, state.pos.lng, p.lat, p.lng);
      el.textContent = '距離：' + distText(d);
    } else {
      el.textContent = '距離：定位未啟用';
    }
  }

  function closeDetail() {
    $('#view-detail').classList.add('hidden');
    state.detailPoint = null;
  }

  // ---------- 到點偵測 ----------
  function checkArrival() {
    if (!state.pos || !state.data) return;
    const radius = state.data.arrivalRadius || 30;
    state.points.forEach((p) => {
      const d = G.haversine(state.pos.lat, state.pos.lng, p.lat, p.lng);
      if (d <= radius) {
        if (!state.arrivedShown[p.id]) {
          state.arrivedShown[p.id] = true;
          toast('已到達 ' + p.name + '，開始拍攝');
        }
      } else if (d > radius * 1.5) {
        state.arrivedShown[p.id] = false; // 離開後可再次提示
      }
    });
  }

  // ---------- 感測器 ----------
  function startSensors() {
    if (state.geoWatch || state.mockGeo) return; // 已啟動
    if (mock) {
      const first = state.points[0];
      state.mockGeo = new MockNS.MockGeo(first, onGps);
      state.mockGeo.start();
    } else {
      state.geoWatch = new G.GeoWatch(onGps, onGpsError);
      state.geoWatch.start();
    }
  }

  function onGps(pos) {
    state.pos = pos;
    state.gpsDenied = false;
    checkArrival();
    // 只重排清單 / 更新距離
    if (!$('#view-list').classList.contains('hidden')) renderList();
    if (!$('#view-detail').classList.contains('hidden')) updateDetailDist();
    if (state.map) updateMapMe();
    if (!$('#view-ar').classList.contains('hidden')) {
      $('#ar-acc').textContent = 'GPS ±' + Math.round(pos.accuracy) + ' m';
      updateArMarker();
    }
  }

  function onGpsError(err) {
    state.gpsDenied = true;
    if (!$('#view-list').classList.contains('hidden')) renderList();
    if (!$('#view-detail').classList.contains('hidden')) updateDetailDist();
  }

  function makeCompass() {
    if (mock) return new MockNS.MockCompass(onHeading);
    return new G.Compass(onHeading);
  }
  function onHeading(filtered, raw, pitch) {
    state.heading = filtered;
    if (typeof pitch === 'number' && !isNaN(pitch)) state.pitch = pitch;
    state.compassAvailable = true;
    if (!$('#view-ar').classList.contains('hidden')) {
      updateArHeading();
      updateArMarker();
    }
  }

  // ---------- AR 拍攝 ----------
  async function enterAr(p) {
    state.ar.point = p;
    state.ar.shots = shotsForPoint(p);
    // 跳到第一個未完成
    const pr = getProgress(p.id);
    let idx = state.ar.shots.findIndex((s) => !pr[s]);
    state.ar.idx = idx < 0 ? 0 : idx;

    const cat = state.data.categories[p.category];
    $('#ar-name').textContent = p.name;
    $('#ar-cat').textContent = cat.label;
    $('#ar-cat').style.background = cat.color;
    $('#ar-note').textContent = p.note || '';

    $('#view-ar').classList.remove('hidden');
    $('#ar-error').classList.add('hidden');

    // 啟動羅盤（iOS 需在此使用者手勢後 requestPermission）
    if (!state.compass) state.compass = makeCompass();
    try {
      const ok = await state.compass.requestPermission();
      if (ok) state.compass.start();
    } catch (e) { /* 沒羅盤仍可拍 */ }

    // 啟動相機
    const video = $('#ar-video');
    try {
      if (mock) {
        state.ar.stream = MockNS.MockCameraStream();
        await CamNS.attachStream(video, state.ar.stream);
      } else {
        state.ar.stream = await CamNS.startCamera(video);
      }
    } catch (e) {
      showArError(e.message || '無法啟動相機');
      return;
    }
    renderArMarkerToggle();
    renderArWatermarkToggle();
    renderArShot();
    updateArHeading();
    updateArMarker();
  }

  function showArError(msg) {
    const box = $('#ar-error');
    box.classList.remove('hidden');
    $('#ar-error-msg').textContent = msg;
  }

  function renderArShot() {
    const shots = state.ar.shots;
    const p = state.ar.point;
    const pr = getProgress(p.id);
    if (!shots.length) {
      $('#ar-shot-label').textContent = '此點沒有拍攝項目';
      return;
    }
    const shot = shots[state.ar.idx];
    const done = !!pr[shot];
    $('#ar-shot-label').textContent = '請拍：' + shot + (done ? '  ✔' : '');
    $('#ar-shot-idx').textContent = (state.ar.idx + 1) + ' / ' + shots.length;
    // 全部完成？
    const allDone = shots.every((s) => pr[s]);
    $('#ar-done-banner').classList.toggle('hidden', !allDone);
  }

  function arNext() {
    if (!state.ar.shots.length) return;
    state.ar.idx = (state.ar.idx + 1) % state.ar.shots.length;
    renderArShot();
    updateArHeading();
  }
  function arPrev() {
    if (!state.ar.shots.length) return;
    state.ar.idx = (state.ar.idx - 1 + state.ar.shots.length) % state.ar.shots.length;
    renderArShot();
    updateArHeading();
  }

  function updateArHeading() {
    const p = state.ar.point;
    if (!p) return;
    const shot = state.ar.shots[state.ar.idx];
    const hint = p.bearingHints && p.bearingHints[shot];
    const arrow = $('#ar-arrow');
    const dirText = $('#ar-dir-text');
    const heading = state.heading;

    if (!state.compassAvailable || heading == null) {
      arrow.classList.add('hidden');
      dirText.textContent = '羅盤未啟用（方位不可用）';
      dirText.classList.remove('correct');
      return;
    }

    if (typeof hint === 'number') {
      // 目標方位 − 目前朝向；箭頭指向需轉的方向
      const rel = G.angleDiff(hint, heading); // -180..180
      arrow.classList.remove('hidden');
      arrow.style.transform = 'rotate(' + rel + 'deg)';
      const aligned = Math.abs(rel) <= 15;
      arrow.classList.toggle('correct', aligned);
      dirText.classList.toggle('correct', aligned);
      dirText.textContent = aligned
        ? '方向正確 ｜ 朝' + G.toEightDirCN(hint) + ' (' + Math.round(hint) + '°)'
        : '朝' + G.toEightDirCN(hint) + ' (' + Math.round(hint) + '°)';
    } else {
      arrow.classList.add('hidden');
      dirText.classList.remove('correct');
      dirText.textContent =
        '目前朝向：' + G.toEightDirCN(heading) + ' ' + Math.round(heading) + '°';
    }
  }

  // ---------- AR 浮動目標標記（寶可夢GO式，純 DOM/CSS 疊層，不進入拍照 canvas） ----------
  function getArMarkerMode() {
    try {
      return localStorage.getItem(AR_MARKER_MODE_KEY) === 'off' ? 'off' : 'on';
    } catch (e) { return 'on'; }
  }
  function setArMarkerMode(mode) {
    try { localStorage.setItem(AR_MARKER_MODE_KEY, mode); } catch (e) { /* 容量不足時忽略 */ }
  }

  // ---------- 拍照浮水印開關（開=帶標註照片、關=乾淨照片供報告書用） ----------
  function getArWatermarkMode() {
    try {
      return localStorage.getItem(AR_WATERMARK_MODE_KEY) === 'off' ? 'off' : 'on';
    } catch (e) { return 'on'; }
  }
  function setArWatermarkMode(mode) {
    try { localStorage.setItem(AR_WATERMARK_MODE_KEY, mode); } catch (e) { /* 容量不足時忽略 */ }
  }
  function renderArWatermarkToggle() {
    const btn = $('#ar-wm-toggle');
    if (!btn) return;
    const on = getArWatermarkMode() === 'on';
    btn.classList.toggle('active', on);
    btn.textContent = on ? '標註：開' : '標註：關';
    btn.title = on
      ? '照片帶浮水印標註（檔名加' + AR_ANNOTATED_SUFFIX + '）；點擊切換為乾淨照片'
      : '照片乾淨無浮水印（報告書格式）；點擊切換為帶標註';
  }

  // 目標相對方位角：正值＝目標在目前朝向的右側，負值＝左側；回傳 -180..180
  function computeRelAz(bearingToTarget, heading) {
    return G.angleDiff(bearingToTarget, heading);
  }

  // relAz/pitch → 畫面座標比例 {xRatio, yRatio}（0..1）；超出水平 FOV 回傳 null（交給既有邊緣箭頭）
  function projectToScreen(relAz, pitch, fovDeg) {
    const half = fovDeg / 2;
    if (Math.abs(relAz) > half) return null;
    const xRatio = relAz / fovDeg + 0.5;
    const p = Math.max(-AR_PITCH_RANGE_DEG, Math.min(AR_PITCH_RANGE_DEG, pitch || 0));
    // 世界錨定：相機往上仰（pitch 正）時，地平線高度的目標在畫面中往下移（yRatio 變大），
    // 與水平方向同理（右轉→目標左移），是反向補償
    const yRatio = 0.5 + p / (AR_PITCH_RANGE_DEG * 2);
    return { xRatio, yRatio };
  }

  function renderArMarkerToggle() {
    const btn = $('#ar-marker-toggle');
    if (!btn) return;
    const on = getArMarkerMode() === 'on';
    btn.classList.toggle('active', on);
    btn.textContent = on ? '📍' : '📍✕';
    btn.title = on ? '浮動標記：開（點擊關閉）' : '浮動標記：關（點擊開啟）';
  }

  function updateArMarker() {
    const wrap = $('#ar-marker');
    if (!wrap) return;
    const p = state.ar.point;
    if (!p || getArMarkerMode() === 'off') {
      wrap.classList.add('hidden');
      return;
    }
    if (!state.pos || !state.compassAvailable || state.heading == null) {
      wrap.classList.add('hidden');
      return;
    }

    const dist = G.haversine(state.pos.lat, state.pos.lng, p.lat, p.lng);
    const bearingToTarget = G.bearing(state.pos.lat, state.pos.lng, p.lat, p.lng);
    const relAz = computeRelAz(bearingToTarget, state.heading);
    const proj = projectToScreen(relAz, state.pitch, AR_FOV_DEG);

    if (!proj) {
      wrap.classList.add('hidden'); // FOV 外：維持既有邊緣箭頭（updateArHeading）行為，不畫浮動標記
      return;
    }

    const stage = $('#view-ar');
    const rect = stage.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;

    wrap.classList.remove('hidden');
    wrap.style.left = (proj.xRatio * w).toFixed(1) + 'px';
    wrap.style.top = (proj.yRatio * h).toFixed(1) + 'px';

    const cat = state.data.categories[p.category];
    $('#ar-marker-pin').style.background = cat.color;
    $('#ar-marker-name').textContent = p.name;
    $('#ar-marker-dist').textContent = distText(dist);
    $('#ar-marker-warn').classList.toggle('hidden', dist >= AR_NEAR_DIST_M);
  }

  function twoDigit(n) { return (n < 10 ? '0' : '') + n; }
  function nowParts() {
    const d = new Date();
    return {
      ymd: d.getFullYear() + '-' + twoDigit(d.getMonth() + 1) + '-' + twoDigit(d.getDate()),
      hm: twoDigit(d.getHours()) + twoDigit(d.getMinutes()),
      hmColon: twoDigit(d.getHours()) + ':' + twoDigit(d.getMinutes()),
    };
  }

  async function arCapture() {
    const p = state.ar.point;
    if (!p || !state.ar.shots.length) return;
    const shot = state.ar.shots[state.ar.idx];
    const cat = state.data.categories[p.category];
    const t = nowParts();

    // 方位字串：燒錄「拍照當下手機實際朝向」（羅盤拿不到時寫 --）
    let dirStr = '朝向--';
    if (state.compassAvailable && state.heading != null) {
      dirStr = '朝向' + G.toEightDirEN(state.heading) +
        '(' + Math.round(state.heading) + '°)';
    }
    const coordStr = state.pos
      ? state.pos.lat.toFixed(5) + ',' + state.pos.lng.toFixed(5)
      : '--,--';

    const SEP = '｜';
    const line = p.name + SEP + cat.label + SEP + shot + SEP + dirStr + SEP +
      coordStr + SEP + t.ymd + ' ' + t.hmColon;

    // 浮水印開關：開=帶標註（現行行為）、關=乾淨影格（報告書格式）
    // drawWatermark 對空陣列直接 return，不畫任何東西 → 乾淨照片
    const annotated = getArWatermarkMode() === 'on';
    const wmLines = annotated ? [line] : [];

    const video = $('#ar-video');
    let blob;
    try {
      if (video.videoWidth) {
        blob = await CamNS.capture(video, wmLines);
      } else if (state.ar.stream && state.ar.stream.__mockCanvas) {
        blob = await CamNS.captureFromCanvas(state.ar.stream.__mockCanvas, wmLines);
      } else {
        blob = await CamNS.capture(video, wmLines);
      }
    } catch (e) {
      toast('拍照失敗：' + (e.message || e));
      return;
    }

    // 檔名：{name}_{categoryLabel}_{shot}_{HHmm}.jpg（乾淨照維持既有契約）
    // 帶標註照加後綴：{name}_{categoryLabel}_{shot}_{HHmm}_標註.jpg
    const filename = sanitizeFilePart(p.name) + '_' +
      sanitizeFilePart(cat.label) + '_' +
      sanitizeFilePart(shot) + '_' + t.hm +
      (annotated ? AR_ANNOTATED_SUFFIX : '') + '.jpg';

    CamNS.download(blob, filename);

    // 分享（iOS 存相簿主要途徑）
    if (CamNS.canShareFile(blob, filename)) {
      const btn = $('#ar-share');
      btn.classList.remove('hidden');
      btn.onclick = () => CamNS.shareFile(blob, filename, p.name).catch(() => {});
    }

    // 打勾 + 跳下一未完成
    setShotDone(p.id, shot, true);
    renderList();
    toast('已拍：' + shot);

    const pr = getProgress(p.id);
    const next = state.ar.shots.findIndex((s) => !pr[s]);
    if (next < 0) {
      renderArShot(); // 顯示完成 banner
    } else {
      state.ar.idx = next;
      renderArShot();
      updateArHeading();
    }
  }

  function exitAr() {
    CamNS.stopStream(state.ar.stream);
    state.ar.stream = null;
    if (state.compass && !mock) state.compass.stop();
    if (state.compass && mock) state.compass.stop();
    $('#view-ar').classList.add('hidden');
    $('#ar-share').classList.add('hidden');
    renderList();
  }

  // ---------- 地圖 ----------
  function initMap() {
    const failed = window.__leafletFailed || typeof window.L === 'undefined';
    if (failed) {
      $('#map').classList.add('hidden');
      $('#map-fallback').classList.remove('hidden');
      return;
    }
    $('#map').classList.remove('hidden');
    $('#map-fallback').classList.add('hidden');
    if (state.map) { state.map.invalidateSize(); return; }

    const L = window.L;
    const map = L.map('map', { zoomControl: true });
    state.map = map;

    const emap = L.tileLayer(
      'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
      { maxZoom: 20, attribution: '國土測繪中心 NLSC EMAP' }
    );
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© OpenStreetMap' });

    let switched = false;
    emap.on('tileerror', () => {
      if (switched) return;
      switched = true;
      map.removeLayer(emap);
      osm.addTo(map);
    });
    emap.addTo(map);

    // 點位標記
    const pts = state.points;
    const bounds = [];
    pts.forEach((p) => {
      const cat = state.data.categories[p.category];
      const pc = progressCount(p);
      const allDone = pc.total > 0 && pc.done === pc.total;
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color: '#fff',
        weight: 2,
        fillColor: allDone ? '#888' : cat.color,
        fillOpacity: 0.9,
      }).addTo(map);
      const html = '<b>' + escapeHtml(p.name) + '</b><br>' +
        cat.label + '｜' + (allDone ? '✔ ' : '') + pc.done + '/' + pc.total +
        '<br><button class="popup-go">開始勘查</button>';
      m.bindPopup(html);
      m.on('popupopen', () => {
        const b = document.querySelector('.leaflet-popup .popup-go');
        if (b) b.onclick = () => { map.closePopup(); openDetail(p); };
      });
      state.mapMarkers[p.id] = m;
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    else map.setView([23.9, 120.9], 8);
    updateMapMe();
    setTimeout(() => map.invalidateSize(), 100);
  }

  function updateMapMe() {
    if (!state.map || !state.pos || typeof window.L === 'undefined') return;
    const L = window.L;
    const ll = [state.pos.lat, state.pos.lng];
    if (!state.mapMeMarker) {
      state.mapMeMarker = L.circleMarker(ll, {
        radius: 7, color: '#fff', weight: 2,
        fillColor: '#1a73e8', fillOpacity: 1,
      }).addTo(state.map);
      state.mapMeCircle = L.circle(ll, {
        radius: state.pos.accuracy || 20,
        color: '#1a73e8', weight: 1, fillOpacity: 0.1,
      }).addTo(state.map);
    } else {
      state.mapMeMarker.setLatLng(ll);
      state.mapMeCircle.setLatLng(ll).setRadius(state.pos.accuracy || 20);
    }
  }

  // ---------- 事件綁定 ----------
  function bindEvents() {
    // 分頁
    $$('.tab').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));

    // 載入畫面
    $('#file-input').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const text = r.result;
          const d = JSON.parse(text);
          applyData(d, text);
        } catch (err) {
          showLoadError('檔案解析失敗：' + err.message);
        }
      };
      r.readAsText(f);
    };
    $('#paste-btn').onclick = () => {
      const text = $('#paste-area').value.trim();
      if (!text) { showLoadError('請先貼上 JSON'); return; }
      try {
        const d = JSON.parse(text);
        applyData(d, text);
      } catch (err) { showLoadError('JSON 解析失敗：' + err.message); }
    };
    $('#sample-btn').onclick = async () => {
      try { await loadFromUrl('data/sample_points.json'); }
      catch (err) { showLoadError('載入範例失敗：' + err.message); }
    };

    // 詳情
    $('#detail-back').onclick = closeDetail;
    $('#detail-nav').onclick = () => navTo(state.detailPoint);
    $('#detail-ar').onclick = () => enterAr(state.detailPoint);
    $('#detail-reset').onclick = () => {
      if (state.detailPoint) {
        resetProgress(state.detailPoint.id);
        renderDetailShots(state.detailPoint);
        renderList();
        toast('已重設此點進度');
      }
    };

    // AR
    $('#ar-back').onclick = exitAr;
    $('#ar-shutter').onclick = arCapture;
    $('#ar-next').onclick = arNext;
    $('#ar-prev').onclick = arPrev;
    $('#ar-finish').onclick = exitAr;
    $('#ar-retry').onclick = () => { if (state.detailPoint) enterAr(state.detailPoint); };
    $('#ar-marker-toggle').onclick = () => {
      setArMarkerMode(getArMarkerMode() === 'off' ? 'on' : 'off');
      renderArMarkerToggle();
      updateArMarker();
    };
    $('#ar-wm-toggle').onclick = () => {
      const next = getArWatermarkMode() === 'off' ? 'on' : 'off';
      setArWatermarkMode(next);
      renderArWatermarkToggle();
      toast(next === 'on' ? '拍照將帶標註浮水印（檔名加_標註）' : '拍照為乾淨照片（報告書格式）');
    };

    // AR 觸控滑動切換項目
    let tx = null;
    const arMain = $('#view-ar');
    arMain.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
    arMain.addEventListener('touchend', (e) => {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx;
      if (Math.abs(dx) > 60) { if (dx < 0) arNext(); else arPrev(); }
      tx = null;
    }, { passive: true });

    // 切換到「載入其他資料」
    $('#reload-btn').onclick = () => showLoadScreen();
  }

  function showLoadError(msg) {
    const el = $('#load-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // ---------- 啟動 ----------
  async function boot() {
    bindEvents();
    if (mock) $('#mock-badge').classList.remove('hidden');

    // 優先序 1：hash 分享連結 #z=（gzip 壓縮短版）或 #d=（舊版長連結）（不清 hash，方便再轉傳）
    const hashResult = await decodeHashData(location.hash);
    if (hashResult.ok) {
      try {
        applyData(hashResult.data, hashResult.jsonText);
        return;
      } catch (e) {
        showLoadScreen();
        showLoadError('連結內的點位資料無法解析：' + e.message);
        return;
      }
    } else if (hashResult.error) {
      showLoadScreen();
      showLoadError(hashResult.error);
      return;
    }

    const params = new URLSearchParams(location.search);
    const dataUrl = params.get('data');

    if (dataUrl) {
      try {
        await loadFromUrl(decodeURIComponent(dataUrl));
        return;
      } catch (e) {
        showLoadScreen();
        showLoadError('由網址載入失敗：' + e.message);
        return;
      }
    }
    if (loadFromCache()) return;

    // mock 模式且無資料 → 自動載入範例，方便桌機測試
    if (mock) {
      try { await loadFromUrl('data/sample_points.json'); return; }
      catch (e) { /* 落到載入畫面 */ }
    }

    showLoadScreen();
  }

  document.addEventListener('DOMContentLoaded', boot);

  // 匯出給測試/除錯
  window.__app = {
    state, validateData, shotsForPoint, sanitizeFilePart, hashStr,
    decodeHashData, base64UrlToBytes,
    computeRelAz, projectToScreen, AR_FOV_DEG, AR_PITCH_RANGE_DEG, AR_NEAR_DIST_M,
    getArMarkerMode, setArMarkerMode, updateArMarker,
    getArWatermarkMode, setArWatermarkMode, AR_ANNOTATED_SUFFIX,
    navTo, sortedFilteredPoints,
  };
})();
