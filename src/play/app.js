(() => {
'use strict';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const CATS = ['อาหาร', 'กีฬา', 'เทศกาลและวัฒนธรรม', 'สถานที่ท่องเที่ยว'];
const SHORT = { 'อาหาร': 'อาหาร', 'กีฬา': 'กีฬา', 'เทศกาลและวัฒนธรรม': 'เทศกาล', 'สถานที่ท่องเที่ยว': 'ท่องเที่ยว' };
const TAG_TH = { region: 'ภาค', dialect: 'ภาษาถิ่น', religion_culture: 'ศาสนา/วัฒนธรรม', terrain: 'ภูมิประเทศ', main_occupation: 'อาชีพหลัก' };
const ANSWER_SECONDS = 15;
const SHARE_URL_BUILD = '';
const CFG = window.ALLTHAI_CONFIG || {};
const SHARE_URL = CFG.shareUrl || SHARE_URL_BUILD || (/^https?:$/.test(location.protocol) ? location.origin + location.pathname : '');
const BE = window.AllThaiBackend;
const CIRC = 2 * Math.PI * 28;

const fmt = n => Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function thaiDate(dateStr, long) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 5)).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' });
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- local storage (one viewer's browser only) ---------- */
const LS_KEY = 'allthai.v1';
let S = {};
try { S = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { S = {}; }
S.daily = S.daily || {};
S.unl = S.unl || { total: 0, rounds: 0 };
S.nick = S.nick || '';
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: keep playing in memory */ } }
const playerName = () => S.nick || 'ผู้เล่นใหม่';

/* ---------- small UI helpers ---------- */
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400); }
let current = 's-home';
function show(id) {
  current = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  $(id).scrollTop = 0;
}
function modal(nodes, buttons) {
  return new Promise(resolve => {
    const m = $('modal'); m.innerHTML = '';
    nodes.forEach(n => m.appendChild(n));
    const row = document.createElement('div'); row.className = buttons.length > 1 ? 'row2' : '';
    buttons.forEach(b => {
      const x = document.createElement('button'); x.type = 'button';
      x.className = 'btn' + (b.primary ? ' primary' : '') + (buttons.length === 1 ? ' block' : '');
      x.textContent = b.label;
      x.onclick = () => { $('modal-bg').classList.remove('on'); resolve(b.value); };
      row.appendChild(x);
    });
    m.appendChild(row);
    $('modal-bg').classList.add('on');
    row.querySelector('button').focus();
  });
}
function para(text, cls) { const p = document.createElement('p'); p.textContent = text; if (cls) p.className = cls; return p; }
function zoomImage(src, alt) {
  const img = new Image(); setImg(img, src); img.alt = alt || 'ภาพเบาะแส';
  modal([img], [{ label: 'ปิด', value: 0 }]);
}
function countUp(el, to) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || to <= 0) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 650;
  const step = now => { const k = Math.min(1, (now - t0) / dur); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const licTh = l => l === 'Public domain' ? 'สาธารณสมบัติ' : l;
// Credit line under every image: Wikimedia Commons file, a player's photo, or another source the team cleared.
function creditText(c) {
  if (c.source === 'player') return 'ภาพ: ' + (c.credit || 'ผู้เล่นออลไทย') + ' · ภาพจากผู้เล่นออลไทย';
  if (c.source === 'other') return 'ภาพ: ' + c.credit + (c.license ? ' / ' + licTh(c.license) : '');
  return 'ภาพ: ' + c.credit + ' / Wikimedia Commons / ' + licTh(c.license);
}
// card.src may be a relative file, a storage URL, or a demo photo kept in this browser ("idb:")
function setImg(img, src) {
  if (src && src.indexOf('idb:') === 0) BE.imageUrl(src).then(u => { if (u) img.src = u; });
  else img.src = src || '';
}

/* ---------- data (questions come from the shared backend: Supabase, or this browser in demo mode) ---------- */
let PROV = {}, QS = [], MAP = null, PATH = {}, CONTENT_SOURCE = '';
function applyContent(content) {
  const prov = {};
  content.provinces.forEach(p => { prov[p.id] = p; });
  PROV = prov;
  QS = content.questions.filter(q => q.cards && q.cards[0] && q.cards[0].src && PROV[q.answer] && CATS.includes(q.category));
  CONTENT_SOURCE = content.source;
}
async function loadData() {
  const getMap = fetch('data/map.json').then(r => { if (!r.ok) throw new Error('map ' + r.status); return r.json(); });
  const [content, map] = await Promise.all([BE.loadContent(), getMap]);
  applyContent(content);
  MAP = map;
  map.provinces.forEach(p => { PATH[p.id] = p; });
}

/* ---------- map: SVG + pan / pinch / wheel zoom, tap to select ---------- */
function createMapView(panel, data) {
  const [, , W, H] = data.viewBox;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'map-svg', role: 'img', 'aria-label': 'แผนที่ประเทศไทย 77 จังหวัด' });
  const g = svgEl('g', {}, svg);
  const nb = svgEl('g', { class: 'nbr' }, g);
  data.neighbors.forEach(n => svgEl('path', { d: n.d }, nb));
  const pv = svgEl('g', { class: 'prov' }, g);
  const byId = {};
  data.provinces.forEach(p => { byId[p.id] = svgEl('path', { d: p.d, 'data-id': p.id }, pv); });
  const lb = svgEl('g', { class: 'labels' }, g);
  data.provinces.forEach(p => { const t = svgEl('text', { x: p.label[0], y: p.label[1] }, lb); t.textContent = PROV[p.id].name_th; });
  panel.insertBefore(svg, panel.firstChild);

  let k = 1, tx = 0, ty = 0, sel = null, onSelect = () => {};
  const pointers = new Map();
  let gesture = null;
  const apply = () => {
    g.setAttribute('transform', 'translate(' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ') scale(' + k.toFixed(4) + ')');
    svg.style.setProperty('--k', k.toFixed(4));
    svg.classList.toggle('show-labels', k >= 2.6);
  };
  const clamp = () => {
    k = Math.min(14, Math.max(1, k));
    const m = 0.25;
    tx = Math.min(W * m, Math.max(W * (1 - m) - W * k, tx));
    ty = Math.min(H * m, Math.max(H * (1 - m) - H * k, ty));
  };
  const toSvg = (cx, cy) => { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  const zoomAt = (f, sx, sy) => { const k0 = k; k = Math.min(14, Math.max(1, k * f)); const r = k / k0; tx = sx - (sx - tx) * r; ty = sy - (sy - ty) * r; clamp(); apply(); };
  function select(id) {
    if (sel && byId[sel]) byId[sel].classList.remove('sel');
    sel = id;
    if (id && byId[id]) { byId[id].classList.add('sel'); pv.appendChild(byId[id]); }
    onSelect(id);
  }
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const target = e.target.closest ? e.target.closest('path[data-id]') : null;
      gesture = { type: 'pan', start: toSvg(e.clientX, e.clientY), tx0: tx, ty0: ty, sx: e.clientX, sy: e.clientY, t: performance.now(), target: target ? target.getAttribute('data-id') : null, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: k, mid0: toSvg((a.x + b.x) / 2, (a.y + b.y) / 2), tx0: tx, ty0: ty, moved: true };
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.type === 'pan' && pointers.size === 1) {
      if (!gesture.moved && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 7) gesture.moved = true;
      if (!gesture.moved) return;
      const p = toSvg(e.clientX, e.clientY);
      tx = gesture.tx0 + (p.x - gesture.start.x); ty = gesture.ty0 + (p.y - gesture.start.y);
      clamp(); apply();
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      const k1 = Math.min(14, Math.max(1, gesture.k0 * d / gesture.d0));
      const px = (gesture.mid0.x - gesture.tx0) / gesture.k0, py = (gesture.mid0.y - gesture.ty0) / gesture.k0;
      k = k1; tx = mid.x - px * k1; ty = mid.y - py * k1;
      clamp(); apply();
    }
  });
  const end = e => {
    const g0 = gesture;
    pointers.delete(e.pointerId);
    if (g0 && g0.type === 'pan' && !g0.moved && e.type === 'pointerup' && performance.now() - g0.t < 700 && g0.target) select(g0.target);
    if (pointers.size === 0) gesture = null;
    else if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      gesture = { type: 'pan', start: toSvg(p.x, p.y), tx0: tx, ty0: ty, sx: p.x, sy: p.y, t: 0, target: null, moved: true };
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', e => { e.preventDefault(); const p = toSvg(e.clientX, e.clientY); zoomAt(Math.exp(-e.deltaY * 0.0018), p.x, p.y); }, { passive: false });
  apply();
  return {
    zoomIn: () => zoomAt(1.7, W / 2, H / 2),
    zoomOut: () => zoomAt(1 / 1.7, W / 2, H / 2),
    reset: () => { k = 1; tx = 0; ty = 0; apply(); },
    clear: () => select(null),
    onSelect: fn => { onSelect = fn; }
  };
}
let mapView = null;

