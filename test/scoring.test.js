// V2 rules: distance score, card multiplier, daily set of 5, share marks, ranking, nickname filter.
const assert = require('assert');
const S = require('../src/shared/scoring.js');
const map = require('../data/map.json');
const D = Object.fromEntries(map.districts.map(d => [d.id, d]));
const byName = (n, p) => map.districts.find(d => d.n === n && (!p || d.p === p)).id;

// haversine sanity: Bangkok (Phra Nakhon) → Mueang Chiang Mai ≈ 585 km
const bkk = byName('พระนคร'), cmi = byName('เมืองเชียงใหม่');
const km = S.haversineKm(D[bkk].ll, D[cmi].ll);
assert.ok(km > 560 && km < 610, 'BKK–CNX ' + km);
console.log('พระนคร → เมืองเชียงใหม่', km.toFixed(1), 'km');

// distance curve: monotone, 1000 only when exact, published examples
assert.strictEqual(S.distanceBase(0), 1000);
assert.strictEqual(S.distanceBase(0.01), 999);
assert.strictEqual(S.distanceBase(25), 846);
assert.strictEqual(S.distanceBase(100), 513);
assert.strictEqual(S.distanceBase(300), 135);
for (let k = 1; k < 1600; k += 7) assert.ok(S.distanceBase(k + 7) <= S.distanceBase(k));

// scoring
const q = { answer: byName('หล่มเก่า', 'phetchabun') };
const sc = (g, n, t) => S.scoreAnswer({ question: q, guessId: g, cardsOpened: n || 1, timedOut: !!t, districts: D });
assert.deepStrictEqual([1, 2, 3, 4].map(n => sc(q.answer, n).score), [1000, 800, 600, 400]);
assert.strictEqual(sc(q.answer, 1, true).score, 0);
assert.strictEqual(sc(null).timeout, true);
const near = sc(byName('หล่มสัก', 'phetchabun')), far = sc(byName('เมืองยะลา', 'yala'));
assert.ok(!near.correct && near.km > 5 && near.km < 40 && near.score > 750 && near.score < 1000, JSON.stringify(near));
assert.ok(far.km > 1000 && far.score < 5, JSON.stringify(far));
assert.strictEqual(sc(byName('หล่มสัก', 'phetchabun'), 3).score, Math.round(near.base * 0.6));
console.log('หล่มสัก', S.fmtKm(near.km), 'km →', near.score, '· เมืองยะลา', S.fmtKm(far.km), 'km →', far.score);
// every wrong district scores below a right answer
for (const d of map.districts) if (d.id !== q.answer) assert.ok(sc(d.id).score < 1000);

// daily set: 5 distinct, same for everyone, rotates through the pool before repeating
const pool = Array.from({ length: 12 }, (_, i) => ({ id: 'q-travel-' + String(i + 1).padStart(4, '0') }));
const day = n => S.dailySet(pool, '2026-11-' + String(n).padStart(2, '0'));
assert.strictEqual(day(5).length, 5);
assert.strictEqual(new Set(day(5).map(x => x.id)).size, 5);
assert.deepStrictEqual(day(5).map(x => x.id), S.dailySet(pool.slice().reverse(), '2026-11-05').map(x => x.id), 'order of input does not matter');
const seen = new Set([...day(5), ...day(6)].map(x => x.id));
assert.strictEqual(seen.size, 10, 'two days use 10 different questions');
assert.strictEqual(S.dailySet(pool.slice(0, 3), '2026-11-05').length, 3, 'small pool: no repeats inside a day');
// pinned date first
const pinned = pool.concat([{ id: 'q-travel-0099', schedule_date: '2026-11-07' }]);
assert.strictEqual(S.dailySet(pinned, '2026-11-07')[0].id, 'q-travel-0099');
assert.ok(!S.dailySet(pinned, '2026-11-08').some(x => x.id === 'q-travel-0099'));
// published today → joins tomorrow
const fresh = pool.concat([{ id: 'q-travel-0000', published_at: '2026-11-06T05:00:00Z' }]);
assert.deepStrictEqual(S.dailySet(fresh, '2026-11-06').map(x => x.id), day(6).map(x => x.id));
assert.ok([7, 8, 9].some(n => S.dailySet(fresh, '2026-11-0' + n).some(x => x.id === 'q-travel-0000')));
// Bangkok midnight
assert.strictEqual(S.bangkokDate(new Date('2026-11-05T16:59:00Z')), '2026-11-05');
assert.strictEqual(S.bangkokDate(new Date('2026-11-05T17:00:00Z')), '2026-11-06');

// share text
const text = S.shareText({ dateLabel: '7 พ.ย. 69', total: 3120, max: 5000, url: 'https://example.com',
  results: [{ correct: true, km: 0 }, { km: 12 }, { km: 80 }, { km: 250 }, { timeout: true }] });
assert.ok(text.includes('🎯🟩🟨🟧⬜'));
console.log(text);

// ranking + nickname
assert.deepStrictEqual(S.rankDaily([{ n: 'a', score: 3000, timeMs: 30000 }, { n: 'b', score: 3000, timeMs: 20000 }, { n: 'c', score: 3500, timeMs: 50000 }]).map(e => e.n), ['c', 'b', 'a']);
assert.deepStrictEqual(S.rankUnlimited([{ n: 'a', total: 9000, rounds: 10 }, { n: 'b', total: 9000, rounds: 9 }, { n: 'c', total: 18000, rounds: 20 }]).map(e => e.n), ['c', 'a']);
assert.strictEqual(S.cleanNickname('  น้องฝน  '), 'น้องฝน'); assert.strictEqual(S.cleanNickname('ไอ้ควย'), null);

// map data: 928 districts in 77 provinces, ids unique, every question answer exists
assert.strictEqual(map.districts.length, 928);
assert.strictEqual(new Set(map.districts.map(d => d.p)).size, 77);
assert.strictEqual(new Set(map.districts.map(d => d.id)).size, 928);
const Qs = require('../data/questions.json');
for (const x of Qs.questions) assert.ok(D[x.answer], 'answer district exists for ' + x.id + ': ' + x.answer);
console.log('ALL TESTS PASSED');
