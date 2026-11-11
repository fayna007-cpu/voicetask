// node tests/workout-programs.test.js — Milestone A pure logic: HOME card state, the program reader (M1a wrap), day rotation,
// rep-range validation, warm-up sets, PR / e1RM, the coach + card string table, and the silent routine completion (index.html).
// INVENTED data only. Runs itself under TZ=Asia/Jerusalem AND TZ=UTC.
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
const fs = require('fs'), path = require('path');
const W = require('../workout-core.js');
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push([name, err]); };
const J = (x) => JSON.stringify(x);
const at = (d, hh, mm = 0) => Date.UTC(2026, 10, d, hh - 2, mm);          // Jerusalem wall time, Nov 2026 (UTC+2)
const iso = (d, hh, mm) => new Date(at(d, hh, mm)).toISOString();
const NOW = at(4, 10);                                                    // Wed 4 Nov 2026 10:00

// ── card state ──
check('card state: far (>1 day) / tomorrow / today-locked until T-30 / open from T-30 / progress / done', () => {
  const s = (dt, o = {}) => W.cardState({ now: NOW, dt, ...o });
  const r = [s(iso(7, 18)), s(iso(5, 18)), s(iso(4, 18)), s(iso(4, 10, 29)), s(iso(4, 10, 30)), s(iso(4, 10, 31)), s(iso(4, 9)), s(iso(4, 18), { inProgress: true }), s(iso(4, 18), { completed: true })];
  return J(r) === J(['far', 'tomorrow', 'locked', 'open', 'open', 'locked', 'open', 'progress', 'done']) ? '' : J(r);
});
check('card state: routine.wkUnlockMin moves the unlock; yesterday -> null (the missed/postpone flow owns it)', () => {
  const r = [W.cardState({ now: NOW, dt: iso(4, 11), unlockMin: 60 }), W.cardState({ now: NOW, dt: iso(4, 11), unlockMin: 30 }), W.cardState({ now: NOW, dt: iso(3, 18) }), W.cardState({ now: NOW, dt: iso(3, 18), inProgress: true }), W.cardState(null)];
  return J(r) === J(['open', 'locked', null, null, null]) ? '' : J(r);
});
check('card state: 23:59 today is still open; after midnight null', () => J([W.cardState({ now: at(4, 23, 59), dt: iso(4, 18) }), W.cardState({ now: at(5, 0, 1), dt: iso(4, 18) })]) === J(['open', null]) ? '' : 'x');

// ── program reader ──
const M1A = { v: 1, activeId: 'p1', programs: [{ id: 'p1', name: 'פול בודי · פירמידה יורדת', exercises: [{ id: 'e1', label: 'חזה', equip: 'dumbbell', unit: 'kg', step: 2, scheme: { sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 }, startW: 16 }] }] };
check('reader: the M1a shape is wrapped into ONE day (exercises kept as-is), goal strength; the input object is not modified', () => {
  const before = J(M1A), r = W.readPrograms(M1A), p = r.programs[0];
  return r.activeId === 'p1' && p.days.length === 1 && p.days[0].id === 'p1_d1' && p.days[0].exercises[0].startW === 16 && p.goal === 'strength' && J(M1A) === before ? '' : J(r);
});
check('reader: a bare array, unknown activeId, junk entries and a bad goal are tolerated', () => {
  const r = W.readPrograms([null, 5, { name: 'no id' }, { id: 'a', name: 'A', goal: 'nope', days: [{ name: 'X', exercises: [{ label: 'x' }, null, { foo: 1 }] }, 'junk'] }]);
  const z = W.readPrograms(null), y = W.readPrograms({ activeId: 'zz', programs: [{ id: 'b', days: [] }] });
  return r.programs.length === 1 && r.activeId === 'a' && r.programs[0].goal === 'general' && r.programs[0].days.length === 1 && r.programs[0].days[0].exercises.length === 1 && z.programs.length === 0 && z.activeId === null && y.activeId === 'b' ? '' : J([r, z, y]);
});