function drawGhostMap() {
  const svg = $('ghost-map');
  MAP.provinces.forEach(p => svgEl('path', { d: p.d }, svg));
}

function miniMap(box, answerId, guessId) {
  box.innerHTML = '';
  const pa = PATH[answerId], pg = guessId ? PATH[guessId] : null;
  let [x0, y0, x1, y1] = pa.bbox;
  if (pg) { x0 = Math.min(x0, pg.bbox[0]); y0 = Math.min(y0, pg.bbox[1]); x1 = Math.max(x1, pg.bbox[2]); y1 = Math.max(y1, pg.bbox[3]); }
  const pad = 36; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let w = x1 - x0, h = y1 - y0;
  const ar = 2.0;
  if (w < 200) { const s = 200 / w; x0 -= (w * s - w) / 2; y0 -= (h * s - h) / 2; w *= s; h *= s; }
  if (w / h < ar) { const nw = h * ar; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / ar; y0 -= (nh - h) / 2; h = nh; }
  const svg = svgEl('svg', { viewBox: [x0, y0, w, h].map(v => v.toFixed(1)).join(' '), preserveAspectRatio: 'xMidYMid meet' });
  const nb = svgEl('g', { class: 'nbr' }, svg);
  MAP.neighbors.forEach(n => svgEl('path', { d: n.d }, nb));
  const pv = svgEl('g', { class: 'prov' }, svg);
  MAP.provinces.forEach(p => { if (p.id !== answerId && p.id !== guessId) svgEl('path', { d: p.d }, pv); });
  if (pg) svgEl('path', { d: pg.d, class: 'is-guess' }, pv);
  svgEl('path', { d: pa.d, class: 'is-answer' }, pv);
  box.appendChild(svg);
}

