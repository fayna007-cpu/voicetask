// node tests/workout-coach.test.js — A2 part 2 pure logic in WCore: coachMoment (priority, no-target rule, combined sets), isPR,
// the on-target tally, the rest-end alert schedule, read-modify-write storage (two writers), prefs, and the copy filter.
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
const W = require('../workout-core.js'), C = require('../wk-coach.js'), CP = require('../wk-copy.js');
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push([name, err]); };
const J = (x) => JSON.stringify(x);
const NOW = Date.UTC(2026, 10, 4, 8, 0);
const DESC = { type: 'desc', sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 };
const st = (logs) => W.replay([{ type: 'START', at: NOW, program: { id: 'p', name: 'P', exercises: [{ label: 'חזה', equip: 'dumbbell', unit: 'kg', step: 2, scheme: DESC }, { label: 'מתח', equip: 'bodyweight', step: 0, unit: null, scheme: { sets: 2, ranges: [[6, 10]] } }] } }].concat(logs));
const log = (ex, w, r, parts) => ({ type: 'LOG_SET', at: NOW + 1, ex, w, r, parts });
const plain = (s) => s.replace(/[⁦-⁩]/g, '');

check('start: once, with the first target (LTR-isolated); never again once seen', () => {
  const a = W.coachMoment(st([]), { atStart: true, firstTarget: { w: 28, r: 4 }, seen: {} }), b = W.coachMoment(st([]), { atStart: true, firstTarget: { w: 28, r: 4 }, seen: { start: true } });
  return a.kind === 'start' && a.vars.target === '⁦28×4⁩' && b === null ? '' : J([a, b]);
});
check('pr beats exceed: a record set reports "pr" with the record text', () => {
  const s = st([log(0, 30, 9)]); const m = W.coachMoment(s, { set: s.exercises[0].sets[0], target: { w: 28, r: 4 }, pr: 'חזה ⁦30×9⁩', judge: C.judge });
  return m.kind === 'pr' && m.vars.pr === 'חזה ⁦30×9⁩' ? '' : J(m);
});
check('exceed / met / under against the set\'s target; under carries the target, exceed the done set', () => {
  const s = st([log(0, 28, 9)]), t = { w: 28, r: 8 };
  const e = W.coachMoment(s, { set: { w: 28, r: 9 }, target: t, judge: C.judge }), m = W.coachMoment(s, { set: { w: 28, r: 8 }, target: t, judge: C.judge }), u = W.coachMoment(s, { set: { w: 26, r: 8 }, target: t, judge: C.judge });
  return e.kind === 'exceed' && plain(e.vars.done) === '28×9' && m.kind === 'met' && u.kind === 'under' && plain(u.vars.target) === '28×8' ? '' : J([e, m, u]);
});
check('a combined set is judged on its TOTAL: 28×6+5 (11) vs 28×8 -> exceed; done prints "28×6+5"', () => {
  const s = st([log(0, 28, 6, [{ r: 6 }, { r: 5 }])]), set = s.exercises[0].sets[0], m = W.coachMoment(s, { set, target: { w: 28, r: 8 }, judge: C.judge });
  return set.r === 11 && m.kind === 'exceed' && plain(m.vars.done) === '28×6+5' ? '' : J([set, m]);
});
check('NO target -> no judgement line after a set (never "on target" without one): null', () => {
  const s1 = st([log(0, 28, 6)]), a = W.coachMoment(s1, { set: s1.exercises[0].sets[0], target: null, judge: C.judge });
  const s3 = st([log(0, 28, 6), log(0, 24, 8), log(0, 20, 12)]), c = W.coachMoment(s3, { set: s3.exercises[0].sets[2], target: { w: null, r: null }, judge: C.judge, seen: {} });
  return a === null && c === null ? '' : J([a, c]);
});
check('ARRIVAL: lastSet when arriving at an exercise\'s last planned set; halfway once at >= 50%; lastSet beats halfway', () => {
  const two = st([log(0, 28, 6), log(0, 24, 8)]), a = W.arrivalMoment(two, {});                        // chest 2/3 -> arriving at set 3
  const half = st([log(0, 28, 6), log(0, 24, 8), log(0, 20, 12)]), b = W.arrivalMoment(half, {});       // chest done (3 of 5 planned) -> halfway
  const c = W.arrivalMoment(half, { halfway: true }), d = W.arrivalMoment(st([]), {}), e = W.arrivalMoment(st([log(0, 28, 6)]), {});
  return a.kind === 'lastSet' && b.kind === 'halfway' && c === null && d === null && e === null ? '' : J([a, b, c, d, e]);
});
check('gate: event lines (pr / exceed / under / met) ALWAYS speak; filler lines at most one per 20 s', () => {
  const r = [W.coachAllowed('under', 1000, 500), W.coachAllowed('pr', 1000, 999), W.coachAllowed('met', 0, null), W.coachAllowed('rest', 1000, 500), W.coachAllowed('rest', 25000, 1000), W.coachAllowed('start', 0, null), W.coachAllowed('lastSet', 5000, 0)];
  return J(r) === J([true, true, true, false, true, true, false]) ? '' : J(r);
});
check('collisions: the higher priority wins (pr > exceed|under|met > lastSet > halfway > start); nulls ignored; never empty when one exists', () => {
  const k = (l) => (W.pickMoment(l) || {}).kind;
  return k([{ kind: 'halfway' }, { kind: 'pr' }, { kind: 'exceed' }]) === 'pr' && k([null, { kind: 'start' }, { kind: 'lastSet' }]) === 'lastSet' && k([{ kind: 'rest' }, { kind: 'halfway' }]) === 'halfway' && W.pickMoment([null]) === null ? '' : 'x';
});
check('isPR: kg = a higher Epley e1RM on the first part; else more reps at the same load; first time never; text isolated', () => {
  const h = [{ exercises: [{ label: 'חזה', unit: 'kg', sets: [{ w: 28, r: 6 }] }, { label: 'מתח', unit: null, sets: [{ w: null, r: 8 }] }] }];
  const r = [W.isPR({ w: 28, r: 8 }, { label: 'חזה', unit: 'kg' }, h), W.isPR({ w: 28, r: 6 }, { label: 'חזה', unit: 'kg' }, h), W.isPR({ w: 28, r: 11, parts: [{ r: 6 }, { r: 5 }] }, { label: 'חזה', unit: 'kg' }, h),
    W.isPR({ w: null, r: 9 }, { label: 'מתח', unit: null }, h), W.isPR({ w: 20, r: 10 }, { label: 'כתפיים', unit: 'kg' }, h)];
  return r[0] === 'חזה ⁦28×8⁩' && r[1] === null && r[2] === null && r[3] === 'מתח ⁦9⁩' && r[4] === null ? '' : J(r);
});
check('tally "ביעד: X מתוך Y": only sets WITH a target count; met + exceed are on target', () => {
  const t = W.tally([{ target: { w: 28, r: 8 }, set: { w: 28, r: 8 } }, { target: { w: 28, r: 8 }, set: { w: 28, r: 9 } }, { target: { w: 28, r: 8 }, set: { w: 26, r: 8 } }, { target: null, set: { w: 1, r: 1 } }, { target: { w: null, r: null }, set: { w: 1, r: 1 } }], C.judge);
  return J(t) === '{"ok":2,"of":3}' ? '' : J(t);
});
check('rest alert: at the end, +10 s, +30 s; none once the user tapped; none for a rest older than 5 min', () => {
  const s = W.restAlertSchedule(NOW, NOW - 5000, false);
  return J(s.map((a) => [a.atMs - NOW, a.kind])) === J([[0, 'end'], [10000, 'repeat'], [30000, 'repeat']]) && !W.restAlertSchedule(NOW, NOW, true).length && !W.restAlertSchedule(NOW, NOW + 6 * 60e3, false).length ? '' : J(s);
});
check('due alert: fires the latest due one not fired; a rest that ended in the background alerts ONCE on return', () => {
  const s = W.restAlertSchedule(NOW, NOW, false), fired = {};
  const a = W.dueAlert(s, NOW - 1, fired), b = W.dueAlert(s, NOW + 1, fired); fired[b.atMs] = 1;
  const c = W.dueAlert(s, NOW + 5000, fired), d = W.dueAlert(s, NOW + 12000, fired); fired[d.atMs] = 1;
  const back = W.dueAlert(s, NOW + 40000, {});                          // background: all three due -> ONE (the latest)
  return a === null && b.kind === 'end' && c === null && d.atMs === NOW + 10000 && back.atMs === NOW + 30000 ? '' : J([a, b, c, d, back]);
});
check('read-modify-write: two writers on vt_wk_catalog never erase each other (each re-reads before writing)', () => {
  const store = new Map(); const S = { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v) };
  S.setItem('vt_wk_catalog', JSON.stringify({ aliases: {}, notes: {} }));
  const staleA = JSON.parse(S.getItem('vt_wk_catalog'));                // writer A loaded earlier (the old bug: saving this copy)
  W.updateJSON(S, 'vt_wk_catalog', {}, (c) => { c.notes.chest = 'מרפקים צמודים'; return c; });            // writer B
  W.updateJSON(S, 'vt_wk_catalog', {}, (c) => { c.aliases['חזה'] = { step: 2.5 }; return c; });         // writer A, the right way
  const out = JSON.parse(S.getItem('vt_wk_catalog'));
  return out.notes.chest === 'מרפקים צמודים' && out.aliases['חזה'].step === 2.5 && !staleA.notes.chest ? '' : J(out);
});
check('read-modify-write tolerates a missing / corrupt value (starts from the default) and a full storage (null)', () => {
  const store = new Map([['k', '{bad']]); const S = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  const a = W.updateJSON(S, 'k', { n: 0 }, (c) => { c.n++; return c; }); const full = W.updateJSON({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'k', {}, (c) => c);
  return a.n === 1 && full === null ? '' : J([a, full]);
});
check('prefs: defaults coach / sound on / tactile on / test off; junk tolerated; "off" is a mode', () => {
  const d = W.readPrefs(null), j = W.readPrefs({ coachMode: 'loud', sound: false, testMode: 'yes' }), o = W.readPrefs({ coachMode: 'off', testMode: true });
  return J(d) === J({ coachMode: 'coach', sound: true, haptic: true, testMode: false, soundTested: false }) && j.coachMode === 'coach' && j.sound === false && j.testMode === false && o.coachMode === 'off' && o.testMode === true ? '' : J([d, j, o]);
});
check('copy filter: only variants the user\'s own data can fill; nothing with "{" survives a fill', () => {
  const vars = { name: 'אימון כוח', time: '18:00' }, all = [];
  Object.values(CP.COPY.card).forEach((s) => Object.values(s).forEach((l) => { if (Array.isArray(l)) all.push(...W.fillable(l, vars).map((t) => CP.fill(t, vars))); }));
  return all.length && all.every((t) => !t.includes('{')) && W.fillable(['{x} a', 'b'], {}).join() === 'b' ? '' : J(all.filter((t) => t.includes('{')));
});
check('the draft keeps test + coachMode through a replay (a resume keeps them)', () => {
  const s = W.replay([{ type: 'START', at: NOW, test: true, coachMode: 'fire', program: { id: 'p', name: 'P', exercises: [{ label: 'a' }] } }]);
  return s.test === true && s.coachMode === 'fire' ? '' : J(s);
});
check('last-3 peek: the last n sessions of an exercise before a date, newest first, only sessions that have it', () => {
  const S = [{ id: 'a', date: '2026-10-20', exercises: [{ label: 'חזה', sets: [{ w: 18, r: 6 }] }] }, { id: 'b', date: '2026-10-25', exercises: [{ label: 'גב', sets: [{ w: 1, r: 1 }] }] },
    { id: 'c', date: '2026-10-28', exercises: [{ label: 'חזה', sets: [{ w: 20, r: 5 }] }] }, { id: 'd', date: '2026-11-01', exercises: [{ label: 'חזה', sets: [{ w: 20, r: 6 }] }] }, { id: 'e', date: '2026-11-04', exercises: [{ label: 'חזה', sets: [{ w: 22, r: 4 }] }] }];
  const r = W.lastNBefore(S, 'חזה', '2026-11-04', 3);
  return J(r.map((x) => x.date)) === '["2026-11-01","2026-10-28","2026-10-20"]' && W.lastNBefore(S, 'כתפיים', '2026-11-05', 3).length === 0 ? '' : J(r);
});
check('string table: the part 2 UI strings exist', () => { const U = W.TEXT.ui; const miss = ['coachOff', 'coachModeT', 'soundTest', 'soundHint', 'nextSet', 'nextSetBtn', 'tally', 'testBanner', 'testStart', 'testClose', 'testMode', 'testModeSub', 'testKeep', 'menuT', 'soundT', 'hapticT'].filter((k) => !U[k]); return miss.length ? J(miss) : ''; });

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
