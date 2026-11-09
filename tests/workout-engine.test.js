// node tests/workout-engine.test.js — live workout engine (snap, targets incl. rescale, rest, the reducer by replaying action logs).
// INVENTED numbers only. Runs itself under TZ=Asia/Jerusalem AND TZ=UTC.
const { spawnSync } = require('child_process');
if (!process.env.WK_CHILD) {
  let bad = 0;
  for (const tz of ['Asia/Jerusalem', 'UTC']) {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, WK_CHILD: '1' }, encoding: 'utf8' });
    process.stdout.write(`── TZ=${tz}\n${r.stdout}${r.stderr}`);
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}
const W = require('../workout-core.js');
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push([name, err]); };
const J = (x) => JSON.stringify(x);
const PYR = { sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 };
const DB = { id: 'p1', label: 'חזה', equip: 'dumbbell', unit: 'kg', step: 2, scheme: PYR, startW: 30 };
const BW = { id: 'p0', label: 'מתח', equip: 'bodyweight', unit: null, step: 0, scheme: PYR, startW: null };
const LEG = { id: 'p6', label: 'רגליים', equip: 'machine', unit: 'plates', step: 0.5, scheme: PYR, startW: 8 };
const T0 = Date.UTC(2026, 10, 9, 16, 0);                                 // Mon 9 Nov 2026 18:00 Jerusalem
const PROG = { id: 'prog1', name: 'פול בודי · פירמידה יורדת', exercises: [BW, DB, LEG] };
const start = (extra = {}) => ({ type: 'START', at: T0, program: PROG, locker: 7, ...extra });
const ws = (t) => J(t.map((x) => [x.w, x.aim]));

check('snap: to the step, never below one step; step 0 keeps the value; float-safe', () => {
  const r = [W.snap(21.9, 2), W.snap(23, 2), W.snap(7.3, 0.5), W.snap(17.6, 2.5), W.snap(0.4, 2), W.snap(12.34, 0), W.snap(0.1 + 0.2, 0.1), W.snap(null, 2)];
  return J(r) === J([22, 24, 7.5, 17.5, 2, 12.34, 0.3, null]) ? '' : J(r);
});
check('no history: set 1 = startW, then snap(prev * 0.8) -> 30, 24, 20 (dumbbell, step 2); aims = range bottoms', () => {
  const t = W.targetsFor(DB, null, []); return ws(t) === '[[30,4],[24,6],[20,10]]' && J(t[2].range) === '[10,15]' ? '' : ws(t);
});
check('no history: leg machine in plates (step 0.5): 8, 6.5, 5', () => { const t = W.targetsFor(LEG, null, []); return ws(t) === '[[8,4],[6.5,6],[5,10]]' ? '' : ws(t); });
check('history beats the formula: 26×6 (top of 4-6) -> 28 and back to 4; 24×7 -> 24, aim 8; 20×15 (top) -> 22 aim 10', () => {
  const t = W.targetsFor(DB, [{ w: 26, r: 6 }, { w: 24, r: 7 }, { w: 20, r: 15 }], []); return ws(t) === '[[28,4],[24,8],[22,10]]' ? '' : ws(t);
});
check('history below the range: 26×3 -> same weight, aim the range bottom (4)', () => { const t = W.targetsFor(DB, [{ w: 26, r: 3 }], []); return t[0].w === 26 && t[0].aim === 4 ? '' : J(t[0]); });
check('a missing last slot falls back to the drop from the previous target', () => { const t = W.targetsFor(DB, [{ w: 26, r: 5 }], []); return ws(t) === '[[26,6],[20,6],[16,10]]' ? '' : ws(t); });
check('bodyweight: no weight; history 8 reps in 6-10... aim +1; at the top stays at the top', () => {
  const t = W.targetsFor(BW, [{ w: null, r: 6 }, { w: null, r: 10 }, { w: null, r: 9 }], []); return ws(t) === '[[null,6],[null,10],[null,10]]' ? '' : ws(t);
});
check('rescale: set 1 logged 34 vs target 30 (> one step) -> the rest x34/30, snapped: 28, 22', () => {
  const t = W.targetsFor(DB, null, [{ w: 34, r: 5 }]); return ws(t) === '[[30,4],[28,6],[22,10]]' ? '' : ws(t);
});
check('no rescale within one step: logged 32 vs 30 keeps 24, 20', () => { const t = W.targetsFor(DB, null, [{ w: 32, r: 5 }]); return ws(t.slice(1)) === '[[24,6],[20,10]]' ? '' : ws(t); });
check('an extra set beyond the scheme gets the last range', () => { const t = W.targetsFor(DB, null, [{ w: 30, r: 5 }, { w: 24, r: 8 }, { w: 20, r: 12 }, { w: 18, r: 12 }]); return t.length === 4 && J(t[3].range) === '[10,15]' ? '' : J(t); });
check('rest by reps: <=6 -> 150, 7-10 -> 120, >=11 -> 75; a per-exercise restSec wins', () => {
  const r = [W.restFor(4), W.restFor(6), W.restFor(7), W.restFor(10), W.restFor(11), W.restFor(15), W.restFor(5, { restSec: 90 })];
  return J(r) === J([150, 150, 120, 120, 75, 75, 90]) ? '' : J(r);
});
check('range status: below / in / above', () => J([W.rangeStatus(3, [4, 6]), W.rangeStatus(4, [4, 6]), W.rangeStatus(6, [4, 6]), W.rangeStatus(7, [4, 6])]) === '["below","in","in","above"]' ? '' : 'x');

