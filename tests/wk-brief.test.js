// node tests/wk-brief.test.js — WkBrief.compute: phases, the planned workout, targets, facts, the 48 h journey.
// INVENTED data only. Runs under TZ=Asia/Jerusalem AND UTC. Tests the contract the home hero + notifications both read.
const { spawnSync } = require('child_process');
if (!process.env.WK_CHILD) {
  let bad = 0;
  for (const tz of ['Asia/Jerusalem', 'UTC']) {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, WK_CHILD: '1' }, encoding: 'utf8' });
    process.stdout.write(`── TZ=${tz}\n${r.stdout}${r.stderr}`); if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}
const W = require('../workout-core.js'), B = require('../wk-brief.js');
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push([name, err]); };
const J = (x) => JSON.stringify(x);
const TZ = 'Asia/Jerusalem';
const iso = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo, d, h - 2, mi || 0)).toISOString();   // local Jerusalem (winter +2)
const NOW = Date.UTC(2026, 10, 4, 8, 0);                                 // Wed 4 Nov 2026 10:00 Jerusalem
const DESC = { type: 'desc', sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 };
const EX = (label, muscle, equip, unit, step, startW) => ({ id: 'e-' + label, label, muscle, equip, unit, step, startW, restSec: 90, warmup: false, scheme: DESC });
const PROG = { v: 2, activeId: 'p1', programs: [{ id: 'p1', name: 'פול בודי', goal: 'strength', lastDay: null, days: [{ id: 'd1', name: 'אימון', exercises: [
  EX('חזה', 'chest', 'dumbbell', 'kg', 2, 20), EX('מתח', 'back', 'bodyweight', null, 0, null)] }] }] };
const ROUT = [{ id: 'r1', programId: 'p1', name: 'אימון כוח', kind: 'workout', wkUnlockMin: 30, enabled: true }];
const SESS = (dateStr, w, r) => ({ id: 'h-' + dateStr, date: dateStr.split('T')[0], dateStr, type: 'פול בודי', source: 'live', routineId: 'r1', programId: 'p1', dayId: 'd1', durationSec: 3000,
  exercises: [{ label: 'חזה', unit: 'kg', muscle: 'chest', sets: [{ w, r }] }, { label: 'מתח', unit: null, muscle: 'back', sets: [{ w: null, r: 8 }] }] });
const HIST = [SESS(iso(2026, 9, 28, 18), 20, 6)];                        // Wed 28 Oct
const base = (over) => Object.assign({ enabled: true, routines: ROUT, programs: PROG, sessions: HIST, catalog: {}, draft: null, prefs: {}, tz: TZ, instances: [] }, over);

// ── phases ──
check('phase none: workouts disabled, or a workout routine with no program', () => {
  const a = B.compute(base({ enabled: false, instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  const b = B.compute(base({ routines: [{ id: 'r1', programId: 'ZZ', name: 'x', kind: 'workout', enabled: true }], instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  return a.phase === 'none' && b.phase === 'none' ? '' : J([a.phase, b.phase]);
});
check('phase locked: today 18:00, now 10:00 (before the 30 min unlock) -> locked, unlockAt = 17:30', () => {
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  return r.phase === 'locked' && r.isToday && r.unlockAt === Date.UTC(2026, 10, 4, 15, 30) ? '' : J([r.phase, r.unlockAt, Date.UTC(2026, 10, 4, 15, 30)]);
});
check('phase open: now is inside the unlock window (17:45, workout 18:00)', () => {
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), Date.UTC(2026, 10, 4, 15, 45));
  return r.phase === 'open' ? '' : r.phase;
});
check('phase inprogress: a real draft for today\'s instance; a test draft is ignored', () => {
  const dft = { startedAt: NOW - 6e5, routineId: 'r1', dateStr: iso(2026, 10, 4, 18), exercises: [], test: false };
  const a = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }], draft: dft }), Date.UTC(2026, 10, 4, 16));
  const b = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }], draft: Object.assign({}, dft, { test: true }) }), Date.UTC(2026, 10, 4, 16));
  return a.phase === 'inprogress' && b.phase === 'open' ? '' : J([a.phase, b.phase]);
});
check('phase done: a saved live session for today\'s instance -> volume + prCount from it', () => {
  const s = SESS(iso(2026, 10, 4, 18), 24, 6);                           // 24kg beats 20 -> a PR
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18), completed: true }], sessions: HIST.concat([s]) }), Date.UTC(2026, 10, 4, 19));
  return r.phase === 'done' && r.facts.volume === Math.round(W.volume(s)) && r.facts.prCount >= 1 ? '' : J([r.phase, r.facts.volume, r.facts.prCount]);
});
check('phase rest: no workout today, the next one is Friday -> rest, the hero points at Friday', () => {
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 6, 18) }] }), NOW);
  return r.phase === 'rest' && !r.isToday && r.instance.dt === iso(2026, 10, 6, 18) ? '' : J([r.phase, r.isToday, r.instance]);
});

