// node tests/wk-insights.test.js — WkInsights: the 5 types, edge cases (flexible programs, kg/lb, missing sets,
// test-mode excluded, determinism), no-network, fail-soft, and perf. INVENTED data. TZ=Asia/Jerusalem AND UTC.
const { spawnSync } = require('child_process');
if (!process.env.WK_CHILD) {
  let bad = 0;
  for (const tz of ['Asia/Jerusalem', 'UTC']) {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, WK_CHILD: '1' }, encoding: 'utf8' });
    process.stdout.write(`── TZ=${tz}\n${r.stdout}${r.stderr}`); if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}
const W = require('../workout-core.js'), I = require('../wk-insights.js');
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push([name, err]); };
const J = (x) => JSON.stringify(x);
const TZ = 'Asia/Jerusalem';
const NOW = Date.UTC(2026, 10, 2, 8, 0);                                 // Mon 2 Nov 2026 10:00 Jerusalem
const d = (wk) => '2026-10-' + String(wk).padStart(2, '0');
const S = (date, ex) => ({ id: date, date, dateStr: date + 'T18:00:00.000Z', source: 'live', exercises: ex });
const chest = (w, r, sets, unit) => ({ label: 'חזה', unit: unit || 'kg', muscle: 'chest', sets: Array.from({ length: sets || 1 }, () => ({ w, r })) });
const of = (h, t) => h.compute ? null : (h.insights.filter((i) => i.type === t)[0] || null);
const get = (res, t) => res.insights.filter((i) => i.type === t)[0] || null;

