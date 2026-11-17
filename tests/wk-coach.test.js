// node tests/wk-coach.test.js — the live-coach table (wk-coach.js): judge, line(), lengths, banned words. Copy text is never edited here.
const C = require('../wk-coach.js');
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push([name, err]); };
const J = (x) => JSON.stringify(x);
const LRI = '⁦', PDI = '⁩', iso = (s) => LRI + s + PDI;
const V = { target: iso('28×8'), done: iso('26×8'), pr: 'חזה ' + iso('30×3'), n: iso('2'), rest: iso('90') };
const BAN = /אשם|עצלן|עצלות|כישלון|נכשלת|פספסת|התבטלת|בושה|חבל שלא|למה לא|אכזבת|חלש|פתטי|מגעיל|מאכזב|מביך/;
// polish 1 · S5: no pressure / gimmick phrasing (facts first, one restrained human line)
const PRESSURE = /אתה יכול יותר|זה לא הרף שלך|זה לא כל מה שיש לך|למה מחכים|תן הכל|אל תחסוך|בלי מיקוח|לא באנו|תחזור חזק|עכשיו תרצה|אפשר יותר|אל תרפה|לא עוצרים|הכל על השולחן|לך על זה|!/;
const visible = (s) => s.replace(/[⁦-⁩]/g, '');

check('judge: exceed / met / under on reps; weight-only and reps-only differences; bodyweight (w null)', () => {
  const r = [C.judge({ w: 28, r: 8 }, { w: 28, r: 9 }), C.judge({ w: 28, r: 8 }, { w: 28, r: 8 }), C.judge({ w: 28, r: 8 }, { w: 28, r: 7 }),
    C.judge({ w: 28, r: 8 }, { w: 30, r: 8 }), C.judge({ w: 28, r: 8 }, { w: 26, r: 8 }), C.judge({ w: null, r: 8 }, { w: null, r: 9 }), C.judge({ w: null, r: 8 }, { w: null, r: 6 })];
  return J(r) === J(['exceed', 'met', 'under', 'exceed', 'under', 'exceed', 'under']) ? '' : J(r);
});
check('judge: a combined set is judged on its TOTAL reps (the caller passes r = total): 6+5 = 11 vs 8 -> exceed', () => C.judge({ w: 28, r: 8 }, { w: 28, r: 11 }) === 'exceed' ? '' : 'x');
check('judge: a null target returns "met" — so the CALLER must not judge without a target (WCore.coachMoment skips it)', () => C.judge(null, { w: 5, r: 5 }) === 'met' && C.judge({ w: 5, r: 5 }, null) === 'met' ? '' : 'x');
check('modes: calm / coach / fire each with a label, a hint and 3+ variants for every kind; default = coach', () => {
  const bad = []; ['calm', 'coach', 'fire'].forEach((m) => { if (!C.MODES[m].label || !C.MODES[m].hint) bad.push(m); C.KINDS.forEach((k) => { if (!(C.MODES[m][k] && new Set(C.MODES[m][k]).size >= 3)) bad.push(m + '.' + k); }); });
  return bad.length ? J(bad) : C.DEFAULT === 'coach' ? '' : 'default';
});
check('every line fits the slot: <= 62 visible chars after fill (isolates not counted); no banned shaming words; no pressure / gimmick phrasing or "!"; no emoji', () => {
  const bad = [];
  ['calm', 'coach', 'fire'].forEach((m) => C.KINDS.forEach((k) => C.MODES[m][k].forEach((t) => { const r = visible(C.fill(t, V)); if (r.length > 62) bad.push(`long ${m}.${k}: ${r}`); if (PRESSURE.test(r)) bad.push(`pressure ${m}.${k}: ${r}`); if (BAN.test(r)) bad.push(`ban ${m}.${k}: ${r}`); if (/\p{Extended_Pictographic}/u.test(r)) bad.push(`emoji ${m}.${k}`); })));
  return bad.join(' | ');
});
check('line(): only variants whose placeholders exist; no "{" ever returned; empty when none can be filled', () => {
  for (let i = 0; i < 300; i++) { const r = C.line('coach', 'under', { target: iso('28×8') }, -1); if (!r.text || r.text.includes('{')) return 'under: ' + r.text; }
  const none = C.line('fire', 'start', {}, -1), noTarget = C.line('coach', 'under', {}, -1);
  for (let i = 0; i < 300; i++) { const r = C.line('coach', 'start', {}, -1); if (r.text.includes('{')) return 'start leaked: ' + r.text; }
  return none.text === '' && noTarget.text === '' ? '' : J([none, noTarget]);
});
check('line(): never the same index twice in a row (5000 draws, every mode and kind with full vars)', () => {
  for (const m of ['calm', 'coach', 'fire']) for (const k of C.KINDS) { let last = -1; for (let i = 0; i < 300; i++) { const r = C.line(m, k, V, last); if (r.index === last) return m + '.' + k; last = r.index; } }
  return '';
});
check('line(): an unknown mode falls back to the coach table', () => { const r = C.line('nope', 'finish', {}, -1); return r.text && C.MODES.coach.finish.includes(r.text) ? '' : J(r); });

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