// ── rotation ──
const P3 = { id: 'ppl', days: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }], lastDay: null };
check('rotation: no history -> day 1; after d1 -> d2; after d3 -> d1; only this program counts; lastDay is the fallback', () => {
  const ses = (list) => list.map(([id, date, dayId, pid]) => ({ id, date, dayId, programId: pid || 'ppl' }));
  const r = [W.nextDay(P3, []).id, W.nextDay(P3, ses([['a', '2026-11-01', 'd1']])).id, W.nextDay(P3, ses([['a', '2026-11-01', 'd1'], ['b', '2026-11-03', 'd3']])).id,
    W.nextDay(P3, ses([['a', '2026-11-01', 'd1'], ['b', '2026-11-03', 'd2', 'other']])).id, W.nextDay({ ...P3, lastDay: 'd2' }, []).id, W.nextDay({ ...P3, lastDay: 'gone' }, []).id, W.nextDay({ id: 'e', days: [] }, [])];
  return J(r) === J(['d1', 'd2', 'd1', 'd2', 'd3', 'd1', null]) ? '' : J(r);
});

// ── rep ranges ──
check('range picker: min < max, 1-30, whole numbers; clampRange keeps the side just changed', () => {
  const v = [[4, 6], [6, 6], [0, 5], [5, 31], [4.5, 6], [6, 4], 'x'].map(W.rangeValid);
  const c = [W.clampRange(7, 6, 'lo'), W.clampRange(6, 5, 'hi'), W.clampRange(30, 30, 'lo'), W.clampRange(1, 1, 'hi'), W.clampRange(-3, 99, 'lo'), W.clampRange(8, 12, 'hi')];
  return J(v) === J([true, false, false, false, false, false, false]) && J(c) === J([[7, 8], [4, 5], [29, 30], [1, 2], [1, 30], [8, 12]]) ? '' : J([v, c]);
});
check('schemes: desc 4-6/6-10/10-15 drop 20%; straight = one range x sets; asc = reversed, rising; goal defaults (strength 3-6/4-8/6-10)', () => {
  const d = W.schemeFor('desc', 'general'), s = W.schemeFor('straight', 'hypertrophy', { sets: 4 }), a = W.schemeFor('asc', 'strength'), g = W.goalScheme('strength'), c = W.schemeFor('custom', 'general', { sets: 2, ranges: [[5, 7], [9, 11]], drop: 0.1 });
  return J(d.ranges) === '[[4,6],[6,10],[10,15]]' && d.drop === 0.2 && s.sets === 4 && J(s.ranges) === '[[6,12],[6,12],[6,12],[6,12]]' && s.drop === 0 && J(a.ranges) === '[[10,15],[6,10],[4,6]]' && a.drop < 0
    && J(g.ranges) === '[[3,6],[4,8],[6,10]]' && W.GOALS.strength.rest === 150 && W.GOALS.hypertrophy.rest === 90 && W.GOALS.general.rest === 75 && c.type === 'custom' && J(c.ranges) === '[[5,7],[9,11]]' ? '' : J([d, s, a, g, c]);
});
check('setSets grows by copying the last range and shrinks by cutting', () => J([W.setSets({ sets: 2, ranges: [[4, 6], [6, 10]] }, 4).ranges, W.setSets({ sets: 3, ranges: [[4, 6], [6, 10], [10, 15]] }, 1).ranges]) === J([[[4, 6], [6, 10], [6, 10], [6, 10]], [[4, 6]]]) ? '' : 'x');
check('ascending pyramid targets rise (drop -20%): 20 -> 24 -> 28.8 snapped to 2 -> 28', () => { const t = W.targetsFor({ equip: 'dumbbell', step: 2, startW: 20, scheme: W.schemeFor('asc') }, null, []); return J(t.map((x) => x.w)) === '[20,24,28]' ? '' : J(t); });
check('goal rest: hypertrophy 90 s and general 75 s whatever the reps; strength keeps the reps rule; an override wins', () => J([W.restFor(5, {}, 'hypertrophy'), W.restFor(12, {}, 'general'), W.restFor(5, {}, 'strength'), W.restFor(12, {}, 'strength'), W.restFor(5, { restSec: 100 }, 'general')]) === J([90, 75, 150, 75, 100]) ? '' : 'x');
check('light day: targets x0.9 snapped; short day: START cuts every exercise to 2 sets', () => {
  const t = W.targetsFor({ equip: 'dumbbell', step: 2, startW: 30, scheme: W.schemeFor('desc') }, null, [], { scale: 0.9 });
  const s = W.replay([{ type: 'START', at: NOW, mode: 'short', program: { id: 'p', name: 'P', exercises: [{ label: 'a', scheme: W.schemeFor('desc') }] } }]);
  return J(t.map((x) => x.w)) === '[28,22,18]' && s.exercises[0].scheme.sets === 2 && s.mode === 'short' ? '' : J([t, s && s.exercises[0].scheme]);
});