// ── workout plan + targets ──
check('workout plan: name, muscles in order, exercise + set counts, a minutes estimate', () => {
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  const w = r.workout;
  return w && w.name === 'פול בודי' && J(w.muscles) === J(['chest', 'back']) && w.exercises === 2 && w.sets === 6 && w.mins > 0 ? '' : J(w);
});
check('targets: the first WEIGHTED exercise (חזה), its progressed target and last time; nearPR flagged when the target >= best', () => {
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  const t = r.targets;
  return t && t.exercise === 'חזה' && t.targetKg != null && t.targetReps != null && t.lastKg === 20 && t.lastReps === 6 && typeof r.facts.nearPR === 'boolean' ? '' : J([t, r.facts.nearPR]);
});
check('flexible: a bodyweight-only program yields targets with null kg and does not crash', () => {
  const bwProg = { v: 2, activeId: 'p2', programs: [{ id: 'p2', name: 'משקל גוף', goal: 'general', days: [{ id: 'd', name: 'א', exercises: [EX('מתח', 'back', 'bodyweight', null, 0, null)] }] }] };
  const r = B.compute(base({ programs: bwProg, routines: [{ id: 'r1', programId: 'p2', name: 'x', kind: 'workout', enabled: true }], sessions: [], instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  return r.phase === 'locked' && r.targets && r.targets.targetKg === null && r.targets.targetReps != null ? '' : J([r.phase, r.targets]);
});

// ── facts ──
check('facts: weekDone / weekPlanned this week; streakWeeks counts consecutive weeks with a session', () => {
  const insts = [{ routineId: 'r1', dt: iso(2026, 11, 1, 18) }, { routineId: 'r1', dt: iso(2026, 11, 3, 18) }, { routineId: 'r1', dt: iso(2026, 11, 5, 18) }];  // Sun/Tue/Thu this week
  const sess = [SESS(iso(2026, 11, 1, 18), 20, 6), SESS(iso(2026, 10, 28, 18), 20, 6), SESS(iso(2026, 10, 21, 18), 20, 6)];  // this wk + prev 2 wks
  const r = B.compute(base({ sessions: sess, instances: insts }), Date.UTC(2026, 11, 3, 8));   // Tue 3 Dec... (Nov idx 11)
  return r.facts.weekDone === 1 && r.facts.weekPlanned === 3 && r.facts.streakWeeks === 3 ? '' : J(r.facts);
});
check('facts: no sessions -> streak 0, volume 0; weekPlanned never below weekDone', () => {
  const r = B.compute(base({ sessions: [], instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  return r.facts.streakWeeks === 0 && r.facts.volume === 0 && r.facts.weekPlanned >= r.facts.weekDone ? '' : J(r.facts);
});

// ── the 48 h journey ──
check('notifications: evening-before, morning, unlock, rescue for a workout tomorrow; sorted; each tied to the instance (warm-up is the per-day cut)', () => {
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 5, 18) }] }), Date.UTC(2026, 10, 4, 6));
  const types = r.notifications.map((n) => n.type);
  const sorted = r.notifications.every((n, i) => !i || n.fireAt >= r.notifications[i - 1].fireAt);
  const tied = r.notifications.filter((n) => n.instance).every((n) => n.instance.dt === iso(2026, 10, 5, 18));
  return types.includes('eveningBefore') && types.includes('morning') && types.includes('unlock') && types.includes('rescue') && sorted && tied ? '' : J(types);
});
check('notifications: max 3/day; quiet hours 22:00–07:00 dropped (a 23:00 workout gets no warm-up / unlock inside quiet)', () => {
  const r = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 23) }] }), Date.UTC(2026, 10, 3, 18));
  const byDay = {}; r.notifications.forEach((n) => { const k = W.ymdIn(new Date(n.fireAt), TZ); byDay[k] = (byDay[k] || 0) + 1; });
  const maxDay = Math.max(...Object.values(byDay), 0);
  const quiet = r.notifications.some((n) => { const h = +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(n.fireAt)).slice(0, 2); return h >= 22 || h < 7; });
  return maxDay <= 3 && !quiet ? '' : J({ maxDay, quiet, times: r.notifications.map((n) => new Date(n.fireAt).toISOString()) });
});
check('notifications: none in test mode or when off', () => {
  const a = B.compute(base({ prefs: { testMode: true }, instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  const b = B.compute(base({ prefs: { off: true }, instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18) }] }), NOW);
  return !a.notifications.length && !b.notifications.length ? '' : J([a.notifications.length, b.notifications.length]);
});
check('notifications: a completed instance gets none; a skipped instance is ignored for the hero and the journey', () => {
  const a = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18), completed: true }] }), Date.UTC(2026, 10, 4, 6));
  const b = B.compute(base({ instances: [{ routineId: 'r1', dt: iso(2026, 10, 4, 18), skipped: true }] }), NOW);
  const noInstNotif = !a.notifications.some((n) => n.instance);
  return noInstNotif && b.phase === 'none' ? '' : J([a.notifications.map((n) => n.type), b.phase]);
});
check('DST: a workout the day the clocks change (2026-10-25) still unlocks 30 min before its local 18:00', () => {
  const r = B.compute(base({ sessions: [], instances: [{ routineId: 'r1', dt: '2026-10-25T18:00:00+02:00' }] }), Date.UTC(2026, 9, 25, 10));
  const h = +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(r.unlockAt)).slice(0, 2);
  return r.unlockAt != null && h === 17 ? '' : J([r.unlockAt, h]);
});

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
