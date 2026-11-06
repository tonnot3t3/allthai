/* เว็บใส่ข้อมูล — review player photos, write and publish questions, edit province profiles.
 * Talks only to AllThaiBackend (Supabase, or this browser in demo mode). Every value from the database is
 * written with textContent, never as HTML. */
const AllThaiAdmin = (() => {
'use strict';
const BE = window.AllThaiBackend;
const CFG = window.ALLTHAI_CONFIG || {};
const CATS = ['สถานที่ท่องเที่ยว'];   // V2: one category, answers are districts
const CAT_KEY = { 'อาหาร': 'food', 'กีฬา': 'sport', 'เทศกาลและวัฒนธรรม': 'culture', 'สถานที่ท่องเที่ยว': 'travel' };
const FACT_KEYS = {
  'อาหาร': ['ชื่อ', 'จังหวัดและพื้นที่ต้นกำเนิด', 'วัตถุดิบหลัก', 'เกร็ดน่ารู้'],
  'กีฬา': ['ชื่อ', 'สถานที่จัด', 'ช่วงเวลาที่จัด', 'กติกาโดยย่อ', 'ความเป็นมา'],
  'เทศกาลและวัฒนธรรม': ['ชื่อ', 'สถานที่จัด', 'ช่วงเวลาที่จัด', 'ความเป็นมาและความเชื่อ'],
  'สถานที่ท่องเที่ยว': ['ชื่อ', 'ที่ตั้ง', 'จุดเด่น', 'ช่วงที่เหมาะไป', 'ความเป็นมา']
};
const TAGS = [['', 'ไม่ระบุ'], ['region', 'ภาค'], ['terrain', 'ภูมิประเทศ'], ['district', 'อำเภอ'], ['dialect', 'ภาษาถิ่น'], ['religion_culture', 'ศาสนา/วัฒนธรรม'], ['main_occupation', 'อาชีพหลัก']];
const LICENSE_URL = {
  'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'Public domain': '',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/', 'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY 2.5': 'https://creativecommons.org/licenses/by/2.5/', 'CC BY-SA 2.5': 'https://creativecommons.org/licenses/by-sa/2.5/',
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/'
};
const LICENSE_TH = { [BE.LICENSE_ID]: 'ผู้เล่นอนุญาตให้ออลไทยใช้ (ไม่ผูกขาด)' };
const SOURCES = [['commons', 'Wikimedia Commons'], ['player', 'ภาพจากผู้เล่น'], ['other', 'แหล่งอื่น / ทีมถ่ายเอง']];
const STATUS_TH = { draft: 'ร่าง', published: 'เผยแพร่', archived: 'เก็บเข้าคลัง' };
const SUB_TH = { pending: 'รอตรวจ', approved: 'ผ่าน', rejected: 'ไม่ผ่าน' };
const DAILY_N = DAILY_COUNT;                       // from scoring.js
const TARGET_WEEK = DAILY_N * 7, TARGET_MONTH = DAILY_N * 30;

/* ---------------- tiny DOM helpers ---------------- */
const $ = id => document.getElementById(id);
const PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, hidden: 1, required: 1, htmlFor: 1, min: 1, max: 1, step: 1 };
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else if (PROPS[k]) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(9).forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : String(c)); });
  return e;
}
function sel(opts, value, onchange, cls) {
  const s = h('select', { class: 'ad-in' + (cls ? ' ' + cls : ''), onchange: e => onchange(e.target.value, e) });
  opts.forEach(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; s.add(new Option(t, v)); });
  const val = value == null ? '' : String(value);
  if (val && ![...s.options].some(o => o.value === val)) s.add(new Option(val, val));
  s.value = val;
  return s;
}
const inp = (value, oninput, attrs) => h('input', Object.assign({ class: 'ad-in', type: 'text', value: value == null ? '' : value, oninput: e => oninput(e.target.value, e) }, attrs || {}));
const area = (value, oninput, attrs) => h('textarea', Object.assign({ class: 'ad-in', value: value == null ? '' : value, oninput: e => oninput(e.target.value, e) }, attrs || {}));
let fieldSeq = 0;
function field(label, control, help) {
  const target = control && (/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? control : control.querySelector && control.querySelector('input, select, textarea'));
  const lab = h('label', { text: label });
  if (target) { if (!target.id) target.id = 'ad-f' + (++fieldSeq); lab.htmlFor = target.id; }
  return h('div', { class: 'ad-field' }, lab, control, help ? h('span', { class: 'ad-help', text: help }) : null);
}
const btn = (label, onclick, cls, attrs) => h('button', Object.assign({ type: 'button', class: 'ad-btn' + (cls ? ' ' + cls : ''), onclick }, attrs || {}), label);
const chip = (text, cls) => h('span', { class: 'ad-chip' + (cls ? ' ' + cls : ''), text });
const clone = o => JSON.parse(JSON.stringify(o));
const thTime = iso => iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
const thDay = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 5)).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' }); };
function addDays(ds, n) { const [y, m, d] = ds.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
function setImg(img, src) {
  if (src && src.indexOf('idb:') === 0) BE.imageUrl(src).then(u => { if (u) img.src = u; });
  else if (src) img.src = src;
}
const licLabel = l => LICENSE_TH[l] || (l === 'Public domain' ? 'สาธารณสมบัติ' : l || '–');
function licenseProblem(lic) {
  if (!lic || !String(lic).trim()) return 'ยังไม่ใส่สัญญาอนุญาต';
  if (/\b(NC|ND)\b|non-?commercial|no-?deriv/i.test(lic)) return 'ใช้ไม่ได้: ห้ามภาพเงื่อนไข NC หรือ ND';
  return '';
}
const licenseKnown = lic => lic === BE.LICENSE_ID || Object.prototype.hasOwnProperty.call(LICENSE_URL, lic);

let toastT;
function toast(msg) { const t = $('ad-toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
function dialog(title, body, buttons, wide) {
  return new Promise(resolve => {
    const d = $('ad-dialog'), bg = $('ad-dialog-bg');
    d.className = 'ad-dialog' + (wide ? ' wide' : '');
    d.innerHTML = '';
    const close = v => { bg.classList.remove('on'); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(undefined); };
    d.append(h('h3', { id: 'ad-dialog-title', text: title }));
    [].concat(body || []).forEach(n => n && d.append(n.nodeType ? n : h('p', { text: n })));
    const row = h('div', { class: 'btns' });
    (buttons || [{ label: 'ปิด', value: undefined }]).forEach(b => row.append(btn(b.label, () => close(typeof b.value === 'function' ? b.value() : b.value), b.cls)));
    d.append(row);
    d._close = close;
    bg.classList.add('on');
    document.addEventListener('keydown', onKey);
    const first = d.querySelector('textarea, input, select') || row.lastChild;
    if (first) first.focus();
  });
}
const confirmBox = (title, text, okLabel, cls) => dialog(title, [text], [{ label: 'ยกเลิก', value: false }, { label: okLabel || 'ตกลง', value: true, cls: cls || 'primary' }]);
async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); dialog('ทำไม่สำเร็จ', [String(e && e.message || e)]); return undefined; }
}

/* ---------------- state ---------------- */
const A = { mounted: false, session: null, view: 'subs', subs: [], subFilter: 'pending', questions: [], provinces: [], prov: {}, meta: null,
  qf: { text: '', cat: '', status: '', unverified: false }, E: null, dirty: false, districts: [], dist: {} };