const LOG = [start(),
  { type: 'LOG_SET', at: T0 + 60e3, ex: 0, w: null, r: 8 }, { type: 'LOG_SET', at: T0 + 200e3, ex: 0, w: null, r: 7 }, { type: 'LOG_SET', at: T0 + 340e3, ex: 0, w: null, r: 6 },
  { type: 'LOG_SET', at: T0 + 500e3, ex: 1, w: 30, r: 5 }];
check('reducer: START copies the program; bodyweight sets have w=null; after 3 sets the next exercise becomes current', () => {
  const s = W.replay(LOG.slice(0, 4)); return s.exercises.length === 3 && s.locker === 7 && s.exercises[0].sets.map((x) => x.w).every((w) => w === null) && s.exIdx === 1 ? '' : J(s);
});
check('reducer: LOG_SET starts the rest from the action time (5 reps -> 150 s); REST_ADJUST ±15; REST_SKIP clears', () => {
  const s = W.replay(LOG); if (s.rest.endsAt !== T0 + 500e3 + 150e3) return J(s.rest);
  const s2 = W.replay([...LOG, { type: 'REST_ADJUST', at: T0 + 510e3, delta: 15 }, { type: 'REST_ADJUST', at: T0 + 511e3, delta: -15 }, { type: 'REST_ADJUST', at: T0 + 512e3, delta: 15 }]);
  const s3 = W.replay([...LOG, { type: 'REST_SKIP', at: T0 + 520e3 }]);
  return s2.rest.endsAt === T0 + 665e3 && s3.rest === null ? '' : J([s2.rest, s3.rest]);
});
check('reducer: REST_ADJUST never moves the end before "now" (clock guard)', () => { const s = W.replay([...LOG, { type: 'REST_ADJUST', at: T0 + 640e3, delta: -60 }]); return s.rest.endsAt === T0 + 640e3 ? '' : J(s.rest); });
check('UNDO pops the last action (also the rest it started); START is never undone', () => {
  const s = W.replay([...LOG, { type: 'UNDO' }]); const z = W.replay([start(), { type: 'UNDO' }, { type: 'UNDO' }]);
  return s.exercises[1].sets.length === 0 && s.rest.endsAt === T0 + 340e3 + 150e3 && z && z.exercises.length === 3 ? '' : J([s.exercises[1], s.rest, z]);
});
check('EDIT_SET / DELETE_SET change only that set; bodyweight ignores a weight', () => {
  const s = W.replay([...LOG, { type: 'EDIT_SET', at: T0 + 1, ex: 1, i: 0, w: 32, r: 4 }, { type: 'EDIT_SET', at: T0 + 2, ex: 0, i: 0, w: 10, r: 9 }, { type: 'DELETE_SET', at: T0 + 3, ex: 0, i: 2 }]);
  return J(s.exercises[1].sets.map((x) => [x.w, x.r])) === '[[32,4]]' && J(s.exercises[0].sets.map((x) => [x.w, x.r])) === '[[null,9],[null,7]]' ? '' : J(s.exercises.map((e) => e.sets));
});
check('SKIP_EXERCISE moves on; ADD_EXERCISE appends and becomes current', () => {
  const s = W.replay([start(), { type: 'SKIP_EXERCISE', at: T0 + 1, ex: 0 }, { type: 'ADD_EXERCISE', at: T0 + 2, exercise: { label: 'בטן', equip: 'bodyweight' } }]);
  return s.exercises[0].skipped && s.exercises.length === 4 && s.exIdx === 3 && s.exercises[3].step === 0 && s.exercises[3].unit === null ? '' : J(s);
});
check('tolerant replay: junk, unknown types, bad indexes and a missing START are ignored, never throw', () => {
  const s = W.replay([null, 5, { type: 'NOPE' }, start(), { type: 'LOG_SET', ex: 9, r: 5 }, { type: 'LOG_SET', ex: 1, w: 30 }, { foo: 1 }, { type: 'LOG_SET', at: T0 + 9, ex: 1, w: 30, r: 5 }]);
  const n = W.replay([{ type: 'LOG_SET', ex: 0, r: 5 }]); const x = W.replay('garbage');
  return s.exercises[1].sets.length === 1 && n === null && x === null ? '' : J([s && s.exercises.map((e) => e.sets.length), n, x]);
});
check('RESUME = replay: replaying the saved log twice gives the same state (deterministic)', () => J(W.replay(LOG)) === J(W.replay(JSON.parse(J(LOG)))) ? '' : 'differs');
check('FINISH -> sessionFromLive: date in Jerusalem, type = program name, only exercises with sets, sets {w,r,t}, source live, duration', () => {
  const s = W.sessionFromLive(W.replay([...LOG, { type: 'FINISH', at: T0 + 3600e3, effort: 4 }]));
  return s.date === '2026-11-09' && s.type === PROG.name && s.locker === 7 && s.exercises.length === 2 && J(s.exercises[1].sets) === J([{ w: 30, r: 5, t: T0 + 500e3 }]) && s.source === 'live' && s.effort === 4 && s.durationSec === 3600 && s.hash === W.hashOf(s) ? '' : J(s);
});
check('durations never go negative (clock moved back)', () => W.durationSec(W.replay([start()]), T0 - 5000) === 0 ? '' : 'neg');
check('the next session progresses: today 30×6 (top) -> next target 32 for set 1', () => {
  const s = W.sessionFromLive(W.replay([start(), { type: 'LOG_SET', at: T0 + 9, ex: 1, w: 30, r: 6 }, { type: 'FINISH', at: T0 + 99 }]));
  const last = W.lastTimeBefore([{ id: 'x', ...s }], 'חזה', '2026-11-12'); const t = W.targetsFor(DB, last.sets, []);
  return t[0].w === 32 && t[0].aim === 4 ? '' : J(t);
});

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