/* ---------- shared leaderboard + test metrics (optional: signed-in viewers only) ---------- */
const DB = { ready: false, db: null, uid: null, canWrite: false, daily: null, unl: null, stats: {} };
let writeChain = Promise.resolve();
function dbSet(path, body) {
  if (!DB.ready || !DB.canWrite) return;
  writeChain = writeChain.then(() => DB.db.doc(path).set(body)).catch(e => { if (e && e.code === 'invalid_argument') DB.canWrite = false; });
}
async function initDB() {
  const c = window.claude;
  if (!c || typeof c.use !== 'function') return;
  try {
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    let can = null;
    try { can = await user.can('data.write'); } catch (e) { can = null; }
    Object.assign(DB, { db, uid, canWrite: can !== false, ready: true });
    const today = bangkokDate();
    db.collection('daily').where('date', '==', today).onSnapshot(s => {
      DB.daily = s.docs.map(d => Object.assign({ id: d.id }, d.data()));
      if (current === 's-board') renderBoard();
    }, () => { DB.daily = null; });
    db.collection('unlimited').onSnapshot(s => {
      DB.unl = s.docs.map(d => Object.assign({ id: d.id }, d.data()));
      if (current === 's-board') renderBoard();
    }, () => { DB.unl = null; });
    if (DB.canWrite) {
      try { const sd = await db.doc('stats/' + uid).get(); DB.stats = sd.exists ? JSON.parse(JSON.stringify(sd.data())) : {}; } catch (e) { DB.stats = {}; }
      const rec = S.daily[today];
      if (rec && rec.done && !rec.pushed) pushDaily(today);
    }
  } catch (e) { /* no shared data in this view: the page stays local */ }
}
async function pushDaily(date) {
  const rec = S.daily[date];
  if (!DB.ready || !DB.canWrite || !rec || !rec.done) return;
  try {
    const cur = await DB.db.doc('daily/' + DB.uid).get();
    if (!(cur.exists && cur.data().date === date)) {   // first finished run of the day counts
      dbSet('daily/' + DB.uid, { date, name: rec.name || playerName(), score: rec.total, timeMs: rec.timeMs, cats: rec.results.map(r => r.score), at: Date.now() });
    }
    rec.pushed = true; save();
  } catch (e) { /* retry on next visit */ }
}
function pushUnlimited() {
  if (S.unl.rounds > 0) dbSet('unlimited/' + DB.uid, { name: playerName(), total: S.unl.total, rounds: S.unl.rounds, at: Date.now() });
}
function stat(kind, payload) {
  if (!DB.ready || !DB.canWrite) return;
  const s = DB.stats;
  s.name = playerName();
  if (kind === 'dailyStarted') (s.dailyStarted = s.dailyStarted || {})[payload] = true;
  else if (kind === 'dailyFinished') (s.dailyFinished = s.dailyFinished || {})[payload] = true;
  else if (kind === 'share') { s.shares = s.shares || {}; s.shares[payload] = (s.shares[payload] || 0) + 1; }
  else if (kind === 'answer') {
    s.answers = s.answers || {};
    const r = payload;
    s.answers[r.qid] = { mode: r.mode, correct: r.correct, timeout: r.timeout, cards: r.cards, score: r.score, timeMs: r.timeMs, guess: r.guess, at: Date.now() };
  }
  s.updatedAt = Date.now();
  dbSet('stats/' + DB.uid, JSON.parse(JSON.stringify(s)));
}

/* ---------- game ---------- */
let G = null;
const runTotal = () => G ? G.results.reduce((s, r) => s + r.score, 0) : 0;
function resultRecord(q, res, guess, cards, ms, mode) {
  return { qid: q.id, category: q.category, guess, correct: res.correct, timeout: res.timeout, cards, h: res.h, base: res.base, score: res.score, timeMs: ms, mode };
}

function startDaily() {
  if (!QS.length) { toast('ยังไม่มีคำถามที่เผยแพร่'); return; }
  const today = bangkokDate();
  const rec = S.daily[today] || (S.daily[today] = { date: today, results: [], done: false });
  if (rec.done) { renderSummary(today); show('s-summary'); return; }
  const set = dailySet(QS, CATS, today);
  if (rec.pending && !rec.results.some(r => r.qid === rec.pending)) {
    const q = set.find(x => x.id === rec.pending);
    if (q) {
      const res = scoreAnswer({ question: q, guessId: null, cardsOpened: rec.pendingCards || 1, timedOut: true, profiles: PROV });
      rec.results.push(resultRecord(q, res, null, rec.pendingCards || 1, ANSWER_SECONDS * 1000, 'daily'));
      toast('ข้อที่ออกกลางคันนับเป็นหมดเวลา');
    }
  }
  rec.pending = null;
  if (!rec.started) { rec.started = true; stat('dailyStarted', today); }
  save();
  G = { mode: 'daily', date: today, list: set, i: rec.results.length, results: rec.results, cards: 1 };
  if (G.i >= set.length) { finishDaily(); return; }
  nextQuestion();
}
function startUnlimited() {
  if (!QS.length) { toast('ยังไม่มีคำถามที่เผยแพร่'); return; }
  const todays = new Set(dailySet(QS, CATS, bangkokDate()).map(q => q.id));
  const pool = shuffle(QS.filter(q => !todays.has(q.id)));
  if (!pool.length) { toast('ยังไม่มีคำถามสำหรับโหมดนี้'); return; }
  G = { mode: 'unl', list: pool, i: 0, results: [], cards: 1 };
  nextQuestion();
}
function nextQuestion() {
  G.cards = 1; G.sel = null; G.answered = false;
  const q = G.list[G.i];
  if (G.mode === 'daily') { const rec = S.daily[G.date]; rec.pending = q.id; rec.pendingCards = 1; save(); }
  renderQuestion();
  show('s-question');
}
const progressLabel = () => G.mode === 'daily' ? 'ข้อ ' + (G.i + 1) + '/' + G.list.length : 'ข้อที่ ' + (G.i + 1);
function renderQuestion() {
  const q = G.list[G.i];
  $('q-pill').textContent = (G.mode === 'daily' ? 'โหมดรายวัน · ' : 'ไม่จำกัด · ') + progressLabel();
  $('q-score').textContent = fmt(runTotal());
  $('q-meta').textContent = 'ผู้เล่น: ' + playerName() + ' · หมวด' + q.category;
  updateMult();
  renderClues($('q-clues'), q);
}
function updateMult() { const h = multiplierFor(G.cards).toFixed(1); $('q-mult').textContent = h; $('sheet-mult').textContent = h; }
function renderClues(box, q) {
  box.innerHTML = '';
  q.cards.forEach((c, idx) => {
    const n = idx + 1;
    const kind = c.type === 'image' ? 'ภาพ' : 'ข้อความ';
    if (n === 1 || n <= G.cards) {
      const d = document.createElement('div');
      d.className = 'clue' + (n > 1 ? ' open' : '');
      d.innerHTML = '<div class="clue-head"><span>การ์ด ' + n + ' · ' + (n === 1 ? 'ภาพหลัก' : kind) + '</span><span>' + (n === 1 ? 'เปิดฟรี' : 'ตัวคูณ ' + multiplierFor(n).toFixed(1)) + '</span></div>';
      if (c.type === 'image') {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'clue-img'; b.setAttribute('aria-label', 'ขยายภาพเบาะแส');
        const img = new Image(); setImg(img, c.src); img.alt = 'ภาพเบาะแส'; img.decoding = 'async'; img.style.objectPosition = c.focus || '50% 50%';
        b.appendChild(img); b.onclick = () => zoomImage(c.src);
        d.appendChild(b);
        d.appendChild(para(creditText(c), 'credit'));
      } else {
        d.appendChild(para(c.text, 'hint-text'));
      }
      if (c.tag_hint) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'เบาะแสเรื่อง' + TAG_TH[c.tag_hint]; d.appendChild(t); }
      box.appendChild(d);
    } else {
      const isNext = n === G.cards + 1;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'clue locked'; b.disabled = !isNext;
      b.innerHTML = '<span>การ์ด ' + n + ' · ' + kind + '</span><span class="cost">' + (isNext ? 'เปิด · ตัวคูณ ' + multiplierFor(n).toFixed(1) : 'เปิดการ์ด ' + (n - 1) + ' ก่อน') + '</span>';
      b.onclick = () => openCard(n);
      box.appendChild(b);
    }
  });
}
function openCard(n) {
  if (!G || n !== G.cards + 1 || G.answered) return;
  G.cards = n;
  if (G.mode === 'daily') { S.daily[G.date].pendingCards = n; save(); }
  updateMult();
  const q = G.list[G.i];
  renderClues($('q-clues'), q);
  if ($('sheet-bg').classList.contains('on')) renderClues($('sheet-clues'), q);
}

