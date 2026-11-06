// scoring.js — pure functions shared by the pages and the Node tests. V2: one category, answers are districts.
//
// score = round(base × h)
//   base = 1000 when the guessed district is the answer, otherwise 1000 × e^(−km / 150) (capped at 999)
//          km = great-circle distance between the two districts' anchor points (inside each district)
//   h    = 1.0 / 0.8 / 0.6 / 0.4 for 1 / 2 / 3 / 4 cards opened · timeout = 0

const MULTIPLIERS = [1.0, 0.8, 0.6, 0.4];      // cards opened: 1 (free), 2, 3, 4
const CORRECT_BASE = 1000;
const DISTANCE_SCALE_KM = 150;                  // 25 km ≈ 846 · 100 km ≈ 513 · 300 km ≈ 135
const DAILY_COUNT = 5;
const DAY0_UTC = Date.UTC(2026, 10, 5);         // day 0 of the daily rotation (Asia/Bangkok)

function multiplierFor(cardsOpened) {
  const n = Math.max(1, Math.min(MULTIPLIERS.length, cardsOpened | 0));
  return MULTIPLIERS[n - 1];
}

// Great-circle distance in km between [lat, lon] points.
function haversineKm(a, b) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function distanceBase(km) {
  if (km <= 0) return CORRECT_BASE;
  return Math.min(CORRECT_BASE - 1, Math.round(CORRECT_BASE * Math.exp(-km / DISTANCE_SCALE_KM)));
}

// One answered question → score breakdown. districts: { [id]: { ll: [lat, lon], … } }
function scoreAnswer({ question, guessId, cardsOpened, timedOut, districts }) {
  const h = multiplierFor(cardsOpened);
  if (timedOut || !guessId) return { correct: false, timeout: true, h, base: 0, score: 0, km: null };
  if (guessId === question.answer) return { correct: true, timeout: false, h, base: CORRECT_BASE, score: Math.round(CORRECT_BASE * h), km: 0 };
  const g = districts[guessId], a = districts[question.answer];
  if (!g || !a) return { correct: false, timeout: false, h, base: 0, score: 0, km: null };
  const km = haversineKm(g.ll, a.ll);
  const base = distanceBase(km);
  return { correct: false, timeout: false, h, base, score: Math.round(base * h), km };
}

const fmtKm = km => km == null ? '–' : km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('en-US');

// Calendar day in Thailand, as YYYY-MM-DD (daily set changes at midnight Asia/Bangkok).
function bangkokDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}
function dayIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - DAY0_UTC) / 86400000);
}
function bangkokDayStartMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - 7 * 3600000;
}
// Same questions for everybody on a date. Questions pinned to the date come first, then the pool is walked in
// blocks of `count`, so nothing repeats until every question has been used. A question published during day D
// joins from D+1, so publishing in the team site never changes a day that has started. (No published_at = always.)
function dailySet(questions, dateStr, count) {
  count = count || DAILY_COUNT;
  const dayStart = bangkokDayStartMs(dateStr);
  const all = questions.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ready = all.filter(q => !q.published_at || Date.parse(q.published_at) < dayStart);
  const pool = ready.length ? ready : all;
  const out = pool.filter(q => q.schedule_date === dateStr).slice(0, count);
  const free = pool.filter(q => !q.schedule_date);
  const n = free.length;
  if (n) {
    const start = (((dayIndex(dateStr) * count) % n) + n) % n;
    for (let i = 0; out.length < count && i < n; i++) out.push(free[(start + i) % n]);
  }
  return out;
}

// 🎯 right district · 🟩 ≤ 25 km · 🟨 ≤ 100 km · 🟧 ≤ 300 km · 🟥 farther · ⬜ timeout
function distanceMark(r) {
  if (r.timeout) return '⬜';
  if (r.correct) return '🎯';
  return r.km <= 25 ? '🟩' : r.km <= 100 ? '🟨' : r.km <= 300 ? '🟧' : '🟥';
}
function shareText({ dateLabel, total, max, results, url }) {
  return 'ออลไทย ' + dateLabel + ' — ' + total.toLocaleString('en-US') + ' / ' + max.toLocaleString('en-US') + '\n' +
    results.map(distanceMark).join('') + (url ? '\n' + url : '');
}

// Daily: total score, then less time on the answer screens wins.
function rankDaily(entries) {
  return entries.slice().sort((a, b) => (b.score - a.score) || ((a.timeMs || 0) - (b.timeMs || 0)));
}
// Unlimited: average per question (min 10 questions), then more rounds wins.
function rankUnlimited(entries, minRounds) {
  const min = minRounds == null ? 10 : minRounds;
  return entries.filter(e => (e.rounds || 0) >= min)
    .map(e => Object.assign({}, e, { avg: e.total / e.rounds }))
    .sort((a, b) => (b.avg - a.avg) || (b.rounds - a.rounds));
}

const BLOCKED_NAME_PARTS = ['ควย', 'เหี้ย', 'สัส', 'เย็ด', 'แตด', 'อีดอก', 'ระยำ', 'ชาติหมา', 'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'nigg'];
// Basic nickname filter. Returns the cleaned name, '' for empty, or null when blocked.
function cleanNickname(raw) {
  const s = String(raw || '').replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!s) return '';
  const flat = s.toLowerCase().replace(/[\s._\-]/g, '');
  return BLOCKED_NAME_PARTS.some(w => flat.includes(w)) ? null : s;
}

if (typeof module !== 'undefined') {
  module.exports = { MULTIPLIERS, DAILY_COUNT, DISTANCE_SCALE_KM, multiplierFor, haversineKm, distanceBase, scoreAnswer, fmtKm, bangkokDate, dayIndex,
    dailySet, distanceMark, shareText, rankDaily, rankUnlimited, cleanNickname };
}