const provName = id => (A.prov[id] || {}).name_th || id || '–';
const distName = d => (d.p === 'bangkok' ? 'เขต' : 'อ.') + d.n;
const placeName = id => { const d = A.dist[id]; return d ? distName(d) + ' ' + (d.p === 'bangkok' ? 'กรุงเทพฯ' : 'จ.' + provName(d.p)) : (id ? id + ' (ไม่พบในแผนที่)' : '–'); };
const distOptions = p => [['', p ? 'เลือกอำเภอ/เขต' : 'เลือกจังหวัดก่อน']].concat(A.districts.filter(d => d.p === p).sort((a, b) => a.n.localeCompare(b.n, 'th')).map(d => [d.id, distName(d)]));
const provOptions = () => [['', 'เลือกจังหวัด']].concat(A.provinces.slice().sort((a, b) => a.name_th.localeCompare(b.name_th, 'th')).map(p => [p.id, p.name_th]));
const reviewerName = () => A.session && !A.session.demo ? A.session.email : 'ทีมงาน (โหมดสาธิต)';

let distP = null;
const loadDistricts = () => distP || (distP = fetch((BE.CFG.dataBase || 'data/') + 'districts.json').then(r => { if (!r.ok) throw new Error('districts.json ' + r.status); return r.json(); }));
async function loadAll() {
  const [subs, qs, ps, sd, ds] = await Promise.all([BE.listSubmissions(), BE.listQuestions(), BE.listProvinces(), BE.seedProvinces(), loadDistricts()]);
  A.subs = subs; A.questions = qs; A.provinces = ps; A.meta = sd.provinceMeta;
  A.prov = {}; ps.forEach(p => { A.prov[p.id] = p; });
  A.districts = ds.districts; A.dist = {}; ds.districts.forEach(d => { A.dist[d.id] = d; });
  updateCount();
}
function updateCount() {
  const n = A.subs.filter(s => s.status === 'pending').length;
  const c = $('ad-sub-count'); c.hidden = !n; c.textContent = n;
}

/* ---------------- shell ---------------- */
function setView(v) {
  if (A.view === 'editor' && A.dirty && v !== 'editor') {
    return confirmBox('ทิ้งการแก้ไข?', 'คำถามนี้ยังไม่ได้บันทึก', 'ทิ้งการแก้ไข', 'danger').then(ok => { if (ok) { A.dirty = false; setView(v); } });
  }
  A.view = v;
  document.querySelectorAll('#ad-tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v || (v === 'editor' && b.dataset.view === 'questions')));
  const main = $('ad-main'); main.innerHTML = '';
  ({ subs: viewSubs, questions: viewQuestions, editor: viewEditor, system: viewSystem })[v](main);
  $('admin-app').scrollTop = 0;
}
function shell() {
  const live = BE.MODE === 'supabase';
  const m = $('ad-mode'); m.textContent = live ? 'เชื่อมฐานข้อมูลจริง (Supabase)' : 'โหมดสาธิต · ข้อมูลอยู่ในเบราว์เซอร์นี้'; m.classList.toggle('live', live);
  $('ad-play').href = CFG.playUrl || '../play/';
  document.querySelectorAll('#ad-tabs button').forEach(b => { b.onclick = () => setView(b.dataset.view); });
  $('ad-signout').onclick = async () => { if (A.dirty && !await confirmBox('ทิ้งการแก้ไข?', 'คำถามที่เปิดอยู่ยังไม่ได้บันทึก', 'ทิ้งและออก', 'danger')) return; A.dirty = false; await BE.signOut(); A.session = null; $('ad-tabs').hidden = true; $('ad-signout').hidden = true; $('ad-email').textContent = ''; viewLogin(); };
  window.addEventListener('beforeunload', e => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });
}
function viewLogin(msg) {
  const main = $('ad-main'); main.innerHTML = '';
  const email = inp('', () => {}, { type: 'email', autocomplete: 'username', required: true });
  const pass = inp('', () => {}, { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'ad-err', text: msg || '' });
  const form = h('form', { class: 'ad-card ad-login', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { A.session = await BE.signIn(email.value.trim(), pass.value); await afterSession(); }
    catch (x) { err.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + (x.message || x); }
  } }, h('h2', { text: 'เข้าสู่ระบบทีมงาน' }), h('p', { class: 'ad-muted', text: 'ใช้บัญชีที่สร้างใน Supabase และมีอีเมลอยู่ในตาราง admins' }),
    field('อีเมล', email), field('รหัสผ่าน', pass), err, h('button', { type: 'submit', class: 'ad-btn primary' }, 'เข้าสู่ระบบ'));
  main.append(form);
}
async function afterSession() {
  const s = A.session;
  if (!s) return viewLogin();
  $('ad-email').textContent = s.demo ? '' : s.email;
  $('ad-signout').hidden = !!s.demo;
  if (!s.admin) {
    const main = $('ad-main'); main.innerHTML = '';
    main.append(h('div', { class: 'ad-card ad-login' }, h('h2', { text: 'บัญชีนี้ยังไม่มีสิทธิ์ทีมงาน' }),
      h('p', { text: 'เพิ่มอีเมล ' + s.email + ' ในตาราง admins ของ Supabase (ดู README ขั้นที่ 3) แล้วเข้าสู่ระบบใหม่' })));
    return;
  }
  $('ad-tabs').hidden = false;
  await loadAll();
  setView(A.view === 'editor' ? 'questions' : A.view);
}