function setChoice(id) {
  const b = $('a-choice');
  if (id) { b.textContent = PROV[id].name_th; b.classList.remove('none'); } else { b.textContent = 'ยังไม่ได้เลือก'; b.classList.add('none'); }
  $('a-confirm').disabled = !id;
}
function goAnswer() {
  $('a-who').textContent = 'ผู้เล่น: ' + playerName();
  $('a-progress').textContent = progressLabel() + ' · คะแนน ' + fmt(runTotal());
  G.sel = null; mapView.clear(); mapView.reset(); setChoice(null);
  show('s-answer');
  startTimer();
}
function startTimer() {
  stopTimer();
  G.t0 = performance.now();
  const tick = () => {
    const left = Math.max(0, ANSWER_SECONDS - (performance.now() - G.t0) / 1000);
    $('timer-num').textContent = Math.ceil(left);
    $('timer-bar').setAttribute('stroke-dashoffset', (CIRC * (1 - left / ANSWER_SECONDS)).toFixed(2));
    $('timer').classList.toggle('low', left <= 5);
    if (left <= 0) { finishAnswer(true); return; }
    G.raf = requestAnimationFrame(tick);
  };
  G.raf = requestAnimationFrame(tick);
}
function stopTimer() { if (G && G.raf) { cancelAnimationFrame(G.raf); G.raf = null; } }
function openSheet() { renderClues($('sheet-clues'), G.list[G.i]); $('sheet-bg').classList.add('on'); }
function closeSheet() { $('sheet-bg').classList.remove('on'); }

function finishAnswer(timedOut) {
  if (!G || G.answered) return;
  G.answered = true; stopTimer(); closeSheet();
  const q = G.list[G.i];
  const ms = timedOut ? ANSWER_SECONDS * 1000 : Math.min(ANSWER_SECONDS * 1000, Math.round(performance.now() - G.t0));
  const guess = timedOut ? null : G.sel;
  const res = scoreAnswer({ question: q, guessId: guess, cardsOpened: G.cards, timedOut, profiles: PROV });
  const rec = resultRecord(q, res, guess, G.cards, ms, G.mode);
  G.results.push(rec);
  if (G.mode === 'daily') { S.daily[G.date].pending = null; }
  else { S.unl.total += rec.score; S.unl.rounds += 1; }
  save();
  stat('answer', rec);
  renderReveal(q, res, rec);
  show('s-reveal');
}
function addLine(box, label, pts, total) {
  const d = document.createElement('div'); d.className = 'ln' + (total ? ' total' : '');
  const a = document.createElement('span'); a.textContent = label;
  const b = document.createElement('span'); b.textContent = pts;
  d.append(a, b); box.appendChild(d);
}
function renderReveal(q, res, rec) {
  const ans = PROV[q.answer], guess = rec.guess ? PROV[rec.guess] : null;
  $('rv-who').textContent = 'ผู้เล่น: ' + playerName() + ' · ' + progressLabel() + ' · ' + SHORT[q.category];
  $('rv-total').textContent = fmt(runTotal());
  $('rv-you').textContent = res.timeout ? 'หมดเวลา · คำตอบคือ' : res.correct ? 'คุณตอบถูก · คำตอบคือ' : 'คุณตอบ ' + guess.name_th + ' · คำตอบคือ';
  $('rv-name').textContent = ans.name_th;
  const acc = res.correct ? res.score : 0, ana = res.correct ? 0 : res.score;
  countUp($('rv-acc-n'), acc); countUp($('rv-ana-n'), ana);
  $('rv-acc-sub').textContent = res.correct ? '1,000 × ตัวคูณ ' + res.h.toFixed(1) : 'ตอบถูกได้ ' + fmt(1000 * res.h);
  $('rv-ana-sub').textContent = res.correct ? 'ไม่ต้องใช้ เพราะตอบถูก' : 'ตัวคูณการ์ด × ' + res.h.toFixed(1);
  $('rv-acc').classList.toggle('hot', res.correct);
  $('rv-ana').classList.toggle('hot', !res.correct && !res.timeout);
  const box = $('rv-lines'); box.innerHTML = '';
  if (res.timeout) addLine(box, 'หมดเวลา 15 วินาทีโดยยังไม่ยืนยันคำตอบ', '0');
  else if (!res.correct && !res.lines.length) addLine(box, guess.name_th + ' ไม่มีป้ายที่ตรงกับ' + ans.name_th, '+0');
  else res.lines.forEach(l => addLine(box, l.label, '+' + fmt(l.points)));
  if (!res.timeout) addLine(box, 'รวม ' + fmt(res.base) + ' × ตัวคูณ ' + res.h.toFixed(1), fmt(res.score), true);
  miniMap($('rv-map'), q.answer, rec.guess);
  renderFacts(q);
  const last = G.mode === 'daily' && G.i + 1 >= G.list.length;
  $('rv-next').textContent = last ? 'ดูสรุปวันนี้' : 'เล่นต่อ';
  $('rv-stop').textContent = G.mode === 'daily' ? (last ? 'กลับหน้าแรก' : 'พักไว้ก่อน') : 'เล่นแค่นี้';
}
function renderFacts(q) {
  const r = q.reveal, art = $('rv-facts');
  art.innerHTML = '';
  const ph = document.createElement('button'); ph.type = 'button'; ph.className = 'ph'; ph.setAttribute('aria-label', 'ขยายภาพ ' + q.topic);
  const img = new Image(); setImg(img, r.image.src); img.alt = q.topic; img.style.objectPosition = r.image.focus || '50% 50%';
  ph.appendChild(img); ph.onclick = () => zoomImage(r.image.src, q.topic);
  art.appendChild(ph);
  const body = document.createElement('div'); body.className = 'body';
  body.appendChild(para(creditText(r.image) + (r.image.note ? ' · ' + r.image.note : ''), 'credit'));
  const h = document.createElement('h2'); h.textContent = 'ข้อมูลจริง: ' + q.topic; body.appendChild(h);
  if (!q.verified_by) { const c = document.createElement('span'); c.className = 'status-chip'; c.textContent = 'รอทีมตรวจทาน · เรียบเรียงจากแหล่งด้านล่าง'; body.appendChild(c); }
  const dl = document.createElement('dl'); dl.className = 'facts';
  Object.entries(r.facts).forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); });
  body.appendChild(dl);
  body.appendChild(para('วิธีคิด: ' + r.reasoning, 'howto'));
  const src = document.createElement('div'); src.className = 'sources';
  src.appendChild(para('ที่มาข้อมูล'));
  r.sources.forEach(s => { const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = s.title; src.appendChild(a); });
  if (r.image.source_url) {
    const a = document.createElement('a'); a.href = r.image.source_url; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = (r.image.source || 'commons') === 'commons' ? 'ไฟล์ภาพต้นฉบับบน Wikimedia Commons' : 'ที่มาของภาพ';
    src.appendChild(a);
  }
  body.appendChild(src);
  art.appendChild(body);
}

