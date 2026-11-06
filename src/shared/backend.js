/* backend.js — one data layer shared by เว็บเล่นเกม (play) and เว็บใส่ข้อมูล (admin).
 *
 * mode "supabase": the real shared database + photo storage. Set in config.js:
 *     window.ALLTHAI_CONFIG = { supabaseUrl: "https://xxxx.supabase.co", supabaseKey: "sb_publishable_..." }
 *     (the publishable key, or the legacy anon key; never a secret / service_role key)
 * mode "demo": no server. Rows live in this browser's localStorage, photos in IndexedDB.
 *     Both sites see the same demo data only when they are opened from the same origin
 *     (the preview page, or /play and /admin on one local server).
 */
const AllThaiBackend = (() => {
  'use strict';
  const CFG = Object.assign({ supabaseUrl: '', supabaseKey: '', supabaseJs: 'vendor/supabase.js', dataBase: 'data/', shareUrl: '', playUrl: '' }, window.ALLTHAI_CONFIG || {});
  const KEY = CFG.supabaseKey || CFG.supabaseAnonKey || '';
  const jwtRole = k => { try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role || ''; } catch (e) { return ''; } };
  const SECRET_KEY = /^sb_secret_/.test(KEY) || jwtRole(KEY) === 'service_role';
  const MODE = CFG.supabaseUrl && KEY ? 'supabase' : 'demo';
  const BUCKET_SUB = 'submissions';        // private: photos waiting for review
  const BUCKET_IMG = 'question-images';    // public: photos used by questions
  const DEMO_KEY = 'allthai.demo.v1';
  const LICENSE_ID = 'allthai-nonexclusive-v1';
  const LICENSE_TEXT = 'ผู้ส่งอนุญาตให้ออลไทยใช้แบบไม่ผูกขาด รวมเชิงพาณิชย์ ครอปและปรับขนาดได้';

  // build.py stamps a hash of the data files here, so a new deploy never mixes old cached JSON with new code
  const DATA_VERSION = 'dev';
  const dataUrl = name => CFG.dataBase + name + '?v=' + DATA_VERSION;
  const getJSON = p => fetch(p).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
  // v4 UUID (the database checks that a photo's file name matches its row id)
  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> c / 4).toString(16));
  const nowIso = () => new Date().toISOString();
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const clone = o => JSON.parse(JSON.stringify(o));

  const CATEGORIES = ['สถานที่ท่องเที่ยว'];   // V2: travel only, answers are districts
  // Bundled starting data. The game on Supabase only needs the province file (the draft questions stay out of it).
  let provP = null, qP = null;
  function seedProvinces() {
    return provP || (provP = getJSON(dataUrl('provinces.json')).then(p => ({
      provinces: p.provinces,
      provinceMeta: { region_adjacency: p.region_adjacency || {}, rules: p.rules || {}, sources_to_check: p.sources_to_check || [] }
    })));
  }
  function seedQuestions() {
    return qP || (qP = getJSON(dataUrl('questions.json')).then(q => ({
      questions: q.questions.map(x => Object.assign({ status: 'published' }, x)),
      backlog: q.backlog || []
    })));
  }
  async function seed() {
    const [p, q] = await Promise.all([seedProvinces(), seedQuestions()]);
    return { categories: CATEGORIES, questions: q.questions, backlog: q.backlog, provinces: p.provinces, provinceMeta: p.provinceMeta };
  }

  /* ---------------- demo store ---------------- */
  function demoRead() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || null; } catch (e) { return null; } }
  function demoWrite(s) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); }
    catch (e) { throw new Error('บันทึกในเบราว์เซอร์ไม่ได้ (พื้นที่เต็มหรือถูกปิด)'); }
  }
  async function demoState() {
    let s = demoRead();
    if (!s) {
      const sd = await seed();
      s = { questions: {}, provinces: {}, submissions: [] };
      sd.questions.forEach(q => { s.questions[q.id] = q; });
      sd.provinces.forEach(p => { s.provinces[p.id] = p; });
      demoWrite(s);
    }
    return s;
  }
  // photos: IndexedDB when available, otherwise kept in memory for this visit
  const mem = new Map();
  let idbP = null;
  function idb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return idbP || (idbP = new Promise(res => {
      try {
        const r = indexedDB.open('allthai-demo', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('blobs');
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    }));
  }
  async function blobOp(mode, key, val) {
    const db = await idb();
    if (!db) { if (mode === 'put') mem.set(key, val); if (mode === 'del') mem.delete(key); return mem.get(key); }
    return new Promise((res, rej) => {
      const tx = db.transaction('blobs', mode === 'get' ? 'readonly' : 'readwrite');
      const st = tx.objectStore('blobs');
      const rq = mode === 'put' ? st.put(val, key) : mode === 'del' ? st.delete(key) : st.get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  const urlCache = new Map();
  async function demoUrl(key) {
    if (urlCache.has(key)) return urlCache.get(key);
    const b = await blobOp('get', key);
    if (!b) return '';
    const u = URL.createObjectURL(b);
    urlCache.set(key, u);
    return u;
  }

  /* ---------------- supabase ---------------- */
  let sbP = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด ' + src + ' ไม่สำเร็จ'));
      document.head.appendChild(s);
    });
  }
  function sb() {
    return sbP || (sbP = (async () => {
      if (SECRET_KEY) throw new Error('config.js ใส่ secret key ไว้ ซึ่งห้ามอยู่ในเว็บ: เปลี่ยนเป็น publishable key แล้วสร้าง secret key ใหม่ใน Supabase');
      if (!window.supabase) await loadScript(CFG.supabaseJs);
      return window.supabase.createClient(CFG.supabaseUrl, KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'allthai-auth' }
      });
    })());
  }
  function must(res) {
    if (res && res.error) throw new Error(res.error.message || String(res.error));
    return res ? res.data : null;
  }

  /* ---------------- public: game ---------------- */
  // Published questions + province profiles for the game.
  // Questions come only from the database (never the bundled file), so unpublishing in the admin site really hides them.
  // Province profiles: database rows override the bundled draft by id (the map needs all 77).
  async function loadContent() {
    if (MODE === 'demo') {
      const s = await demoState();
      return { categories: CATEGORIES, source: 'demo',
        questions: Object.values(s.questions).filter(q => q.status === 'published').sort(byId),
        provinces: Object.values(s.provinces).sort(byId) };
    }
    const c = await sb();
    const [qs, ps] = await Promise.all([
      c.from('questions').select('data').eq('status', 'published'),
      c.from('provinces').select('data')
    ]);
    const questions = must(qs).map(r => r.data).sort(byId);
    const merged = {};
    try { (await seedProvinces()).provinces.forEach(p => { merged[p.id] = p; }); } catch (e) { /* database rows only */ }
    if (!ps.error) ps.data.forEach(r => { if (r.data && r.data.id) merged[r.data.id] = r.data; });
    return { categories: CATEGORIES, source: 'supabase', questions, provinces: Object.values(merged).sort(byId) };
  }

  // A player's photo → private queue, status "pending". Nothing is shown in the game until an admin approves it.
  async function submitPhoto(blob, meta) {
    const row = {
      id: uuid(), status: 'pending',
      province_id: meta.province_id, category: meta.category || null,
      district_id: /^TH\d{4}$/.test(meta.district_id || '') ? meta.district_id : null,
      title: String(meta.title || '').slice(0, 120), description: String(meta.description || '').slice(0, 600) || null,
      taken_at: String(meta.taken_at || '').slice(0, 60) || null,
      credit_name: String(meta.credit_name || '').slice(0, 60) || null,
      contact: String(meta.contact || '').slice(0, 120) || null,
      consent_owner: !!meta.consent_owner, consent_license: !!meta.consent_license, consent_people: !!meta.consent_people,
      license: LICENSE_ID
    };
    if (!row.consent_owner || !row.consent_license || !row.consent_people) throw new Error('ต้องยืนยันครบ 3 ข้อ');
    if (MODE === 'demo') {
      const key = 'sub:' + row.id;
      await blobOp('put', key, blob);
      const s = await demoState();
      s.submissions.unshift(Object.assign(row, { image_path: key, created_at: nowIso() }));
      demoWrite(s);
      return { id: row.id };
    }
    const c = await sb();
    row.image_path = 'pending/' + row.id + '.jpg';
    must(await c.storage.from(BUCKET_SUB).upload(row.image_path, blob, { contentType: 'image/jpeg', upsert: false }));
    must(await c.from('submissions').insert(row));
    return { id: row.id };
  }
  // Demo only: let the sender see the review status. (On Supabase, players cannot read the queue.)
  async function mySubmissionStatus(ids) {
    if (MODE !== 'demo') return {};
    const s = await demoState();
    const out = {};
    s.submissions.forEach(r => { if (ids.includes(r.id)) out[r.id] = r.status; });
    return out;
  }

  /* ---------------- admin ---------------- */
  async function session() {
    if (MODE === 'demo') return { email: 'โหมดสาธิต', admin: true, demo: true };
    const c = await sb();
    const { data } = await c.auth.getSession();
    const s = data && data.session;
    if (!s) return null;
    const r = await c.rpc('is_admin');
    return { email: s.user.email, admin: !r.error && r.data === true };
  }
  async function signIn(email, password) {
    const c = await sb();
    must(await c.auth.signInWithPassword({ email, password }));
    return session();
  }
  async function signOut() { if (MODE === 'supabase') { const c = await sb(); await c.auth.signOut(); } }

  async function listQuestions() {
    if (MODE === 'demo') { const s = await demoState(); return Object.values(s.questions).sort(byId); }
    const c = await sb();
    return must(await c.from('questions').select('id, category, status, data, verified_by, verified_at, updated_at').order('id'))
      .map(r => Object.assign({}, r.data, { id: r.id, category: r.category, status: r.status, verified_by: r.verified_by, verified_at: r.verified_at, updated_at: r.updated_at }));
  }
  async function saveQuestion(q) {
    q = clone(q);
    q.updated_at = nowIso();
    // published_at drives the daily rotation (a question joins the day after it is published)
    if (q.status !== 'published') q.published_at = null;
    else if (!q.published_at) q.published_at = q.updated_at;
    if (MODE === 'demo') { const s = await demoState(); s.questions[q.id] = q; demoWrite(s); return q; }
    const c = await sb();
    must(await c.from('questions').upsert({ id: q.id, category: q.category, status: q.status, data: q, verified_by: q.verified_by || null, verified_at: q.verified_at || null, updated_at: q.updated_at }));
    return q;
  }
  async function deleteQuestion(id) {
    if (MODE === 'demo') { const s = await demoState(); delete s.questions[id]; demoWrite(s); return; }
    const c = await sb();
    must(await c.from('questions').delete().eq('id', id));
  }
  async function listProvinces() {
    if (MODE === 'demo') { const s = await demoState(); return Object.values(s.provinces).sort(byId); }
    const c = await sb();
    const rows = must(await c.from('provinces').select('data').order('id')).map(r => r.data);
    return rows.length ? rows : (await seedProvinces()).provinces;
  }
  async function saveProvince(p) {
    p = clone(p);
    if (MODE === 'demo') { const s = await demoState(); s.provinces[p.id] = p; demoWrite(s); return p; }
    const c = await sb();
    must(await c.from('provinces').upsert({ id: p.id, data: p, verified: !!p.verified, updated_at: nowIso() }));
    return p;
  }
  async function listSubmissions() {
    if (MODE === 'demo') {
      const s = await demoState();
      const rows = clone(s.submissions);
      for (const r of rows) r.imageUrl = await demoUrl(r.image_path);
      return rows;
    }
    const c = await sb();
    const rows = must(await c.from('submissions').select('*').order('created_at', { ascending: false }));
    if (rows.length) {
      const signed = must(await c.storage.from(BUCKET_SUB).createSignedUrls(rows.map(r => r.image_path), 3600)) || [];
      const map = {};
      signed.forEach(x => { if (x && x.path) map[x.path] = x.signedUrl; });
      rows.forEach(r => { r.imageUrl = map[r.image_path] || r.public_url || ''; });
    }
    return rows;
  }
  // status: "approved" copies the photo into the public bucket so questions can use it.
  async function reviewSubmission(id, status, note, reviewer) {
    const patch = { status, review_note: note || null, reviewed_at: nowIso(), reviewed_by: reviewer || null };
    if (MODE === 'demo') {
      const s = await demoState();
      const r = s.submissions.find(x => x.id === id);
      if (!r) throw new Error('ไม่พบรายการ');
      if (status === 'approved' && !r.public_url) {
        const key = 'img:player-' + id;
        await blobOp('put', key, await blobOp('get', r.image_path));
        patch.public_url = 'idb:' + key;
      }
      Object.assign(r, patch);
      demoWrite(s);
      return r;
    }
    const c = await sb();
    if (status === 'approved') {
      const cur = must(await c.from('submissions').select('image_path, public_url').eq('id', id).single());
      if (!cur.public_url) {
        const blob = must(await c.storage.from(BUCKET_SUB).download(cur.image_path));
        const path = 'player/' + id + '.jpg';
        must(await c.storage.from(BUCKET_IMG).upload(path, blob, { contentType: 'image/jpeg', upsert: true }));
        patch.public_url = c.storage.from(BUCKET_IMG).getPublicUrl(path).data.publicUrl;
      }
    }
    must(await c.from('submissions').update(patch).eq('id', id));
    return patch;
  }
  async function deleteSubmission(row) {
    if (MODE === 'demo') {
      const s = await demoState();
      s.submissions = s.submissions.filter(x => x.id !== row.id);
      demoWrite(s);
      await blobOp('del', row.image_path);
      return;
    }
    const c = await sb();
    must(await c.storage.from(BUCKET_SUB).remove([row.image_path]));
    must(await c.from('submissions').delete().eq('id', row.id));
  }
  // Admin's own upload for a question card. Returns the value to store in card.src.
  async function uploadQuestionImage(blob) {
    if (MODE === 'demo') { const key = 'img:admin-' + uuid(); await blobOp('put', key, blob); return 'idb:' + key; }
    const c = await sb();
    const path = 'admin/' + uuid() + '.jpg';
    must(await c.storage.from(BUCKET_IMG).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
    return c.storage.from(BUCKET_IMG).getPublicUrl(path).data.publicUrl;
  }
  // card.src → displayable URL ("idb:" keys are demo photos)
  function imageUrl(src) {
    if (!src) return Promise.resolve('');
    if (src.indexOf('idb:') === 0) return demoUrl(src.slice(4));
    return Promise.resolve(src);
  }
  // Copy the bundled 12 questions + 77 provinces into the database without overwriting existing rows.
  // On Supabase the questions arrive as drafts: they go live only after someone checks them and presses publish.
  async function importSeed() {
    const sd = await seed();
    if (MODE === 'demo') { await resetDemo(); await demoState(); return { questions: sd.questions.length, provinces: sd.provinces.length }; }
    const c = await sb();
    must(await c.from('provinces').upsert(sd.provinces.map(p => ({ id: p.id, data: p, verified: !!p.verified })), { onConflict: 'id', ignoreDuplicates: true }));
    must(await c.from('questions').upsert(sd.questions.map(q => {
      const d = Object.assign({}, q, { status: 'draft', published_at: null });
      return { id: d.id, category: d.category, status: 'draft', data: d };
    }), { onConflict: 'id', ignoreDuplicates: true }));
    return { questions: sd.questions.length, provinces: sd.provinces.length };
  }
  // Demo only: forget every demo row and photo in this browser.
  async function resetDemo() {
    try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ }
    mem.clear();
    urlCache.forEach(u => URL.revokeObjectURL(u)); urlCache.clear();
    const db = await idb();
    if (db) await new Promise(res => { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').clear(); tx.oncomplete = res; tx.onerror = res; });
  }

  // Resize + re-encode in the browser: max 1600 px, JPEG. Re-encoding also drops EXIF (GPS, device).
  async function compressImage(file, maxSide, quality) {
    maxSide = maxSide || 1600; quality = quality || 0.85;
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      src = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('เปิดไฟล์ภาพนี้ไม่ได้ ลองเลือกไฟล์ .jpg หรือ .png'));
        img.src = URL.createObjectURL(file);
      });
    }
    const w0 = src.width, h0 = src.height;
    if (Math.min(w0, h0) < 400) throw new Error('ภาพเล็กเกินไป (ด้านสั้นต้องอย่างน้อย 400 พิกเซล)');
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(src, 0, 0, w, h);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('แปลงภาพไม่สำเร็จ');
    return { blob, width: w, height: h };
  }

  return {
    MODE, CFG, LICENSE_ID, LICENSE_TEXT, CATEGORIES, dataUrl,
    seed, seedProvinces, loadContent, submitPhoto, mySubmissionStatus,
    session, signIn, signOut,
    listQuestions, saveQuestion, deleteQuestion, listProvinces, saveProvince,
    listSubmissions, reviewSubmission, deleteSubmission, uploadQuestionImage,
    imageUrl, importSeed, resetDemo, compressImage
  };
})();

window.AllThaiBackend = AllThaiBackend;