/* ---------------- 1. ภาพจากผู้เล่น ---------------- */
function viewSubs(main) {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  A.subs.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1; });
  const seg = h('div', { class: 'ad-seg', role: 'tablist' });
  [['pending', 'รอตรวจ'], ['approved', 'ผ่าน'], ['rejected', 'ไม่ผ่าน'], ['all', 'ทั้งหมด']].forEach(([k, t]) => {
    seg.append(h('button', { type: 'button', role: 'tab', class: A.subFilter === k ? 'on' : '', onclick: () => { A.subFilter = k; setView('subs'); } },
      t + ' ' + (k === 'all' ? A.subs.length : counts[k] || 0)));
  });
  main.append(h('div', { class: 'ad-head' },
    h('div', {}, h('h2', { text: 'ภาพจากผู้เล่น' }), h('p', { text: 'ภาพที่ส่งจากเว็บเล่นเกมจะรออยู่ที่นี่ ไม่มีภาพไหนขึ้นในเกมจนกว่าจะกดผ่านแล้วนำไปใช้ในคำถามที่เผยแพร่' })),
    h('div', { class: 'ad-bar' }, seg, btn('โหลดใหม่', () => guard(async () => { await loadAll(); setView('subs'); }), 'sm'))));
  main.append(h('div', { class: 'ad-note' }, h('b', { text: 'เช็กก่อนกดผ่าน' }), h('ol', {},
    h('li', { text: 'ภาพตรงกับจังหวัดและสิ่งที่ผู้ส่งบอก' }),
    h('li', { text: 'ดูเหมือนถ่ายเอง ไม่ใช่ภาพจากเว็บ โฆษณา หรือภาพที่สร้างด้วย AI (ลองค้นภาพย้อนกลับ)' }),
    h('li', { text: 'ไม่มีใบหน้าคนที่จำได้ชัด ป้ายทะเบียนรถ บ้านเลขที่ หรือข้อมูลส่วนตัวอื่น' }),
    h('li', { text: 'คมชัดพอใช้เป็นการ์ดคำถาม และไม่มีข้อความที่เฉลยคำตอบในภาพ' }))));
  const list = A.subs.filter(s => A.subFilter === 'all' || s.status === A.subFilter);
  if (!list.length) { main.append(h('div', { class: 'ad-card ad-empty', text: A.subFilter === 'pending' ? 'ไม่มีภาพรอตรวจ' : 'ไม่มีรายการ' })); return; }
  const grid = h('div', { class: 'ad-subs' });
  list.forEach(s => grid.append(subCard(s)));
  main.append(grid);
}
function usedIn(sub) {
  return A.questions.filter(q => [q.cards && q.cards[0], q.reveal && q.reveal.image].some(im => im && (im.submission_id === sub.id || (sub.public_url && im.src === sub.public_url))));
}
function subCard(s) {
  const img = h('img', { alt: s.title || 'ภาพจากผู้เล่น', loading: 'lazy' });
  if (s.imageUrl) img.src = s.imageUrl;
  const ph = h('button', { type: 'button', class: 'ph', 'aria-label': 'ขยายภาพ', onclick: () => dialog(s.title || 'ภาพ', [h('img', { class: 'big', src: s.imageUrl || '', alt: '' })], null, true) },
    s.imageUrl ? img : h('span', { class: 'ad-noimg', text: 'ไม่พบไฟล์ภาพ' }), chip(SUB_TH[s.status] || s.status, s.status));
  const kv = (k, v) => v ? h('div', { class: 'ad-kv' }, k + ': ', h('b', { text: v })) : null;
  const used = usedIn(s);
  const bd = h('div', { class: 'bd' },
    h('h3', { text: s.title || '(ไม่มีชื่อ)' }),
    h('div', { class: 'ad-kv' }, h('b', { text: s.district_id && A.dist[s.district_id] ? placeName(s.district_id) : 'จ.' + provName(s.province_id) + ' · ไม่ระบุอำเภอ' })),
    s.description ? h('p', { class: 'ad-desc', text: s.description }) : null,
    kv('ถ่ายเมื่อ', s.taken_at), kv('เครดิต', s.credit_name), kv('ติดต่อ', s.contact),
    kv('ส่งเมื่อ', thTime(s.created_at)),
    h('div', { class: 'ad-kv' }, 'ยืนยัน: ' + [s.consent_owner && 'ถ่ายเอง', s.consent_license && 'อนุญาตใช้', s.consent_people && 'เรื่องคนในภาพ'].filter(Boolean).join(' · ')),
    s.review_note ? kv('หมายเหตุการตรวจ', s.review_note) : null,
    s.reviewed_at ? kv('ตรวจเมื่อ', thTime(s.reviewed_at) + (s.reviewed_by ? ' โดย ' + s.reviewed_by : '')) : null,
    used.length ? kv('ใช้ในคำถาม', used.map(q => q.id).join(', ')) : null);
  const acts = h('div', { class: 'ad-actions' });
  if (s.status !== 'approved') acts.append(btn('ผ่าน', () => review(s, 'approved'), 'ok sm'));
  if (s.status !== 'rejected') acts.append(btn('ไม่ผ่าน', () => review(s, 'rejected'), 'sm'));
  if (s.status === 'approved') acts.append(btn('สร้างคำถามจากภาพนี้', () => newFromSubmission(s), 'primary sm'));
  if (BE.MODE === 'supabase' && s.imageUrl) acts.append(h('a', { class: 'ad-btn sm', href: 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(s.imageUrl), target: '_blank', rel: 'noopener noreferrer' }, 'ค้นภาพย้อนกลับ'));
  acts.append(btn('ลบ', () => removeSub(s, used), 'danger sm'));
  return h('article', { class: 'ad-card ad-sub' }, ph, bd, acts);
}
async function review(s, status) {
  const note = area(s.review_note || '', () => {}, { rows: 3, placeholder: status === 'approved' ? 'ไม่บังคับ' : 'เหตุผล เช่น ภาพไม่ตรงอำเภอ / มีใบหน้าคน' });
  const text = status === 'approved'
    ? 'ภาพจะถูกคัดลอกไปที่คลังภาพที่ใช้ทำคำถามได้ แต่ยังไม่ขึ้นในเกมจนกว่าจะใช้ในคำถามที่เผยแพร่'
    : 'ภาพจะไม่ถูกใช้ ผู้ดูแลเปลี่ยนใจภายหลังได้';
  const ok = await dialog(status === 'approved' ? 'ผ่านการตรวจ: ' + (s.title || '') : 'ไม่ผ่าน: ' + (s.title || ''), [text, field('หมายเหตุการตรวจ', note)],
    [{ label: 'ยกเลิก', value: false }, { label: status === 'approved' ? 'ยืนยันว่าผ่าน' : 'ยืนยันว่าไม่ผ่าน', value: true, cls: status === 'approved' ? 'primary' : 'danger' }]);
  if (!ok) return;
  await guard(async () => { await BE.reviewSubmission(s.id, status, note.value.trim(), reviewerName()); await loadAll(); setView('subs'); }, status === 'approved' ? 'ผ่านแล้ว' : 'บันทึกว่าไม่ผ่านแล้ว');
}
async function removeSub(s, used) {
  const warn = used.length ? 'ภาพนี้ใช้อยู่ในคำถาม ' + used.map(q => q.id).join(', ') + ' (ไฟล์ในคลังภาพคำถามยังอยู่ แต่ข้อมูลผู้ส่งจะหายไป) ' : '';
  if (!await confirmBox('ลบภาพนี้ถาวร?', warn + 'ลบทั้งไฟล์ภาพที่ส่งมาและข้อมูลผู้ส่ง ย้อนกลับไม่ได้', 'ลบถาวร', 'danger')) return;
  await guard(async () => { await BE.deleteSubmission(s); await loadAll(); setView('subs'); }, 'ลบแล้ว');
}

