// scoring.js — pure functions shared by the page and the Node tests.
// Spec: handoff.md §7 (score = round(base × h)), §5 (daily set), §10 (leaderboard order).

const MULTIPLIERS = [1.0, 0.8, 0.6, 0.4];      // cards opened: 1 (free), 2, 3, 4
const CORRECT_BASE = 1000;
const TAG_POINTS = 80;                          // part A: per matching profile tag (max 5 × 80 = 400)
const REGION_ADJACENT_POINTS = 40;              // part A: neighbouring region instead of same region
const DAY0_UTC = Date.UTC(2026, 10, 5);         // first daily set = 5 Nov 2026 (Asia/Bangkok)

function multiplierFor(cardsOpened) {
  const n = Math.max(1, Math.min(MULTIPLIERS.length, cardsOpened | 0));
  return MULTIPLIERS[n - 1];
}

// Part A — compare the guessed province's profile with the answer's profile.
// Multi-value rule (open question #3 in the handoff, configurable here):
//   terrain         → match when the two lists share at least one value
//   main_occupation → match when the primary (first) value is the same
function profileMatch(guess, answer) {
  const same = [];
  const lines = [];
  let points = 0;
  if (guess.region === answer.region) {
    points += TAG_POINTS; same.push('ภาค');
  } else if ((answer.adjacent_regions || []).includes(guess.region)) {
    points += REGION_ADJACENT_POINTS;
    lines.push({ label: 'ภาคติดกัน (' + guess.region + ' กับ ' + answer.region + ')', points: REGION_ADJACENT_POINTS });
  }
  if (guess.dialect === answer.dialect) { points += TAG_POINTS; same.push('ภาษาถิ่น'); }
  if (guess.religion_culture === answer.religion_culture) { points += TAG_POINTS; same.push('ศาสนา'); }
  const commonTerrain = (guess.terrain || []).filter(t => (answer.terrain || []).includes(t));
  if (commonTerrain.length) { points += TAG_POINTS; same.push(commonTerrain.join('/')); }
  const g0 = (guess.main_occupation || [])[0];
  if (g0 && g0 === (answer.main_occupation || [])[0]) { points += TAG_POINTS; same.push('อาชีพหลัก'); }
  if (same.length) lines.unshift({ label: same.join(' · ') + ' ตรงกัน', points: same.length * TAG_POINTS });
  return { points, lines };
}

// One answered question → score breakdown.
function scoreAnswer({ question, guessId, cardsOpened, timedOut, profiles }) {
  const h = multiplierFor(cardsOpened);
  if (timedOut || !guessId) {
    return { correct: false, timeout: true, h, base: 0, score: 0, aPoints: 0, bPoints: 0, lines: [] };
  }
  if (guessId === question.answer) {
    return { correct: true, timeout: false, h, base: CORRECT_BASE, score: Math.round(CORRECT_BASE * h), aPoints: 0, bPoints: 0,
      lines: [{ label: 'ตอบถูก', points: CORRECT_BASE }] };
  }
  const A = profileMatch(profiles[guessId], profiles[question.answer]);
  const b = (question.similar || {})[guessId] || 0;
  const lines = [];
  if (b) lines.push({ label: (question.similar_reasons || {})[guessId] || 'มีของคล้ายกัน', points: b });
  lines.push(...A.lines);
  const base = A.points + b;
  return { correct: false, timeout: false, h, base, score: Math.round(base * h), aPoints: A.points, bPoints: b, lines };
}

// Calendar day in Thailand, as YYYY-MM-DD (daily set changes at midnight Asia/Bangkok).
function bangkokDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}
function dayIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - DAY0_UTC) / 86400000);
}
// Start of a Bangkok calendar day, in ms (UTC+7, no DST).
function bangkokDayStartMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - 7 * 3600000;
}
// Same 4 questions for everybody: one per category, in category order.
// A question published during day D joins the rotation from D+1, so publishing in the admin site
// never changes the set of a day that has already started. (No published_at = always eligible.)
function dailySet(questions, categories, dateStr) {
  const idx = dayIndex(dateStr);
  const dayStart = bangkokDayStartMs(dateStr);
  return categories.map(cat => {
    const all = questions.filter(q => q.category === cat).sort((a, b) => a.id < b.id ? -1 : 1);
    const ready = all.filter(q => !q.published_at || Date.parse(q.published_at) < dayStart);
    const pool = ready.length ? ready : all;
    if (!pool.length) return null;
    const fixed = pool.find(q => q.schedule_date === dateStr);
    if (fixed) return fixed;
    const free = pool.filter(q => !q.schedule_date);
    const list = free.length ? free : pool;
    return list[((idx % list.length) + list.length) % list.length];
  }).filter(Boolean);
}

function shareText({ dateLabel, total, max, perCategory, url }) {
  const marks = perCategory.map(c => c.short + ' ' + (c.correct ? '✅' : '❌')).join(' · ');
  return 'ออลไทย ' + dateLabel + ' — ' + total.toLocaleString('en-US') + ' / ' + max.toLocaleString('en-US') + '\n' + marks + (url ? '\n' + url : '');
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

const BLOCKED_NAME_PARTS = ['ควย', 'เหี้ย', 'เหี้ย', 'สัส', 'เย็ด', 'แตด', 'อีดอก', 'ระยำ', 'ชาติหมา', 'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'nigg'];
// Basic nickname filter (handoff §10). Returns the cleaned name, '' for empty, or null when blocked.
function cleanNickname(raw) {
  const s = String(raw || '').replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!s) return '';
  const flat = s.toLowerCase().replace(/[\s._\-]/g, '');
  return BLOCKED_NAME_PARTS.some(w => flat.includes(w)) ? null : s;
}

if (typeof module !== 'undefined') {
  module.exports = { MULTIPLIERS, multiplierFor, profileMatch, scoreAnswer, bangkokDate, dayIndex, dailySet, shareText, rankDaily, rankUnlimited, cleanNickname };
}