function finishDaily() {
  const rec = S.daily[G.date];
  rec.done = true;
  rec.total = rec.results.reduce((s, r) => s + r.score, 0);
  rec.timeMs = rec.results.reduce((s, r) => s + (r.timeMs || 0), 0);
  rec.name = playerName();
  save();
  stat('dailyFinished', G.date);
  pushDaily(G.date);
  renderSummary(G.date);
  show('s-summary');
}
function stopUnlimited() {
  pushUnlimited();
  const n = G ? G.results.length : 0;
  if (n) toast('รอบนี้ ' + n + ' ข้อ ได้ ' + fmt(runTotal()) + ' คะแนน');
  openBoard('unl');
}
function renderSummary(date) {
  const rec = S.daily[date];
  const total = rec.results.reduce((s, r) => s + r.score, 0);
  $('sum-pill').textContent = 'โหมดรายวัน · ' + thaiDate(date, true);
  countUp($('sum-score'), total);
  const rank = DB.ready && Array.isArray(DB.daily) ? myRank('daily') : null;
  const max = Math.max(1, rec.results.length) * 1000;
  $('sum-sub').textContent = 'จาก ' + fmt(max) + ' คะแนน' + (rank ? ' · อันดับวันนี้ ' + rank : '');
  const box = $('sum-cats'); box.innerHTML = '';
  CATS.forEach(c => {
    const r = rec.results.find(x => x.category === c);
    const d = document.createElement('div'); d.className = 'ln';
    const a = document.createElement('span'); a.textContent = c + (r ? (r.correct ? ' ✓' : r.timeout ? ' · หมดเวลา' : '') : '');
    const b = document.createElement('b'); b.textContent = r ? fmt(r.score) : '–';
    d.append(a, b); box.appendChild(d);
  });
  const text = shareText({
    dateLabel: thaiDate(date), total, max,
    perCategory: CATS.map(c => ({ short: SHORT[c], correct: !!(rec.results.find(x => x.category === c) || {}).correct })),
    url: SHARE_URL
  });
  $('share-text').textContent = text;
  $('share-line').href = 'https://line.me/R/share?text=' + encodeURIComponent(text);
  $('share-fb').href = SHARE_URL ? 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(SHARE_URL) : 'https://www.facebook.com/';
}