/* ---------------- 2. คำถาม ---------------- */
function publishedQs() { return A.questions.filter(q => q.status === 'published'); }
function viewQuestions(main) {
  const pub = publishedQs();
  const today = bangkokDate();
  const todays = new Set(pub.length ? dailySet(pub, today, DAILY_N).map(q => q.id) : []);
  main.append(h('div', { class: 'ad-head' },
    h('div', {}, h('h2', { text: 'คำถาม' }), h('p', { text: 'เกมใช้เฉพาะคำถามสถานะ “เผยแพร่” ซึ่งต้องผ่านการตรวจก่อน ข้อที่เผยแพร่วันนี้จะเริ่มเข้ารอบรายวันพรุ่งนี้' })),
    h('div', { class: 'ad-bar' }, btn('+ คำถามใหม่', () => openEditor(newQuestion(CATS[0]), true), 'primary sm'))));
  // coverage: one category, DAILY_N questions a day
  const all = A.questions.filter(q => q.category === CATS[0]);
  const p = all.filter(q => q.status === 'published').length, v = all.filter(q => q.verified_by).length;
  const meter = h('div', { class: 'ad-meter', title: 'เป้า ' + TARGET_WEEK + ' ข้อ (1 สัปดาห์) และ ' + TARGET_MONTH + ' ข้อ (1 เดือน)' },
    h('i', { style: 'width:' + Math.min(100, p / TARGET_MONTH * 100).toFixed(1) + '%' }), h('s', { style: 'left:' + (TARGET_WEEK / TARGET_MONTH * 100).toFixed(1) + '%' }));
  const days = Math.floor(p / DAILY_N);
  main.append(h('div', { class: 'ad-cov one' }, h('div', { class: 'ad-card' },
    h('span', { class: 'ad-muted ad-small', text: CATS[0] + ' · รายวันวันละ ' + DAILY_N + ' ข้อ' }), h('b', { text: String(p) }),
    h('span', { class: 'ad-small ad-muted', text: 'เผยแพร่ · ทั้งหมด ' + all.length + ' · ตรวจแล้ว ' + v }), meter,
    h('span', { class: 'ad-help', text: (p < DAILY_N ? 'ยังไม่ถึง ' + DAILY_N + ' ข้อ โหมดรายวันจะมี ' + p + ' ข้อ' : 'วนรายวันได้ ' + days + ' วันก่อนเริ่มซ้ำ') +
      ' · เป้า ' + TARGET_WEEK + ' ข้อ = 1 สัปดาห์ · ' + TARGET_MONTH + ' ข้อ = 1 เดือน' }))));
  // next 7 days
  if (pub.length) {
    const t = h('table', { class: 'ad-table ad-days' }, h('tr', {}, h('th', { text: 'วัน' }), h('th', { text: 'ชุดรายวัน' })));
    for (let i = 0; i < 7; i++) {
      const ds = addDays(today, i);
      const set = dailySet(pub, ds, DAILY_N);
      t.append(h('tr', {}, h('td', { text: (i === 0 ? 'วันนี้ · ' : '') + thDay(ds) }), h('td', { text: set.map(q => q.topic + (q.schedule_date === ds ? ' 📌' : '')).join(' · ') || '–' })));
    }
    main.append(h('details', { class: 'ad-card' }, h('summary', { text: 'ชุดรายวัน 7 วันข้างหน้า (จากคำถามที่เผยแพร่ตอนนี้)' }), h('div', { class: 'ad-scroll' }, t),
      h('p', { class: 'ad-help', text: '📌 = ล็อกวันที่ไว้ในช่อง “วันที่กำหนด” · ข้อที่เพิ่งเผยแพร่วันนี้จะเริ่มโผล่ตั้งแต่พรุ่งนี้' })));
  }
  // filters + table
  const f = A.qf;
  const table = h('table', { class: 'ad-table' });
  const draw = () => {
    table.innerHTML = '';
    table.append(h('tr', {}, ...['รหัส', 'หมวด', 'หัวข้อ', 'คำตอบ', 'สถานะ', 'ตรวจ', 'แก้ล่าสุด'].map(x => h('th', { text: x }))));
    const txt = f.text.trim().toLowerCase();
    const rows = A.questions.filter(q => (!f.cat || q.category === f.cat) && (!f.status || q.status === f.status) && (!f.unverified || !q.verified_by)
      && (!txt || [q.id, q.topic, placeName(q.answer)].join(' ').toLowerCase().includes(txt)));
    rows.forEach(q => {
      const st = q.status === 'published' && !q.verified_by ? chip('เผยแพร่ · ยังไม่ตรวจ', 'warn') : chip(STATUS_TH[q.status] || q.status, q.status === 'published' ? 'pub' : '');
      table.append(h('tr', { class: 'click', tabindex: 0, onclick: () => openEditor(clone(q), false), onkeydown: e => { if (e.key === 'Enter') openEditor(clone(q), false); } },
        h('td', {}, h('code', { text: q.id })), h('td', { text: q.category }), h('td', {}, q.topic || '(ยังไม่ตั้งหัวข้อ)', todays.has(q.id) ? [' ', chip('วันนี้', 'today')] : null),
        h('td', { text: placeName(q.answer) }), h('td', {}, st), h('td', { text: q.verified_by ? '✓' : '–', title: q.verified_by ? q.verified_by + ' · ' + thTime(q.verified_at) : '' }),
        h('td', { class: 'ad-small ad-muted', text: thTime(q.updated_at) })));
    });
    if (!rows.length) table.append(h('tr', {}, h('td', { colspan: 7, class: 'ad-empty', text: 'ไม่มีคำถามตามตัวกรองนี้' })));
  };
  main.append(h('div', { class: 'ad-card ad-stack' },
    h('div', { class: 'ad-bar' },
      h('div', { class: 'grow' }, inp(f.text, v => { f.text = v; draw(); }, { placeholder: 'ค้นหา รหัส หัวข้อ อำเภอ หรือจังหวัด', 'aria-label': 'ค้นหาคำถาม' })),
      sel([['', 'ทุกสถานะ'], ['draft', 'ร่าง'], ['published', 'เผยแพร่'], ['archived', 'เก็บเข้าคลัง']], f.status, v => { f.status = v; draw(); }),
      h('label', { class: 'ad-check' }, h('input', { type: 'checkbox', checked: f.unverified, onchange: e => { f.unverified = e.target.checked; draw(); } }), 'เฉพาะที่ยังไม่ตรวจ')),
    h('div', { class: 'ad-scroll' }, table)));
  draw();
}
function nextId(cat) {
  const key = CAT_KEY[cat] || 'misc';
  const re = new RegExp('^q-' + key + '-(\\d+)$');
  const max = A.questions.reduce((m, q) => { const x = re.exec(q.id); return x ? Math.max(m, +x[1]) : m; }, 0);
  return 'q-' + key + '-' + String(max + 1).padStart(4, '0');
}
const blankImage = () => ({ src: '', source: 'commons', credit: '', license: '', license_url: '', source_url: '', focus: '50% 50%' });
function newQuestion(cat) {
  return {
    id: nextId(cat), category: cat, topic: '', answer: '',
    cards: [Object.assign({ type: 'image', role: 'main', tag_hint: null }, blankImage()),
      { type: 'text', role: 'hint', text: '', tag_hint: 'region' }, { type: 'text', role: 'hint', text: '', tag_hint: 'terrain' }, { type: 'text', role: 'hint', text: '', tag_hint: 'district' }],
    reveal: { image: Object.assign(blankImage(), { file: '', modified: '', note: '' }), facts: Object.fromEntries((FACT_KEYS[cat] || ['ชื่อ']).map(k => [k, ''])), reasoning: '', sources: [] },
    schedule_date: null, verified_by: null, verified_at: null, note: '', status: 'draft', published_at: null
  };
}
function playerImage(s) {
  return { src: s.public_url, source: 'player', credit: s.credit_name || 'ผู้เล่นออลไทย', license: BE.LICENSE_ID, license_url: '', source_url: '', submission_id: s.id, focus: '50% 50%' };
}
function newFromSubmission(s) {
  if (!s.public_url) { toast('ภาพนี้ยังไม่ได้คัดลอกไปคลังภาพ ลองกดผ่านอีกครั้ง'); return; }
  const q = newQuestion(CATS[0]);
  q.topic = s.title || ''; q.answer = s.district_id && A.dist[s.district_id] ? s.district_id : '';
  q._prov = s.province_id || '';
  Object.assign(q.cards[0], playerImage(s));
  Object.assign(q.reveal.image, playerImage(s), { modified: 'ย่อขนาดอัตโนมัติตอนส่ง' });
  if (q.reveal.facts['ชื่อ'] !== undefined) q.reveal.facts['ชื่อ'] = s.title || '';
  openEditor(q, true);
}