// ── empty / minimum data ──
check('empty state: below MIN_SESSIONS -> empty with needMore, no insights', () => {
  const r = I.compute([S(d(30), [chest(20, 6, 3)]), S(d(23), [chest(20, 6, 3)])], NOW, { tz: TZ });
  return r.empty && r.needMore === I.CONST.MIN_SESSIONS - 2 && !r.insights.length ? '' : J({ empty: r.empty, needMore: r.needMore });
});
// ── plateau ──
check('plateau: same top e1RM across 3 consecutive sessions -> insight + action "+1 rep on the first set"', () => {
  const r = I.compute([S(d(30), [chest(20, 6, 3)]), S(d(23), [chest(20, 6, 3)]), S(d(16), [chest(20, 6, 3)])], NOW, { tz: TZ });
  const p = get(r, 'plateau');
  return p && p.severity === 2 && /חזה/.test(p.headline) && p.action.kind === 'addToBrief' && J(p.action.suggest) === J({ w: 20, r: 7 }) ? '' : J(p);
});
check('plateau: progress (e1RM rising) -> no plateau', () => {
  const r = I.compute([S(d(30), [chest(24, 6, 3)]), S(d(23), [chest(22, 6, 3)]), S(d(16), [chest(20, 6, 3)])], NOW, { tz: TZ });
  return !get(r, 'plateau') ? '' : 'false plateau';
});
check('plateau flexible: bodyweight (no kg) stalls on reps -> +1 rep suggestion', () => {
  const bw = (r) => ({ label: 'מתח', unit: null, muscle: 'back', sets: [{ w: null, r }] });
  const res = I.compute([S(d(30), [bw(8)]), S(d(23), [bw(8)]), S(d(16), [bw(8)])], NOW, { tz: TZ });
  const p = get(res, 'plateau');
  return p && J(p.action.suggest) === J({ w: null, r: 9 }) ? '' : J(p);
});
// ── trend (kg, lb) ──
check('trend: e1RM over 8 weeks gives percent change + sparkline; works in lb too', () => {
  const mk = (u) => I.compute([S(d(30), [chest(24, 6, 3, u)]), S(d(16), [chest(22, 6, 3, u)]), S(d(2), [chest(20, 6, 3, u)])], NOW, { tz: TZ });
  const kg = get(mk('kg'), 'trend'), lb = get(mk('lb'), 'trend');
  return kg && kg.spark.length === 3 && kg.pct > 0 && lb && lb.pct === kg.pct ? '' : J([kg, lb]);
});
// ── balance ──
check('balance: weekly sets under 10 and over 20 vs the range', () => {
  const under = I.compute([S(d(30), [chest(20, 6, 3)]), S(d(23), [chest(20, 6, 3)]), S(d(16), [chest(20, 6, 3)])], Date.UTC(2026, 9, 30, 8), { tz: TZ });
  const over = I.compute([S(d(30), [chest(20, 6, 24)]), S(d(23), [chest(20, 6, 3)]), S(d(16), [chest(20, 6, 3)])], Date.UTC(2026, 9, 30, 8), { tz: TZ });
  const u = get(under, 'balance'), o = get(over, 'balance');
  return u && u.dir === 'under' && o && o.dir === 'over' ? '' : J([u && u.dir, o && o.dir]);
});
// ── fatigue ──
check('fatigue: >=25% volume drop vs the prior week -> deload suggestion', () => {
  const hi = [chest(20, 10, 6)], lo = [chest(10, 6, 3)];
  const r = I.compute([S('2026-10-26', lo), S('2026-10-19', hi), S('2026-10-12', hi)], Date.UTC(2026, 9, 27, 8), { tz: TZ });
  const f = get(r, 'fatigue');
  return f && f.severity === 3 && /הקלה|דילוד/.test(f.headline + f.detail) ? '' : J(f);
});
// ── test-mode excluded, missing sets, determinism ──
check('test-mode sessions are excluded; an exercise with no sets is ignored', () => {
  const t = Object.assign(S(d(29), [chest(99, 1, 9)]), { test: true });
  const empty = S(d(28), [{ label: 'חזה', unit: 'kg', muscle: 'chest', sets: [] }]);
  const r = I.compute([t, empty, S(d(30), [chest(20, 6, 3)]), S(d(23), [chest(20, 6, 3)]), S(d(16), [chest(20, 6, 3)])], NOW, { tz: TZ });
  const p = get(r, 'plateau');
  return p && !/99/.test(p.evidence) ? '' : 'test or empty leaked';
});
check('determinism: same input -> identical output', () => {
  const h = [S(d(30), [chest(20, 6, 3)]), S(d(23), [chest(20, 6, 3)]), S(d(16), [chest(20, 6, 3)])];
  return J(I.compute(h, NOW, { tz: TZ, fresh: true }).insights) === J(I.compute(h, NOW, { tz: TZ, fresh: true }).insights) ? '' : 'non-deterministic';
});
// ── no network ──
check('NO network: compute touches no fetch / XHR', () => {
  const g = globalThis; const sf = g.fetch, sx = g.XMLHttpRequest;
  let hit = false; g.fetch = () => { hit = true; throw new Error('net'); }; g.XMLHttpRequest = function () { hit = true; throw new Error('net'); };
  try { I.compute([S(d(30), [chest(20, 6, 3)]), S(d(23), [chest(20, 6, 3)]), S(d(16), [chest(20, 6, 3)])], NOW, { tz: TZ, fresh: true }); } finally { g.fetch = sf; g.XMLHttpRequest = sx; }
  return hit ? 'called network' : '';
});
// ── fail-soft ──
check('fail-soft: a malformed session never throws, returns a neutral result', () => {
  const r = I.compute([{ bad: true }, null, S(d(30), [chest(20, 6, 3)]), S(d(23), [chest(20, 6, 3)]), S(d(16), [chest(20, 6, 3)])], NOW, { tz: TZ, fresh: true });
  return r && Array.isArray(r.insights) ? '' : 'threw';
});
// ── perf ──
check('perf: <= 50 ms on 500 invented sessions', () => {
  const big = []; for (let i = 0; i < 500; i++) big.push(S('2026-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 27)).padStart(2, '0'), [chest(20 + (i % 10), 6, 3), { label: 'מתח', unit: null, muscle: 'back', sets: [{ w: null, r: 8 }] }]));
  const t = Date.now(); I.compute(big, NOW, { tz: TZ, fresh: true }); const ms = Date.now() - t;
  return ms <= 50 ? '' : 'took ' + ms + 'ms';
});
// ── citations present ──
check('every constant has a verified citation or is marked heuristic', () => {
  const C = I.CITATIONS;
  return /Schoenfeld/.test(C.volume) && /ACSM/.test(C.progression) && /Epley/.test(C.e1rm) && /heuristic/.test(C.plateau) && /heuristic/.test(C.fatigue) ? '' : J(Object.keys(C));
});

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