/* ---------- leaderboard ---------- */
let boardTab = 'daily';
function boardRows(tab) {
  const today = bangkokDate();
  if (tab === 'daily') {
    let list = [], shared = false;
    if (DB.ready && Array.isArray(DB.daily)) { list = DB.daily.map(d => ({ name: d.name || 'ผู้เล่น', score: d.score || 0, timeMs: d.timeMs || 0, me: d.id === DB.uid })); shared = true; }
    const rec = S.daily[today];
    if (rec && rec.done && !list.some(e => e.me)) list.push({ name: playerName(), score: rec.total, timeMs: rec.timeMs, me: true });
    return { rows: rankDaily(list), shared };
  }
  let list = [], shared = false;
  if (DB.ready && Array.isArray(DB.unl)) { list = DB.unl.map(d => ({ name: d.name || 'ผู้เล่น', total: d.total || 0, rounds: d.rounds || 0, me: d.id === DB.uid })); shared = true; }
  const mine = list.find(e => e.me);
  if (mine) { mine.total = Math.max(mine.total, S.unl.total); mine.rounds = Math.max(mine.rounds, S.unl.rounds); }
  else if (S.unl.rounds) list.push({ name: playerName(), total: S.unl.total, rounds: S.unl.rounds, me: true });
  return { rows: rankUnlimited(list, 10), shared };
}
function myRank(tab) { const { rows } = boardRows(tab); const i = rows.findIndex(r => r.me); return i < 0 ? null : i + 1; }
function openBoard(tab) { boardTab = tab || boardTab; renderBoard(); show('s-board'); }
function renderBoard() {
  const daily = boardTab === 'daily';
  $('tab-daily').classList.toggle('on', daily); $('tab-daily').setAttribute('aria-selected', String(daily));
  $('tab-unl').classList.toggle('on', !daily); $('tab-unl').setAttribute('aria-selected', String(!daily));
  $('b-rule').textContent = daily
    ? 'คะแนนรวมข้อของวันนี้ (ข้อละ 1,000) · เท่ากันวัดที่เวลาบนหน้าตอบ · รีเซ็ตเที่ยงคืน'
    : 'คะแนนเฉลี่ยต่อข้อ ต้องเล่นอย่างน้อย 10 ข้อ · เท่ากันวัดที่จำนวนข้อ';
  const { rows, shared } = boardRows(boardTab);
  const meIdx = rows.findIndex(r => r.me);
  const me = $('b-me'); me.innerHTML = '';
  const left = document.createElement('div'); left.append(Object.assign(document.createElement('small'), { textContent: 'อันดับของคุณ' }), Object.assign(document.createElement('b'), { textContent: playerName() }));
  const right = document.createElement('div'); right.className = 'rk';
  if (meIdx >= 0) {
    const r = rows[meIdx];
    right.append(Object.assign(document.createElement('b'), { textContent: String(meIdx + 1) }), Object.assign(document.createElement('small'), { textContent: daily ? fmt(r.score) + ' คะแนน' : fmt(r.avg) + ' ต่อข้อ' }));
  } else {
    const msg = daily ? (S.daily[bangkokDate()] && S.daily[bangkokDate()].done ? '' : 'ยังไม่ได้เล่นวันนี้') : 'เล่นอีก ' + Math.max(0, 10 - S.unl.rounds) + ' ข้อเพื่อขึ้นอันดับ';
    right.append(Object.assign(document.createElement('b'), { textContent: '–' }), Object.assign(document.createElement('small'), { textContent: msg }));
  }
  me.append(left, right);
  const t = $('b-table'); t.innerHTML = '';
  const head = document.createElement('tr');
  (daily ? ['อันดับ', 'ผู้เล่น', 'คะแนนรวม', 'เวลา'] : ['อันดับ', 'ผู้เล่น', 'เฉลี่ย/ข้อ', 'จำนวนข้อ']).forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i > 1) th.className = 'r'; head.appendChild(th); });
  t.appendChild(head);
  rows.slice(0, 50).forEach((r, i) => {
    const tr = document.createElement('tr'); if (r.me) tr.className = 'me';
    const cells = daily ? [i + 1, r.name, fmt(r.score), (r.timeMs / 1000).toFixed(1) + ' วิ'] : [i + 1, r.name, fmt(r.avg), fmt(r.rounds)];
    cells.forEach((c, j) => { const td = document.createElement('td'); td.textContent = c; if (j > 1) td.className = 'r'; tr.appendChild(td); });
    t.appendChild(tr);
  });
  if (!rows.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 4; td.className = 'empty';
    td.textContent = daily ? 'ยังไม่มีผลของวันนี้ เล่นรายวันให้จบเพื่อขึ้นอันดับ' : 'ยังไม่มีผู้เล่นที่ครบ 10 ข้อ';
    tr.appendChild(td); t.appendChild(tr);
  }
  const src = $('b-src'); src.classList.toggle('shared', shared);
  src.querySelector('span').textContent = shared
    ? 'อันดับรวมผู้เล่นที่เปิดผ่านบัญชี Claude และมีสิทธิ์บันทึกผล'
    : 'แสดงผลในเครื่องนี้เท่านั้น · อันดับรวมทุกคนจะเปิดเมื่อย้ายการคิดคะแนนไปที่เซิร์ฟเวอร์';
  const doneToday = S.daily[bangkokDate()] && S.daily[bangkokDate()].done;
  $('b-cta').textContent = daily ? (doneToday ? 'กลับมาเล่นพรุ่งนี้ หรือเล่นไม่จำกัด' : 'เล่นรายวันของวันนี้') : 'เล่นไม่จำกัด';
}

/* ---------- home + credits ---------- */
function refreshHome() {
  const rec = S.daily[bangkokDate()];
  const n = QS.length ? dailySet(QS, CATS, bangkokDate()).length : 4;
  $('daily-badge').textContent = !rec ? 'วันนี้' : rec.done ? 'ดูผลวันนี้' : 'ทำต่อ ข้อ ' + Math.min(n, (rec.results.length + 1)) + '/' + n;
  const unverified = QS.filter(q => !q.verified_by).length;
  $('proto-note').textContent = !QS.length ? '' : unverified ? 'ต้นแบบเพื่อทดสอบ · มี ' + unverified + ' ข้อที่ยังรอทีมตรวจทาน' : 'ทุกข้อผ่านการตรวจของทีมแล้ว';
}
function goHome() { G = null; refreshHome(); show('s-home'); }
function renderCredits() {
  const box = $('cr-images'); box.innerHTML = '';
  const seen = new Set();
  QS.forEach(q => [q.cards[0], q.reveal.image].forEach(im => {
    if (!im || !im.src || seen.has(im.src)) return;
    seen.add(im.src);
    const it = document.createElement('div'); it.className = 'it';
    const img = new Image(); setImg(img, im.src); img.alt = '';
    const txt = document.createElement('div');
    const source = im.source || 'commons';
    if (im.source_url) { const a = document.createElement('a'); a.href = im.source_url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = im.file || q.topic; txt.appendChild(a); }
    else txt.appendChild(para(q.topic));
    const bits = source === 'player' ? [im.credit || 'ผู้เล่นออลไทย', 'ภาพจากผู้เล่น ใช้ตามที่เจ้าของภาพอนุญาต']
      : [im.credit, licTh(im.license || ''), source === 'commons' ? 'Wikimedia Commons' : '', im.modified || ''];
    txt.appendChild(para(bits.filter(Boolean).join(' · '), 'muted small'));
    it.append(img, txt); box.appendChild(it);
  }));
  const done = QS.filter(q => q.verified_by).length;
  $('cr-status').textContent = 'คำถามที่เผยแพร่ ' + QS.length + ' ข้อ ตรวจแล้ว ' + done + ' ข้อ ข้อที่ยังไม่ตรวจมีป้าย “รอทีมตรวจทาน” ในหน้าเฉลย ทุกข้อมีลิงก์ที่มาใต้หน้าเฉลย';
  $('cr-map').textContent = MAP.attribution.provinces + ' · ' + MAP.attribution.neighbors;
}

