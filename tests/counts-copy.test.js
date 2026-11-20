// F1: the shared Hebrew count helper (singular/dual/plural + gender) over 0/1/2/5 for every noun,
//     plural() post-processing, and the count-bearing user strings (weekly review, summary, insights, hero facts).
// F2: for all 9 notification types, the title and body never duplicate (neither is a substring of the other), with and without facts.
const W = require('../workout-core.js');
const C = require('../wk-copy.js');
let fails = 0; const rec = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const eq = (a, b) => a === b;

// ── F1: hcount over 0 / 1 / 2 / 5 for each noun key ──
const EXP = {
  set: ['0 סטים', 'סט אחד', 'שני סטים', '5 סטים'],
  ex: ['0 תרגילים', 'תרגיל אחד', 'שני תרגילים', '5 תרגילים'],
  rep: ['0 חזרות', 'חזרה אחת', 'שתי חזרות', '5 חזרות'],
  day: ['0 ימים', 'יום אחד', 'יומיים', '5 ימים'],
  workout: ['0 אימונים', 'אימון אחד', 'שני אימונים', '5 אימונים'],
  pr: ['0 שיאים', 'שיא אחד', 'שני שיאים', '5 שיאים'],
  week: ['0 שבועות', 'שבוע אחד', 'שבועיים', '5 שבועות'],
};
Object.keys(EXP).forEach((k) => {
  [0, 1, 2, 5].forEach((n, i) => rec('hcount(' + n + ',' + k + ') = "' + EXP[k][i] + '"', eq(W.hcount(n, k), EXP[k][i]), W.hcount(n, k)));
});

// ── F1: plural() fixes an inline "1/2 <noun>", keeps 0 and 3+ ──
rec('plural: 1 שיאים -> שיא אחד', eq(W.plural('1 שיאים'), 'שיא אחד'));
rec('plural: 2 שיאים -> שני שיאים', eq(W.plural('2 שיאים'), 'שני שיאים'));
rec('plural: 5 שיאים stays', eq(W.plural('5 שיאים'), '5 שיאים'));
rec('plural: 0 אימונים stays', eq(W.plural('0 אימונים'), '0 אימונים'));
rec('plural: 2 חזרות -> שתי חזרות', eq(W.plural('2 חזרות'), 'שתי חזרות'));
rec('plural: 2 שבועות ברצף -> שבועיים ברצף', eq(W.plural('2 שבועות ברצף'), 'שבועיים ברצף'));

// ── F1: the weekly-review count line reads right at 0/1/2/5 PRs (the reported bug "1 שיאים") ──
[[1, 1], [2, 2], [0, 0], [5, 5]].forEach(([n, x]) => {
  const out = W.plural('סקירת שבוע: ' + n + ' אימונים, ' + x + ' שיאים');
  const bad = /\b1 (שיאים|אימונים)\b/.test(out) || /\b2 (שיאים|אימונים)\b/.test(out);
  rec('weekly-review line n=' + n + ' x=' + x + ' is count-correct', !bad, out);
});

// ── F1: summary / insights count builders ──
const S = W.TEXT.ui;
rec('summary muscleSets dual: 2 -> שני סטים', eq(S.muscleSets(2), 'שני סטים') && eq(S.muscleSets(1), 'סט אחד') && eq(S.muscleSets(5), '5 סטים'), S.muscleSets(2));
rec('summary setsLogged dual: 2 -> שני סטים נרשמו', eq(S.setsLogged(2), 'שני סטים נרשמו') && eq(S.setsLogged(1), 'סט אחד נרשם'), S.setsLogged(2));
rec('prR reps dual: 2 -> שתי חזרות', /שתי חזרות/.test(S.prR('חזה', 20, 2, 'ק״ג')) && /חזרה אחת/.test(S.prR('חזה', 20, 1, 'ק״ג')), S.prR('חזה', 20, 2, 'ק״ג'));

// ── F2: title vs body never duplicate, for every notification type, all variant pairings (with facts) + the plain fallback ──
const vars = { muscle: 'חזה', mins: '52', dur: '52', last: '24×8', target: '26 ק״ג', time: '18:00', streak: '3', exercise: 'חזה', lastKg: '24', lastReps: '8', targetKg: '26', done: '2', planned: '3', n: '2', x: '1', insight: 'תקיעות בלחיצת חזה', hint: '52 דק׳, 6 תרגילים' };
const fill = (s) => { try { return C.fill(s, vars); } catch (e) { return '__MISSINGVAR__' + e.message; } };
Object.keys(C.COPY.notify).forEach((type) => {
  const T = C.COPY.notify[type];
  rec(type + ': plain fallback title + body (last variant, no {})', !/\{/.test(T.title[T.title.length - 1]) && !/\{/.test(T.body[T.body.length - 1]), JSON.stringify([T.title[T.title.length - 1], T.body[T.body.length - 1]]));
  const titles = T.title.map(fill), bodies = T.body.map(fill);
  const noVar = [...titles, ...bodies].find((s) => s.indexOf('__MISSINGVAR__') === 0);
  rec(type + ': every variant fills with the standard vars', !noVar, noVar || '');
  let bad = null;
  titles.forEach((t) => bodies.forEach((b) => { if (!bad && (t === b || t.indexOf(b) > -1 || b.indexOf(t) > -1)) bad = { t: t, b: b }; }));
  rec(type + ': no title/body duplication (neither contains the other) across all pairings', !bad, bad ? JSON.stringify(bad) : '');
});

console.log('\n' + (fails ? 'COUNTS-COPY: FAIL (' + fails + ')' : 'COUNTS-COPY: PASS'));
process.exit(fails ? 1 : 0);
