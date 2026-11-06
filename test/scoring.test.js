const assert = require('assert');
const S = require('../src/shared/scoring.js');
const P = Object.fromEntries(require('../data/provinces.json').provinces.map(p => [p.id, p]));
const Qs = require('../data/questions.json');
// handoff §7 example: วิ่งควาย (answer ชลบุรี), 1 card open
const wingKhwai = { answer: 'chonburi', similar: { phetchaburi: 500 }, similar_reasons: { phetchaburi: 'มีประเพณีวัวลานคล้ายวิ่งควาย' } };
const r = id => S.scoreAnswer({ question: wingKhwai, guessId: id, cardsOpened: 1, timedOut: false, profiles: P });
const show = (id, x) => console.log(id.padEnd(12), 'A', String(x.aPoints).padStart(3), 'B', String(x.bPoints).padStart(3), '=', x.score, '|', x.lines.map(l => l.label + ' +' + l.points).join(' ; '));
['chonburi', 'phetchaburi', 'bangkok', 'yala', 'rayong'].forEach(id => show(id, r(id)));
assert.strictEqual(r('chonburi').score, 1000);
assert.strictEqual(r('yala').score, 0);
assert.ok(r('phetchaburi').score >= 500 && r('phetchaburi').score <= 900);
// max A+B can never beat a correct answer
for (const a of Object.keys(P)) for (const g of Object.keys(P)) if (a !== g) {
  const x = S.scoreAnswer({ question: { answer: a, similar: { [g]: 500 } }, guessId: g, cardsOpened: 1, timedOut: false, profiles: P });
  assert.ok(x.base <= 900, a + ' ' + g);
}
// multipliers + rounding
assert.deepStrictEqual([1, 2, 3, 4].map(n => S.scoreAnswer({ question: wingKhwai, guessId: 'chonburi', cardsOpened: n, profiles: P }).score), [1000, 800, 600, 400]);
assert.strictEqual(S.scoreAnswer({ question: wingKhwai, guessId: 'phetchaburi', cardsOpened: 3, profiles: P }).score, Math.round(r('phetchaburi').base * 0.6));
assert.strictEqual(S.scoreAnswer({ question: wingKhwai, guessId: 'chonburi', cardsOpened: 1, timedOut: true, profiles: P }).score, 0);
// daily set: 4 questions, one per category, same for everyone on a date, rotates daily
const play = Qs.questions;
const d1 = S.dailySet(play, Qs.categories, '2026-11-05'), d2 = S.dailySet(play, Qs.categories, '2026-11-06'), d4 = S.dailySet(play, Qs.categories, '2026-11-08');
assert.strictEqual(d1.length, 4); assert.deepStrictEqual(d1.map(q => q.category), Qs.categories);
assert.notDeepStrictEqual(d1.map(q => q.id), d2.map(q => q.id)); assert.deepStrictEqual(d1.map(q => q.id), d4.map(q => q.id));
console.log('daily 2026-11-05', d1.map(q => q.topic).join(' | '));
console.log('daily 2026-11-06', d2.map(q => q.topic).join(' | '));
// Bangkok midnight boundary: 2026-11-05T16:59Z = 23:59 BKK (5th), 17:00Z = 00:00 BKK (6th)
assert.strictEqual(S.bangkokDate(new Date('2026-11-05T16:59:00Z')), '2026-11-05');
assert.strictEqual(S.bangkokDate(new Date('2026-11-05T17:00:00Z')), '2026-11-06');
// share text
console.log(S.shareText({ dateLabel: '5 พ.ย. 69', total: 3060, max: 4000, perCategory: [{ short: 'อาหาร', correct: true }, { short: 'กีฬา', correct: false }, { short: 'เทศกาล', correct: true }, { short: 'ท่องเที่ยว', correct: true }], url: 'https://example.com' }));
// ranking
assert.deepStrictEqual(S.rankDaily([{ n: 'a', score: 3000, timeMs: 30000 }, { n: 'b', score: 3000, timeMs: 20000 }, { n: 'c', score: 3500, timeMs: 50000 }]).map(e => e.n), ['c', 'b', 'a']);
assert.deepStrictEqual(S.rankUnlimited([{ n: 'a', total: 9000, rounds: 10 }, { n: 'b', total: 9000, rounds: 9 }, { n: 'c', total: 18000, rounds: 20 }]).map(e => e.n), ['c', 'a']);
// nickname filter
assert.strictEqual(S.cleanNickname('  น้องฝน  '), 'น้องฝน'); assert.strictEqual(S.cleanNickname('ไอ้ควย'), null); assert.strictEqual(S.cleanNickname('<b>x</b>'), 'bx/b');
// every question: answer + similar ids exist, wrong answers never exceed 900
for (const q of play) for (const g of Object.keys(P)) if (g !== q.answer) assert.ok(S.scoreAnswer({ question: q, guessId: g, cardsOpened: 1, profiles: P }).base <= 900);
// publishing mid-day must not change that day's set: a question published on 6 Nov (BKK) joins from 7 Nov
const extra = Object.assign({}, play.find(q => q.category === 'อาหาร'), { id: 'q-food-0000', published_at: '2026-11-06T03:00:00Z' });
const withNew = play.concat([extra]);
assert.deepStrictEqual(S.dailySet(withNew, Qs.categories, '2026-11-06').map(q => q.id), d2.map(q => q.id));
assert.ok(S.dailySet(withNew, Qs.categories, '2026-11-07').length === 4);
const seen = new Set(); for (let i = 7; i < 11; i++) seen.add(S.dailySet(withNew, Qs.categories, '2026-11-' + String(i).padStart(2, '0'))[0].id);
assert.ok(seen.has('q-food-0000'), 'new question enters the rotation after its publish day');
// 23:59 BKK on the 6th (16:59Z) is still the 6th → not eligible on the 6th; 00:00 BKK on the 7th (17:00Z of the 6th) → eligible on the 7th? no: published on the 7th → from the 8th
const late = Object.assign({}, extra, { published_at: '2026-11-06T16:59:00Z' });
assert.ok(!S.dailySet(play.concat([late]), ['อาหาร'], '2026-11-06').some(q => q.id === late.id));
// a brand-new category with only today's questions still gets a question (no empty daily)
assert.strictEqual(S.dailySet([extra], ['อาหาร'], '2026-11-06').length, 1);
console.log('ALL TESTS PASSED');