/* ---------------- editor ---------------- */
function openEditor(q, isNew) {
  q.cards = q.cards || [];
  while (q.cards.length < 4) q.cards.push(q.cards.length ? { type: 'text', role: 'hint', text: '', tag_hint: null } : Object.assign({ type: 'image', role: 'main', tag_hint: null }, blankImage()));
  q.reveal = q.reveal || { image: blankImage(), facts: {}, reasoning: '', sources: [] };
  q.reveal.image = q.reveal.image || blankImage();
  A.E = {
    q, isNew,
    sameImage: !q.reveal.image.src || q.reveal.image.src === q.cards[0].src,
    prov: (A.dist[q.answer] || {}).p || q._prov || '',
    facts: Object.entries(q.reveal.facts || {}),
    sources: (q.reveal.sources || []).map(s => Object.assign({}, s)),
    stale: false
  };
  A.dirty = !!isNew;
  setView('editor');
}
// Any change to what players see (or to the facts) cancels an earlier "checked" mark: verification is for the current content.
function touch(content) {
  A.dirty = true;
  const q = A.E.q;
  if (content && q.verified_by) { q.verified_by = null; q.verified_at = null; A.E.stale = true; }
  renderAside();
}
function buildQuestion() {
  const E = A.E, q = clone(E.q);
  delete q.similar; delete q.similar_reasons; delete q._prov;
  q.reveal.facts = {};
  E.facts.forEach(([k, v]) => { if (String(k).trim()) q.reveal.facts[String(k).trim()] = String(v || '').trim(); });
  q.reveal.sources = E.sources.filter(s => (s.url || '').trim() || (s.title || '').trim()).map(s => ({ title: (s.title || '').trim() || s.url.trim(), url: (s.url || '').trim() }));
  if (E.sameImage) {
    const keep = { file: q.reveal.image.file || '', modified: q.reveal.image.modified || '', note: q.reveal.image.note || '' };
    q.reveal.image = Object.assign({}, q.cards[0], keep);
    delete q.reveal.image.type; delete q.reveal.image.role; delete q.reveal.image.tag_hint;
  }
  q.cards.forEach((c, i) => { if (i > 0) { c.text = String(c.text || '').trim(); c.tag_hint = c.tag_hint || null; } else c.tag_hint = null; });
  q.topic = String(q.topic || '').trim();
  q.schedule_date = q.schedule_date || null;
  delete q.updated_at;
  return q;
}
function requirements(q) {
  const c0 = q.cards[0] || {}, ri = q.reveal.image || {};
  const imgOk = im => !!(im.src && String(im.credit || '').trim() && !licenseProblem(im.license));
  return [
    ['ตั้งหัวข้อ', !!q.topic],
    ['เลือกอำเภอ/เขตคำตอบ', !!A.dist[q.answer]],
    ['ภาพหลักมีเครดิตและสัญญาอนุญาตที่ใช้ได้', imgOk(c0)],
    ['ภาพเฉลยมีเครดิตและสัญญาอนุญาตที่ใช้ได้', imgOk(ri)],
    ['เบาะแสข้อความครบ 3 การ์ด', q.cards.slice(1, 4).every(c => c.text)],
    ['ข้อมูลเฉลยอย่างน้อย 1 หัวข้อ', Object.values(q.reveal.facts).some(v => v)],
    ['วิธีคิด', !!String(q.reveal.reasoning || '').trim()],
    ['แหล่งที่มาที่มีลิงก์อย่างน้อย 1', q.reveal.sources.some(s => /^https?:\/\//.test(s.url))],
    ['ผ่านการตรวจแล้ว', !!q.verified_by]
  ];
}
function viewEditor(main) {
  const E = A.E, q = E.q;
  const head = h('div', { class: 'ad-head' },
    h('div', {}, h('button', { type: 'button', class: 'ad-link', onclick: () => setView('questions') }, '← รายการคำถาม'),
      h('h2', { text: (E.isNew ? 'คำถามใหม่ ' : 'แก้ไข ') + q.id })),
    h('div', { class: 'ad-bar' }, btn('คัดลอก JSON', () => copyJSON(buildQuestion()), 'sm'),
      E.isNew ? null : btn('ลบคำถาม', () => removeQuestion(q), 'danger sm')));
  const col = h('div', { class: 'ad-ed-main' });
  col.append(secBasics(), secMainImage(), secHints(), secReveal());
  const aside = h('aside', { class: 'ad-aside', id: 'ad-aside' });
  main.append(head, h('div', { class: 'ad-ed' }, col, aside));
  renderAside();
}
function secBasics() {
  const q = A.E.q, E = A.E;
  const prof = h('div', { class: 'ad-profile' });
  const drawProf = () => {
    const d = A.dist[q.answer];
    prof.textContent = d ? 'คำตอบ: ' + placeName(q.answer) + ' · จุดวัดระยะ ' + d.ll[0].toFixed(3) + ', ' + d.ll[1].toFixed(3) + ' (ผู้เล่นได้คะแนนตามระยะจากอำเภอที่ตอบถึงจุดนี้)' : 'เลือกจังหวัดแล้วเลือกอำเภอ/เขตที่สถานที่ตั้งอยู่';
  };
  drawProf();
  const pickDist = v => { q.answer = v; drawProf(); touch(true); };
  let distSel = sel(distOptions(E.prov), q.answer, pickDist);
  const provSel = sel(provOptions(), E.prov, v => {
    E.prov = v; q.answer = '';
    const fresh = sel(distOptions(v), '', pickDist);
    distSel.replaceWith(fresh); distSel = fresh; drawProf(); touch(true);
  });
  const ref = q.cards[0].submission_id ? A.subs.find(s => s.id === q.cards[0].submission_id) : null;
  return h('section', { class: 'ad-card ad-sec' }, h('header', {}, h('h3', { text: 'ข้อมูลหลัก' })),
    h('div', { class: 'ad-grid3' },
      field('หัวข้อ (ชื่อสถานที่)', inp(q.topic, v => { q.topic = v; touch(true); }, { maxlength: 80, placeholder: 'เช่น ภูทับเบิก' })),
      field('คำตอบ: จังหวัด', provSel),
      h('div', { class: 'ad-field' }, h('label', { text: 'คำตอบ: อำเภอ/เขต' }), distSel)),
    prof,
    ref ? h('div', { class: 'ad-ref' }, 'จากภาพผู้เล่น “' + (ref.title || '') + '”' + (ref.description ? '\nผู้ส่งเล่าว่า: ' + ref.description : '') + (ref.taken_at ? '\nถ่ายเมื่อ: ' + ref.taken_at : '') + '\nใช้เป็นข้อมูลตั้งต้นเท่านั้น ข้อเท็จจริงในเฉลยต้องมีแหล่งที่มาที่ตรวจได้') : null);
}
function secMainImage() {
  return h('section', { class: 'ad-card ad-sec' }, h('header', {}, h('h3', { text: 'การ์ด 1 · ภาพหลัก' }), h('span', { class: 'ad-help', text: 'เปิดให้ผู้เล่นฟรี ควรเดาได้ยากถ้าไม่มีเบาะแส' })),
    imageEditor(A.E.q.cards[0], false));
}
// Image block shared by card 1 and the reveal photo. reveal=true adds file / modified / note fields.
function imageEditor(im, reveal) {
  const box = h('div', { class: 'ad-img' });
  const draw = () => {
    box.innerHTML = '';
    const pic = h('img', { alt: '' });
    pic.style.objectPosition = im.focus || '50% 50%';
    setImg(pic, im.src);
    const frame = h('button', { type: 'button', class: 'ad-frame', 'aria-label': 'ขยายภาพ', onclick: () => { if (!im.src) return; const b = h('img', { class: 'big', alt: '' }); setImg(b, im.src); dialog('ภาพ', [b], null, true); } },
      im.src ? pic : h('span', { class: 'ad-noimg', text: 'ยังไม่มีภาพ' }));
    const [fx, fy] = String(im.focus || '50% 50%').split(' ').map(v => parseFloat(v) || 50);
    const focus = (x, y) => { im.focus = Math.round(x) + '% ' + Math.round(y) + '%'; pic.style.objectPosition = im.focus; A.dirty = true; };
    let cx = fx, cy = fy;
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      await guard(async () => {
        const out = await BE.compressImage(f, 1600, 0.85);
        im.src = await BE.uploadQuestionImage(out.blob);
        if (!im.credit) { im.source = 'other'; }
        touch(true); draw();
      }, 'อัปโหลดภาพแล้ว');
    } });
    const left = h('div', { class: 'ad-stack' }, frame,
      h('div', { class: 'ad-grid2' },
        field('จุดโฟกัสแนวนอน', h('input', { type: 'range', min: 0, max: 100, value: fx, oninput: e => { cx = +e.target.value; focus(cx, cy); } })),
        field('จุดโฟกัสแนวตั้ง', h('input', { type: 'range', min: 0, max: 100, value: fy, oninput: e => { cy = +e.target.value; focus(cx, cy); } }))),
      h('div', { class: 'ad-bar' }, file, btn('อัปโหลดภาพ', () => file.click(), 'sm'), btn('ใช้ภาพจากผู้เล่น', () => pickPlayerImage(im, draw), 'sm')));
    const lic = sel([['', 'เลือกสัญญาอนุญาต']].concat(Object.keys(LICENSE_URL).map(k => [k, licLabel(k)]), [[BE.LICENSE_ID, licLabel(BE.LICENSE_ID)]]), im.license, v => {
      im.license = v; if (LICENSE_URL[v] !== undefined && !im.license_url) im.license_url = LICENSE_URL[v]; touch(true); draw();
    });
    const prob = licenseProblem(im.license);
    const right = h('div', { class: 'ad-stack' },
      h('div', { class: 'ad-grid2' },
        field('แหล่งภาพ', sel(SOURCES, im.source || 'commons', v => { im.source = v; touch(true); draw(); })),
        field('เครดิต (ชื่อเจ้าของภาพ)', inp(im.credit, v => { im.credit = v; touch(true); }, { maxlength: 80 }))),
      h('div', { class: 'ad-grid2' },
        field('สัญญาอนุญาต', lic, prob ? null : (licenseKnown(im.license) ? null : 'ไม่อยู่ในรายการ ตรวจเงื่อนไขเองก่อนเผยแพร่')),
        field('ลิงก์สัญญาอนุญาต', inp(im.license_url, v => { im.license_url = v; A.dirty = true; }, { type: 'url', placeholder: 'https://creativecommons.org/…' }))),
      prob && im.src ? h('p', { class: 'ad-err', text: prob }) : null,
      field('ลิงก์ไฟล์ต้นฉบับ', inp(im.source_url, v => { im.source_url = v; touch(true); }, { type: 'url', placeholder: im.source === 'player' ? 'ไม่ต้องใส่สำหรับภาพผู้เล่น' : 'https://commons.wikimedia.org/wiki/File:…' })),
      field('ที่อยู่ไฟล์ภาพ (src)', inp(im.src, v => { im.src = v.trim(); touch(true); }, { placeholder: 'img/… หรือ https://…' }), 'ได้มาเองเมื่ออัปโหลดหรือเลือกภาพผู้เล่น'),
      reveal ? h('div', { class: 'ad-grid2' },
        field('ชื่อไฟล์ต้นฉบับ', inp(im.file, v => { im.file = v; A.dirty = true; })),
        field('การแก้ไขภาพ', inp(im.modified, v => { im.modified = v; A.dirty = true; }, { placeholder: 'เช่น ครอปและย่อขนาด' }))) : null,
      reveal ? field('หมายเหตุภาพ', inp(im.note, v => { im.note = v; A.dirty = true; }, { placeholder: 'เช่น เบลอป้ายชื่อสถานที่ในภาพเพื่อไม่ให้เฉลย' })) : null);
    box.append(left, right);
  };
  draw();
  return box;
}
async function pickPlayerImage(im, redraw) {
  const ok = A.subs.filter(s => s.status === 'approved' && s.public_url);
  if (!ok.length) { toast('ยังไม่มีภาพผู้เล่นที่ผ่านการตรวจ'); return; }
  const grid = h('div', { class: 'ad-picks' });
  const d = dialog('เลือกภาพจากผู้เล่น (ผ่านการตรวจแล้ว)', [grid], [{ label: 'ยกเลิก', value: null }], true);
  ok.forEach(s => {
    const img = h('img', { alt: '' }); setImg(img, s.public_url);
    grid.append(h('button', { type: 'button', onclick: () => { Object.assign(im, playerImage(s), { focus: im.focus || '50% 50%' }); touch(true); redraw(); $('ad-dialog')._close(s); } },
      img, h('span', { text: (s.title || '') + ' · ' + provName(s.province_id) })));
  });
  await d;
}
function secHints() {
  const q = A.E.q;
  const rows = q.cards.slice(1, 4).map((c, i) => h('div', { class: 'ad-field' },
    h('label', { text: 'การ์ด ' + (i + 2) + (i === 0 ? ' · กว้างที่สุด' : i === 2 ? ' · ชัดที่สุด' : '') }),
    h('div', { class: 'ad-row hint' },
      area(c.text, v => { c.text = v; touch(true); }, { rows: 2, maxlength: 240 }),
      sel(TAGS, c.tag_hint || '', v => { c.tag_hint = v || null; touch(true); }, 'sm'))));
  return h('section', { class: 'ad-card ad-sec' }, h('header', {}, h('h3', { text: 'การ์ด 2–4 · เบาะแสข้อความ' }), h('span', { class: 'ad-help', text: 'เปิดทีละใบ ตัวคูณลดเหลือ 0.8 / 0.6 / 0.4 · ป้ายบอกว่าเบาะแสนี้ช่วยเรื่องไหน' })), rows);
}
function secReveal() {
  const E = A.E, q = E.q;
  const imgBox = h('div', {});
  const drawImg = () => {
    imgBox.innerHTML = '';
    if (E.sameImage) {
      const ri = q.reveal.image;
      imgBox.append(h('div', { class: 'ad-grid2' },
        field('ชื่อไฟล์ต้นฉบับ', inp(ri.file, v => { ri.file = v; A.dirty = true; })),
        field('การแก้ไขภาพ', inp(ri.modified, v => { ri.modified = v; A.dirty = true; }, { placeholder: 'เช่น ครอปและย่อขนาด' }))),
      field('หมายเหตุภาพ', inp(ri.note, v => { ri.note = v; A.dirty = true; })));
    } else imgBox.append(imageEditor(q.reveal.image, true));
  };
  drawImg();
  const facts = h('div', { class: 'ad-stack' });
  const drawFacts = () => {
    facts.innerHTML = '';
    E.facts.forEach((f, i) => facts.append(h('div', { class: 'ad-row fact' },
      inp(f[0], v => { f[0] = v; touch(true); }, { class: 'ad-in sm', placeholder: 'หัวข้อ' }),
      area(f[1], v => { f[1] = v; touch(true); }, { rows: 2 }),
      h('button', { type: 'button', class: 'ad-x', 'aria-label': 'ลบหัวข้อ', onclick: () => { E.facts.splice(i, 1); touch(true); drawFacts(); } }, '×'))));
  };
  drawFacts();
  const srcs = h('div', { class: 'ad-stack' });
  const drawSrcs = () => {
    srcs.innerHTML = '';
    E.sources.forEach((s, i) => srcs.append(h('div', { class: 'ad-row src' },
      inp(s.title, v => { s.title = v; touch(true); }, { class: 'ad-in sm', placeholder: 'ชื่อแหล่ง เช่น เว็บไซต์จังหวัด' }),
      inp(s.url, v => { s.url = v; touch(true); }, { class: 'ad-in sm', type: 'url', placeholder: 'https://…' }),
      h('button', { type: 'button', class: 'ad-x', 'aria-label': 'ลบแหล่ง', onclick: () => { E.sources.splice(i, 1); touch(true); drawSrcs(); } }, '×'))));
    if (!E.sources.length) srcs.append(h('p', { class: 'ad-help', text: 'ต้องมีอย่างน้อย 1 ลิงก์ก่อนเผยแพร่' }));
  };
  drawSrcs();
  return h('section', { class: 'ad-card ad-sec' }, h('header', {}, h('h3', { text: 'หน้าเฉลย' })),
    h('label', { class: 'ad-check' }, h('input', { type: 'checkbox', checked: E.sameImage, onchange: e => {
      E.sameImage = e.target.checked;
      if (!E.sameImage && !q.reveal.image.src) Object.assign(q.reveal.image, clone(q.cards[0]));
      touch(true); drawImg();
    } }), 'ใช้ภาพเดียวกับการ์ด 1'),
    imgBox,
    h('header', {}, h('h4', { text: 'ข้อมูลจริง' }), btn('+ เพิ่มหัวข้อ', () => { E.facts.push(['', '']); touch(true); drawFacts(); }, 'sm')), facts,
    field('วิธีคิด (โชว์ใต้ข้อมูล)', area(q.reveal.reasoning, v => { q.reveal.reasoning = v; touch(true); }, { rows: 2, placeholder: 'เช่น ทะเลหมอก + ไร่ผักขั้นบันได → ภูเขาสูง · ภาคกลางตอนบนสุด → เพชรบูรณ์ · ยอดเขาของชาวม้ง → อ.หล่มเก่า' })),
    h('header', {}, h('h4', { text: 'แหล่งที่มา' }), btn('+ เพิ่มแหล่ง', () => { E.sources.push({ title: '', url: '' }); touch(true); drawSrcs(); }, 'sm')), srcs);
}
function renderAside() {
  const aside = $('ad-aside');
  if (!aside || !A.E) return;
  const E = A.E, q = E.q;
  const built = buildQuestion();
  const req = requirements(built);
  const ready = req.every(r => r[1]);
  const needOk = req.filter(r => r[0] !== 'ผ่านการตรวจแล้ว').every(r => r[1]);
  const blocked = q.status === 'published' && !ready;
  aside.innerHTML = '';
  const status = h('div', { class: 'ad-status', role: 'radiogroup', 'aria-label': 'สถานะ' });
  [['draft', 'ร่าง — ยังไม่ขึ้นในเกม'], ['published', 'เผยแพร่ — ขึ้นในเกม'], ['archived', 'เก็บเข้าคลัง — ซ่อนจากเกม']].forEach(([v, t]) => {
    const dis = v === 'published' && !ready && q.status !== 'published';
    status.append(h('label', { class: dis ? 'dis' : '' }, h('input', { type: 'radio', name: 'ad-st', value: v, checked: q.status === v, disabled: dis, onchange: () => { q.status = v; A.dirty = true; renderAside(); } }), t));
  });
  const verify = q.verified_by
    ? h('div', { class: 'ad-verify done' }, h('b', { text: 'ตรวจแล้ว' }), h('span', { class: 'ad-small', text: 'โดย ' + q.verified_by + ' · ' + thTime(q.verified_at) }),
      btn('ยกเลิกการตรวจ', () => { q.verified_by = null; q.verified_at = null; touch(false); }, 'sm'))
    : h('div', { class: 'ad-verify' },
      E.stale ? h('p', { class: 'ad-err', text: 'แก้เนื้อหาหลังตรวจแล้ว ต้องยืนยันการตรวจใหม่' }) : null,
      h('p', { class: 'ad-small ad-muted', text: 'ตรวจข้อเท็จจริงกับแหล่งที่มา ตรวจสัญญาอนุญาตภาพ และอ่านเบาะแสว่าไม่กำกวม' }),
      btn('ฉันตรวจครบแล้ว', () => { q.verified_by = reviewerName(); q.verified_at = new Date().toISOString(); E.stale = false; A.dirty = true; renderAside(); }, 'ok', { disabled: !needOk, title: needOk ? '' : 'กรอกข้อมูลให้ครบก่อน' }));
  aside.append(
    h('div', { class: 'ad-card ad-stack' }, h('h3', { text: 'ก่อนเผยแพร่' }),
      h('ul', { class: 'ad-checks' }, req.map(([t, ok]) => h('li', { class: ok ? 'ok' : '', text: t }))), verify),
    h('div', { class: 'ad-card ad-stack' }, h('h3', { text: 'สถานะ' }), status,
      field('วันที่กำหนด (ไม่บังคับ)', inp(q.schedule_date || '', v => { q.schedule_date = v || null; A.dirty = true; }, { type: 'date' }), 'ล็อกให้ข้อนี้เป็นข้อรายวันของวันนั้น'),
      field('หมายเหตุภายใน', area(q.note || '', v => { q.note = v; A.dirty = true; }, { rows: 2 }))),
    h('div', { class: 'ad-card ad-stack' },
      btn(E.isNew ? 'บันทึกคำถาม' : 'บันทึกการแก้ไข', saveEditor, 'primary', { disabled: blocked }),
      blocked ? h('p', { class: 'ad-err', text: 'ข้อนี้ตั้งเป็นเผยแพร่: ต้องครบทุกข้อและกด “ฉันตรวจครบแล้ว” ก่อนบันทึก หรือเปลี่ยนเป็นร่างเพื่อเก็บงานไว้ก่อน' })
        : h('p', { class: 'ad-help', text: q.status === 'published' ? (q.published_at ? 'บันทึกแล้วผู้เล่นเห็นเนื้อหาใหม่ทันที' : 'บันทึกแล้วขึ้นในโหมดไม่จำกัด และเข้ารอบรายวันตั้งแต่พรุ่งนี้') : 'บันทึกเป็น' + STATUS_TH[q.status] + ' ผู้เล่นยังไม่เห็น' })));
}
async function saveEditor() {
  const E = A.E;
  const q = buildQuestion();
  if (!q.topic && !q.answer) { toast('ใส่หัวข้อหรือคำตอบก่อนบันทึก'); return; }
  if (q.status === 'published' && !requirements(q).every(r => r[1])) { toast('ยังไม่ครบเงื่อนไขเผยแพร่'); return; }
  if (E.isNew && A.questions.some(x => x.id === q.id)) q.id = nextId(q.category);
  const saved = await guard(() => BE.saveQuestion(q), 'บันทึกแล้ว');
  if (!saved) return;
  A.dirty = false;
  A.questions = await BE.listQuestions();
  const fresh = A.questions.find(x => x.id === saved.id) || saved;
  openEditor(clone(fresh), false);
}
async function removeQuestion(q) {
  if (!await confirmBox('ลบคำถาม ' + q.id + '?', q.status === 'published' ? 'ข้อนี้เผยแพร่อยู่ จะหายจากเกมทันที ' + 'ถ้าแค่อยากซ่อน ให้เปลี่ยนสถานะเป็น “เก็บเข้าคลัง” แทน' : 'ลบถาวร ย้อนกลับไม่ได้', 'ลบถาวร', 'danger')) return;
  await guard(async () => { await BE.deleteQuestion(q.id); A.dirty = false; A.questions = await BE.listQuestions(); setView('questions'); }, 'ลบแล้ว');
}
async function copyJSON(obj) {
  const text = JSON.stringify(obj, null, 1);
  try { await navigator.clipboard.writeText(text); toast('คัดลอก JSON แล้ว'); }
  catch (e) { dialog('JSON', [h('textarea', { class: 'ad-in', rows: 16, value: text, readonly: true })]); }
}