// ── warm-up ──
check('warm-up: 40% x 8, 60% x 5, 80% x 3 of the target, snapped; none for bodyweight / no target; duplicates dropped', () => {
  const r = [W.warmupSets(26, 2), W.warmupSets(8, 0.5), W.warmupSets(null, 2), W.warmupSets(20, 0), W.warmupSets(4, 2)];
  return J(r) === J([[{ w: 10, r: 8 }, { w: 16, r: 5 }, { w: 20, r: 3 }], [{ w: 3, r: 8 }, { w: 5, r: 5 }, { w: 6.5, r: 3 }], [], [], [{ w: 2, r: 8 }]]) ? '' : J(r);
});

// ── PRs ──
const sess = (id, date, ex) => ({ id, date, exercises: ex.map(([label, unit, sets]) => ({ label, unit, sets: sets.map(([w, r]) => ({ w, r })) })) });
check('e1RM (Epley) only from 2-10 reps', () => J([W.e1rm(26, 6), W.e1rm(26, 1), W.e1rm(26, 11), W.e1rm(null, 5), W.e1rm(100, 10)]) === J([31.2, null, null, null, 133.3]) ? '' : 'x');
check('PR kg: a higher e1RM than ever before; first time = no PR; an equal one = no PR', () => {
  const h = [sess('a', '2026-11-01', [['חזה', 'kg', [[26, 6], [24, 7]]]])];
  const r1 = W.prsFor(sess('b', '2026-11-04', [['חזה', 'kg', [[26, 8]]]]), h), r2 = W.prsFor(sess('c', '2026-11-04', [['כתפיים', 'kg', [[10, 10]]]]), h), r3 = W.prsFor(sess('d', '2026-11-04', [['חזה', 'kg', [[26, 6]]]]), h);
  return r1.length === 1 && r1[0].kind === 'e1rm' && r1[0].value === 32.9 && r1[0].prev === 31.2 && !r2.length && !r3.length ? '' : J([r1, r2, r3]);
});
check('PR non-kg: best reps at the SAME load (plates / bodyweight); a different load is no PR; the session itself never counts', () => {
  const h = [sess('a', '2026-11-01', [['רגליים', 'plates', [[7, 8], [6, 10]]], ['מתח', null, [[null, 8]]]])];
  const s = sess('b', '2026-11-04', [['רגליים', 'plates', [[7, 9], [8, 12]]], ['מתח', null, [[null, 10]]]]);
  const r = W.prsFor(s, [...h, s]);
  return J(r.map((p) => [p.label, p.kind, p.w, p.r, p.prev])) === J([['רגליים', 'reps', 7, 9, 8], ['מתח', 'reps', null, 10, 8]]) ? '' : J(r);
});