/* ---------- แชร์ประสบการณ์: player photo → review queue (never straight into the game) ---------- */
S.subs = S.subs || [];
let subBlob = null, subUrl = '', subSending = false;
const SUB_STATUS = { pending: 'รอตรวจ', approved: 'ผ่านการตรวจ', rejected: 'ไม่ผ่านการตรวจ' };
function fillSubmitForm() {
  const sel = $('sub-prov');
  if (sel.options.length < 2) {
    Object.values(PROV).sort((a, b) => a.name_th.localeCompare(b.name_th, 'th')).forEach(p => sel.add(new Option(p.name_th, p.id)));
  }
  if (!$('sub-credit').value && S.nick) $('sub-credit').value = S.nick;
  $('sub-demo').hidden = BE.MODE !== 'demo';
}
function openSubmit() { fillSubmitForm(); renderMySubs(); updateSubmitState(); show('s-submit'); }
function subMissing() {
  const miss = [];
  if (!subBlob) miss.push('ภาพ');
  if (!$('sub-prov').value) miss.push('จังหวัด');
  if (!$('sub-title').value.trim()) miss.push('ในภาพคืออะไร');
  if (!$('sub-credit').value.trim()) miss.push('ชื่อเครดิต');
  if (!['c-owner', 'c-license', 'c-people'].every(id => $(id).checked)) miss.push('ยืนยันให้ครบ 3 ข้อ');
  return miss;
}
function updateSubmitState() {
  const miss = subMissing();
  $('sub-send').disabled = subSending || miss.length > 0;
  $('sub-missing').textContent = miss.length ? 'ยังขาด: ' + miss.join(' · ') : '';
}
async function onPickFile() {
  const f = $('sub-file').files[0];
  const msg = $('sub-file-msg');
  subBlob = null;
  if (subUrl) { URL.revokeObjectURL(subUrl); subUrl = ''; }
  $('sub-preview').hidden = true; $('sub-change').hidden = true; $('sub-empty').hidden = false; msg.classList.remove('bad');
  updateSubmitState();
  if (!f) { msg.textContent = ''; return; }
  msg.textContent = 'กำลังเตรียมภาพ…';
  try {
    if (!/^image\//.test(f.type || 'image/')) throw new Error('ไฟล์นี้ไม่ใช่ภาพ');
    if (f.size > 25 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 25 MB');
    const out = await BE.compressImage(f, 1600, 0.85);
    subBlob = out.blob;
    subUrl = URL.createObjectURL(out.blob);
    $('sub-preview').src = subUrl; $('sub-preview').hidden = false; $('sub-change').hidden = false; $('sub-empty').hidden = true;
    msg.textContent = 'ย่อเหลือ ' + out.width + '×' + out.height + ' พิกเซล · ' + Math.round(out.blob.size / 1024) + ' KB · ลบข้อมูล GPS แล้ว';
  } catch (e) {
    msg.textContent = e.message || 'เปิดไฟล์ภาพนี้ไม่ได้'; msg.classList.add('bad');
  }
  updateSubmitState();
}
async function sendSubmission(ev) {
  ev.preventDefault();
  if (subSending || subMissing().length) return;
  subSending = true; updateSubmitState();
  const btn = $('sub-send'); btn.textContent = 'กำลังส่ง…';
  const meta = {
    province_id: $('sub-prov').value, category: $('sub-cat').value,
    title: $('sub-title').value.trim(), description: $('sub-desc').value.trim(), taken_at: $('sub-when').value.trim(),
    credit_name: $('sub-credit').value.trim(), contact: $('sub-contact').value.trim(),
    consent_owner: $('c-owner').checked, consent_license: $('c-license').checked, consent_people: $('c-people').checked
  };
  try {
    const r = await BE.submitPhoto(subBlob, meta);
    S.subs.unshift({ id: r.id, title: meta.title, province: meta.province_id, at: Date.now(), status: 'pending' });
    S.subs = S.subs.slice(0, 30); save();
    $('sub-form').reset(); $('sub-credit').value = S.nick || meta.credit_name;
    subBlob = null; if (subUrl) { URL.revokeObjectURL(subUrl); subUrl = ''; }
    $('sub-preview').hidden = true; $('sub-change').hidden = true; $('sub-empty').hidden = false; $('sub-file-msg').textContent = '';
    renderMySubs();
    await modal([Object.assign(document.createElement('h3'), { textContent: 'ส่งภาพแล้ว ขอบคุณมาก' }),
      para('ทีมงานจะตรวจภาพก่อนนำไปทำคำถาม ภาพจะยังไม่ขึ้นในเกมจนกว่าจะผ่านการตรวจ')], [{ label: 'ตกลง', value: 1 }]);
  } catch (e) {
    toast('ส่งไม่สำเร็จ ลองใหม่อีกครั้ง');
    $('sub-missing').textContent = 'ส่งไม่สำเร็จ: ' + (e.message || e);
  } finally {
    subSending = false; btn.textContent = 'ส่งให้ทีมตรวจ'; updateSubmitState();
  }
}
async function renderMySubs() {
  const box = $('my-subs-list');
  $('my-subs').hidden = !S.subs.length;
  if (!S.subs.length) return;
  let live = {};
  try { live = await BE.mySubmissionStatus(S.subs.map(x => x.id)); } catch (e) { live = {}; }
  box.innerHTML = '';
  S.subs.forEach(x => {
    if (live[x.id]) x.status = live[x.id];
    const d = document.createElement('div'); d.className = 'ln';
    const a = document.createElement('span'); a.textContent = x.title + ' · ' + ((PROV[x.province] || {}).name_th || '');
    const b = document.createElement('span'); b.className = 'st st-' + (x.status || 'pending');
    b.textContent = BE.MODE === 'demo' || x.status !== 'pending' ? SUB_STATUS[x.status || 'pending'] : 'ส่งแล้ว · รอตรวจ';
    d.append(a, b); box.appendChild(d);
  });
  save();
}

/* ---------- wiring ---------- */
function wire() {
  $('btn-daily').onclick = startDaily;
  $('btn-unl').onclick = startUnlimited;
  $('btn-board').onclick = () => openBoard('daily');
  $('btn-credits').onclick = () => { renderCredits(); show('s-credits'); };
  $('btn-submit').onclick = openSubmit;
  $('sub-back').onclick = goHome;
  $('sub-file').addEventListener('change', onPickFile);
  $('sub-form').addEventListener('input', updateSubmitState);
  $('sub-form').addEventListener('change', updateSubmitState);
  $('sub-form').addEventListener('submit', sendSubmission);
  $('cr-back').onclick = goHome;
  const nick = $('nick'); nick.value = S.nick;
  nick.addEventListener('input', () => {
    const c = cleanNickname(nick.value);
    if (c === null) { $('nick-msg').textContent = 'ชื่อนี้ใช้ไม่ได้ ลองชื่ออื่น'; return; }
    $('nick-msg').textContent = ''; S.nick = c; save();
  });
  $('q-back').onclick = async () => {
    const msg = G && G.mode === 'daily' ? 'ออกตอนนี้ได้ ข้อนี้จะนับเป็นหมดเวลา (0 คะแนน) เมื่อกลับมาเล่นต่อ' : 'ออกจากโหมดไม่จำกัด ผลที่ตอบไปแล้วยังนับอยู่';
    const ok = await modal([Object.assign(document.createElement('h3'), { textContent: 'กลับหน้าแรก?' }), para(msg)], [{ label: 'เล่นต่อ', value: false }, { label: 'กลับหน้าแรก', value: true, primary: true }]);
    if (!ok) return;
    if (G && G.mode === 'unl') pushUnlimited();
    goHome();
  };
  $('q-go').onclick = goAnswer;
  $('z-in').onclick = () => mapView.zoomIn();
  $('z-out').onclick = () => mapView.zoomOut();
  $('z-fit').onclick = () => mapView.reset();
  $('a-cards').onclick = openSheet;
  $('sheet-close').onclick = closeSheet;
  $('sheet-bg').addEventListener('click', e => { if (e.target === $('sheet-bg')) closeSheet(); });
  $('a-confirm').onclick = () => { if (G && G.sel) finishAnswer(false); };
  $('rv-next').onclick = () => {
    G.i++;
    if (G.mode === 'daily') { if (G.i >= G.list.length) { finishDaily(); return; } }
    else if (G.i >= G.list.length) { toast('เล่นครบทุกข้อในคลังแล้ว'); stopUnlimited(); return; }
    nextQuestion();
  };
  $('rv-stop').onclick = () => {
    if (G.mode === 'daily') {
      if (G.i + 1 >= G.list.length) { G.i++; finishDaily(); goHome(); return; }
      toast('บันทึกแล้ว กลับมาเล่นต่อได้ภายในวันนี้'); goHome(); return;
    }
    stopUnlimited();
  };
  $('share-copy').onclick = async () => {
    const t = $('share-text').textContent;
    try { await navigator.clipboard.writeText(t); toast('คัดลอกผลแล้ว'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('share-text')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('เลือกข้อความไว้แล้ว กดคัดลอกได้เลย'); }
    stat('share', 'copy');
  };
  $('share-line').addEventListener('click', () => stat('share', 'line'));
  $('share-fb').addEventListener('click', () => stat('share', 'facebook'));
  $('sum-board').onclick = () => openBoard('daily');
  $('sum-home').onclick = goHome;
  $('b-back').onclick = goHome;
  $('tab-daily').onclick = () => { boardTab = 'daily'; renderBoard(); };
  $('tab-unl').onclick = () => { boardTab = 'unl'; renderBoard(); };
  $('b-cta').onclick = () => {
    const doneToday = S.daily[bangkokDate()] && S.daily[bangkokDate()].done;
    if (boardTab === 'daily' && !doneToday) startDaily(); else startUnlimited();
  };
}

function setHomeReady() {
  const has = QS.length > 0;
  ['btn-daily', 'btn-unl'].forEach(id => { $(id).disabled = !has; });
  const m = $('home-msg');
  m.hidden = has;
  m.textContent = has ? '' : 'ยังไม่มีคำถามที่เผยแพร่ ทีมงานกำลังตรวจข้อมูลอยู่ ระหว่างนี้ส่งภาพของดีจากจังหวัดคุณได้';
  refreshHome();
}
let started = false;
async function start(snapshot) {
  if (started) return;
  started = true;
  wire();
  refreshHome();
  ['btn-daily', 'btn-unl', 'btn-submit'].forEach(id => { $(id).disabled = true; });
  try {
    await loadData();
  } catch (e) {
    toast('โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้า');
    const m = $('home-msg'); m.hidden = false; m.textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + (e.message || e);
    return;
  }
  $('btn-submit').disabled = false;
  setHomeReady();
  mapView = createMapView($('map-panel'), MAP);
  mapView.onSelect(id => { if (G) G.sel = id; setChoice(id); });
  drawGhostMap();
  if (snapshot && snapshot.screen === 's-board') openBoard(snapshot.tab);
  if (snapshot && snapshot.screen === 's-credits') { renderCredits(); show('s-credits'); }
  if (snapshot && snapshot.screen === 's-submit') openSubmit();
  initDB();
}
// Re-read published content (used when the admin site in the same page changes data).
async function refresh() {
  if (!MAP || G) return;
  try { applyContent(await BE.loadContent()); } catch (e) { return; }
  setHomeReady();
  if (current === 's-credits') renderCredits();
  if (current === 's-submit') renderMySubs();
}
window.AllThaiPlay = { refresh };

const hot = window.claude && window.claude.hot;
if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ screen: current, tab: boardTab }));
if (hot && typeof hot.ready === 'function') hot.ready(start); else start((hot && hot.data) || {});
})();