/* ---------------- 4. ระบบ ---------------- */
function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function viewSystem(main) {
  const live = BE.MODE === 'supabase';
  let host = '';
  try { host = live ? new URL(BE.CFG.supabaseUrl).host : ''; } catch (e) { host = BE.CFG.supabaseUrl; }
  const exportQs = () => ({ version: bangkokDate(), exported_at: new Date().toISOString(), categories: CATS, questions: A.questions.map(q => { const c = clone(q); delete c.updated_at; return c; }) });
  const exportPs = () => ({ exported_at: new Date().toISOString(), region_adjacency: (A.meta || {}).region_adjacency, provinces: A.provinces });
  main.append(h('div', { class: 'ad-head' }, h('div', {}, h('h2', { text: 'ระบบ' }), h('p', { text: 'การเชื่อมต่อ การนำเข้าข้อมูลตั้งต้น และการสำรองข้อมูล' }))));
  main.append(h('div', { class: 'ad-card ad-stack' }, h('h3', { text: 'การเชื่อมต่อ' }),
    live ? h('p', {}, 'เชื่อม Supabase ที่ ', h('b', { text: host }), ' · ภาพผู้เล่นอยู่ใน bucket “submissions” (ส่วนตัว) ภาพคำถามอยู่ใน “question-images” (สาธารณะ)')
      : h('p', { text: 'โหมดสาธิต: ไม่มีเซิร์ฟเวอร์ ข้อมูลและภาพเก็บใน localStorage/IndexedDB ของเบราว์เซอร์นี้ เว็บเล่นเกมกับเว็บใส่ข้อมูลเห็นข้อมูลเดียวกันเมื่อเปิดจากที่อยู่เดียวกันในเบราว์เซอร์นี้' }),
    live ? null : h('p', { class: 'ad-help', text: 'ใช้งานจริง: ใส่ supabaseUrl และ supabaseKey (publishable key) ในไฟล์ config.js ของทั้งสองเว็บ (ดู README ขั้นที่ 4)' })));
  main.append(h('div', { class: 'ad-card ad-stack' }, h('h3', { text: 'ข้อมูลตั้งต้น' }),
    h('p', { text: live ? 'เพิ่มคำถามตั้งต้นและรายชื่อ 77 จังหวัดจากไฟล์ที่มากับเว็บ เฉพาะรายการที่ยังไม่มีในฐานข้อมูล คำถามเข้ามาเป็น “ร่าง” ต้องตรวจก่อนเผยแพร่' : 'คืนค่าข้อมูลสาธิตทั้งหมดเป็นค่าเริ่มต้น (ลบภาพที่ส่งและคำถามที่สร้างในเบราว์เซอร์นี้)' }),
    h('div', { class: 'ad-bar' }, live
      ? btn('นำเข้าข้อมูลตั้งต้น', async () => { if (!await confirmBox('นำเข้าข้อมูลตั้งต้น?', 'ไม่เขียนทับรายการที่มีอยู่แล้ว')) return; await guard(async () => { await BE.importSeed(); await loadAll(); setView('system'); }, 'นำเข้าแล้ว'); }, 'primary')
      : btn('ล้างข้อมูลสาธิต', async () => { if (!await confirmBox('ล้างข้อมูลสาธิต?', 'ภาพที่ส่งและการแก้ไขทั้งหมดในเบราว์เซอร์นี้จะหายไป', 'ล้างข้อมูล', 'danger')) return; await guard(async () => { await BE.importSeed(); await loadAll(); setView('system'); }, 'ล้างข้อมูลแล้ว'); }, 'danger'))));
  main.append(h('div', { class: 'ad-card ad-stack' }, h('h3', { text: 'สำรองข้อมูล' }),
    h('p', { text: 'ไฟล์ JSON รูปแบบเดียวกับ data/questions.json และ data/provinces.json (รวมข้อที่เป็นร่าง)' }),
    h('div', { class: 'ad-bar' },
      // inside a claude.ai artifact the frame refuses downloads: offer copy only
      window.claude ? null : btn('ดาวน์โหลดคำถาม (' + A.questions.length + ')', () => download('allthai-questions-' + bangkokDate() + '.json', exportQs())),
      window.claude ? null : btn('ดาวน์โหลดจังหวัด (' + A.provinces.length + ')', () => download('allthai-provinces-' + bangkokDate() + '.json', exportPs())),
      btn('คัดลอกคำถามเป็น JSON', () => copyJSON(exportQs()), 'sm'),
      btn('คัดลอกจังหวัดเป็น JSON', () => copyJSON(exportPs()), 'sm'))));
}

/* ---------------- mount ---------------- */
async function mount() {
  $('admin-app').hidden = false;
  if (A.mounted) {
    if (A.session && A.session.admin && A.view !== 'editor') await guard(async () => { await loadAll(); setView(A.view); });
    return;
  }
  A.mounted = true;
  shell();
  try { A.session = await BE.session(); }
  catch (e) { $('ad-main').innerHTML = ''; $('ad-main').append(h('div', { class: 'ad-card ad-login' }, h('h2', { text: 'เชื่อมต่อไม่สำเร็จ' }), h('p', { text: String(e.message || e) }))); A.mounted = false; return; }
  await guard(afterSession);
}
return { mount };
})();

window.AllThaiAdmin = AllThaiAdmin;