// ── string table ──
check('card table: every state has 3+ variants; every placeholder used is provided by the card', () => {
  const C = W.TEXT.card, allowed = { far: ['days', 'day'], tomorrow: ['time', 'day'], locked: ['time', 'day'], open: ['day'], progress: ['elapsed', 'n', 'day'], done: ['duration', 'n', 'day'], last: ['ex', 'set'], first: ['day'] };
  const bad = Object.keys(allowed).filter((k) => !(C[k].length >= 3) || C[k].some((t) => (t.match(/\{(\w+)\}/g) || []).some((p) => allowed[k].indexOf(p.slice(1, -1)) < 0)));
  return bad.length ? J(bad) : '';
});
check('coach table: 3+ variants per kind; pick never repeats the previous index; the same seed is stable', () => {
  const C = W.TEXT.coach, kinds = ['pr', 'up', 'same', 'first'];
  if (kinds.some((k) => C[k].length < 3)) return 'few variants';
  for (let seed = 0; seed < 200; seed++) { const a = W.pick(C.up, 's' + seed), b = W.pick(C.up, 's' + seed, a.i); if (b.i === a.i || W.pick(C.up, 's' + seed).i !== a.i) return 'seed ' + seed; }
  return W.fill('{ex}: {val}', { ex: 'חזה', val: '30' }) === 'חזה: 30' && W.fill('{nope}x', {}) === 'x' ? '' : 'fill';
});
check('coach kind: PR > up (more weight or reps on set 1) > same; no history -> first', () => {
  const last = sess('a', '2026-11-01', [['חזה', 'kg', [[26, 6]]]]);
  const r = [W.coachKind(sess('b', 'x', [['חזה', 'kg', [[26, 6]]]]), [{}], last), W.coachKind(sess('b', 'x', [['חזה', 'kg', [[28, 4]]]]), [], last), W.coachKind(sess('b', 'x', [['חזה', 'kg', [[26, 7]]]]), [], last), W.coachKind(sess('b', 'x', [['חזה', 'kg', [[24, 9]]]]), [], last), W.coachKind(sess('b', 'x', []), [], null)];
  return J(r) === J(['pr', 'up', 'up', 'same', 'first']) ? '' : J(r);
});
check('a finished session carries the optional day / routine fields; M1a drafts without them still replay', () => {
  const s = W.sessionFromLive(W.replay([{ type: 'START', at: NOW, dayId: 'd2', dayName: 'משיכה', routineId: '77', dateStr: iso(4, 18), goal: 'hypertrophy', program: { id: 'ppl', name: 'PPL · משיכה', exercises: [{ label: 'מתח', equip: 'bodyweight', step: 0, unit: null }] } }, { type: 'LOG_SET', at: NOW + 1, ex: 0, r: 8 }]));
  const old = W.replay([{ type: 'START', at: NOW, program: { id: 'p1', name: 'P', exercises: [{ label: 'a' }] } }]);
  return s.dayId === 'd2' && s.routineId === '77' && s.dateStr === iso(4, 18) && s.goal === 'hypertrophy' && s.exercises[0].unit === null && old && old.dayId === undefined && old.exercises[0].warmup === false ? '' : J([s, old]);
});

// ── the silent routine completion (index.html toggleRoutineComplete, extracted and run against stubs) ──
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = (html.match(/function toggleRoutineComplete\(routineId,dateStr,opts\)\{[\s\S]*?\n\}/) || [])[0];
const runToggle = (opts, completed) => {
  const log = [], timers = [];
  const r = { id: 7, completedDates: completed ? ['D'] : [], scheduledWeeks: {} };
  const f = new Function('routines', 'vibrate', 'toast', 'saveRoutines', 'render', 'setTimeout', 'openEnergyPopup', 'bumpMissedStat', src + '\nreturn toggleRoutineComplete;')(
    [r], () => log.push('vibrate'), () => log.push('toast'), () => log.push('save'), () => log.push('render'), (fn) => { timers.push(fn); }, () => log.push('energy'), () => {});
  f(7, 'D', opts); timers.forEach((fn) => fn());
  return { log, done: r.completedDates.slice() };
};
check('toggleRoutineComplete: the default path is unchanged (vibrate + toast + the energy popup)', () => { if (!src) return 'not found in index.html'; const a = runToggle(undefined, false); return J(a.done) === '["D"]' && a.log.includes('vibrate') && a.log.includes('energy') ? '' : J(a); });
check('toggleRoutineComplete {silent:true}: completes without vibration and without the energy popup', () => { const a = runToggle({ silent: true }, false); return J(a.done) === '["D"]' && !a.log.includes('vibrate') && !a.log.includes('energy') && a.log.includes('save') ? '' : J(a); });
check('toggleRoutineComplete on a completed instance un-completes it (why the workout calls it ONLY when not completed)', () => { const a = runToggle({ silent: true }, true); return J(a.done) === '[]' ? '' : J(a); });

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
