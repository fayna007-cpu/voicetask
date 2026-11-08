// node tests/workout-core.test.js — workout core (grammar, round trip, conflicts, derived data, week ranges).
// INVENTED corpus only. Runs itself under TZ=Asia/Jerusalem AND TZ=UTC.
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
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push({ name, err }); };
const NOW = new Date('2026-11-05T12:00:00+02:00');                       // Thu 5 Nov 2026
const one = (text, now = NOW) => { const r = W.parse(text, { now }); return r.sessions[0]; };
const J = (x) => JSON.stringify(x);
const core = (s) => ({ date: s.date, type: s.type, locker: s.locker, mode: s.mode, classes: s.classes, exercises: s.exercises.map((e) => ({ label: e.label, sets: e.sets.map((x) => [x.w, x.r]), unparsed: e.unparsed, note: e.note || null })) });

const BASIC = 'אימון A 14 2.11\nמתח - 8, 8, 8\nחזה - 26*6, 24*7, 20*11\nרגליים - 7*7, 7*7, 7*7';
check('header + exercise lines: date, type, locker, sets, bodyweight', () => {
  const s = one(BASIC);
  return s.date === '2026-11-02' && s.type === 'A' && s.locker === 14 && s.mode === 'sets' && s.exercises.length === 3 && J(s.exercises[0].sets.map((x) => [x.w, x.r])) === '[[null,8],[null,8],[null,8]]'
    && J(s.exercises[1].sets.map((x) => [x.w, x.r])) === '[[26,6],[24,7],[20,11]]' && s.exercises[2].label === 'רגליים' && !s.warnings.length ? '' : J(s);
});
check('the optional leading "[...] Name:" prefix is ignored (header and continuation lines)', () => {
  const s = one('[19:30, 2.11.2026] Dana: אימון A 14 2.11\n[19:31, 2.11.2026] Dana: מתח - 8, 8\nחזה - 26*6');
  return J(core(s)) === J(core(one('אימון A 14 2.11\nמתח - 8, 8\nחזה - 26*6'))) ? '' : J(s);
});
check('locker absent -> null; letter case: "אימון c 37 6.11" -> type C (typeRaw c), locker 37; a Hebrew letter works', () => {
  const a = one('אימון B 5.11\nחזה - 28*3'), b = one('אימון c 37 6.11\nרגליים - 7.5*10'), h = one('אימון ב 3.11\nחזה - 20*10');
  return a.locker === null && a.date === '2026-11-05' && b.type === 'C' && b.typeRaw === 'c' && b.locker === 37 && b.date === '2026-11-06' && h.type === 'ב' && h.date === '2026-11-03' ? '' : J({ a, b, h });
});
check('locker and date are order-insensitive in the header', () => { const s = one('אימון A 2.11 14\nחזה - 20*10'); return s.locker === 14 && s.date === '2026-11-02' ? '' : J(s); });
check('year rule: current year; a date more than 7 days ahead = last year (+7 stays, +8 flips)', () => {
  const a = one('אימון A 12.11', NOW), b = one('אימון A 13.11', NOW);
  return a.date === '2026-11-12' && b.date === '2025-11-13' ? '' : a.date + ' ' + b.date;
});
check('year rule across New Year: now 3 Jan 2027, "30.12" -> 2026-12-30; now 28 Dec 2026, "2.1" -> 2026-01-02 (past, current year)', () => {
  const a = one('אימון A 30.12', new Date('2027-01-03T12:00:00+02:00')), b = one('אימון A 2.1', new Date('2026-12-28T12:00:00+02:00'));
  return a.date === '2026-12-30' && b.date === '2026-01-02' ? '' : a.date + ' ' + b.date;
});
check('explicit year (4 or 2 digits) wins; invalid date / no date -> warning + today', () => {
  const a = one('אימון A 2.11.2025'), b = one('אימון A 2.11.25'), c = one('אימון A 31.2'), d = one('אימון A');
  return a.date === '2025-11-02' && b.date === '2025-11-02' && c.date === '2026-11-05' && c.warnings.some((w) => w.code === 'invalidDate') && d.date === '2026-11-05' && d.warnings.some((w) => w.code === 'noDate') ? '' : J({ a: a.date, b: b.date, c, d });
});
check('trailing commas, decimals with . and ,, and the separators * x X ×', () => {
  const s = one('אימון A 2.11\nחזה - 28*3, 24x8, 20X10, 18×12,\nרגליים - 7,5*10, 10.5*5,\nמתח - 8,8,8');
  return J(core(s).exercises.map((e) => e.sets)) === '[[[28,3],[24,8],[20,10],[18,12]],[[7.5,10],[10.5,5]],[[null,8],[null,8],[null,8]]]' && !s.warnings.length ? '' : J(core(s));
});
check('class line "שיעור - 60 דקות" -> a set-less session; mixed with sets stays a sets session', () => {
  const c = one('אימון D 4.11\nשיעור - 60 דקות'), m = one('אימון D 4.11\nחזה - 20*10\nשיעור - 45 דקות');
  return c.mode === 'class' && J(c.classes) === '[{"label":"שיעור","minutes":60}]' && c.exercises.length === 0 && m.mode === 'sets' && m.classes[0].minutes === 45 ? '' : J({ c, m });
});
check('nothing is dropped silently: a*b*c, ranges 8-10, BW, unknown tokens -> unparsed; (note) -> note', () => {
  const s = one('אימון A 2.11\nחזה - 8*8*8, 8-10, BW, 26*6, כבד, (קל מדי)');
  const e = s.exercises[0];
  return J(e.unparsed) === '["8*8*8","8-10","BW","כבד"]' && e.sets.length === 1 && e.note === 'קל מדי' ? '' : J(e);
});
check('warnings: reps 0 / >50, weight >500, a line without a dash, an empty exercise value', () => {
  const s = one('אימון A 2.11\nחזה - 20*0, 20*60, 600*5\nמחר לא לשכוח כרית\nמתח -');
  const codes = s.warnings.map((w) => w.code).sort().join();
  return codes === 'line,line,reps,reps,weight' ? '' : codes;
});
check('RTL marks, NBSP and CRLF are cleaned', () => {
  const s = one('‏אימון A 14 2.11\r\n‎חזה - 26*6, 24*7\r\n');
  return s.locker === 14 && s.exercises[0].sets.length === 2 ? '' : J(s);
});
check('several sessions pasted at once; text before the first header is an error; empty text is an error', () => {
  const r = W.parse('אימון A 2.11\nחזה - 26*6\n\nאימון B 5.11\nרגליים - 7*7', { now: NOW }), n = W.parse('חזה - 26*6', { now: NOW }), e = W.parse('   ', { now: NOW });
  return r.sessions.length === 2 && r.sessions[1].type === 'B' && n.errors[0] === 'noHeader' && e.errors[0] === 'empty' ? '' : J({ r: r.sessions.length, n: n.errors, e: e.errors });
});
check('identity: same sets -> same hash; different sets or date -> different', () => {
  const a = one(BASIC), b = one(BASIC), c = one(BASIC.replace('26*6', '26*5')), d = one(BASIC.replace('2.11', '3.11'));
  return a.hash === b.hash && a.hash !== c.hash && a.hash !== d.hash ? '' : [a.hash, c.hash, d.hash].join();
});
check('conflicts: same date + type + same sets -> exists; other sets -> conflict; other type/date -> new', () => {
  const old = one(BASIC);
  const k = (t) => W.classify(one(t), [old]).kind;
  return k(BASIC) === 'exists' && k(BASIC.replace('26*6', '26*5')) === 'conflict' && k(BASIC.replace('אימון A', 'אימון B')) === 'new' && k(BASIC.replace('2.11', '3.11')) === 'new' ? '' : [k(BASIC), k(BASIC.replace('26*6', '26*5'))].join();
});
const CORPUS = [BASIC, 'אימון c 37 6.11\nרגליים - 7.5*10, 10*5\nחזה - 8*8*8, BW, (קל)', 'אימון D 4.11\nשיעור - 60 דקות', 'אימון B 13.11\nחזה - 28*3', 'אימון A 2.11.2025\nמתח - 8'].join('\n\n');
check('round trip: parse(format(parse(x))) equals parse(x) (locker, year, unparsed, note, class)', () => {
  const a = W.parse(CORPUS, { now: NOW }).sessions, text = W.format(a, { now: NOW }), b = W.parse(text, { now: NOW }).sessions;
  return J(a.map(core)) === J(b.map(core)) ? '' : text;
});
check('format output is the shorthand itself (date d.m; the year only when it would not be recovered)', () => {
  const t = W.format(W.parse('אימון A 14 2.11\nחזה - 26*6\n\nאימון A 2.11.2025\nמתח - 8', { now: NOW }).sessions, { now: NOW });
  return t === 'אימון A 14 2.11\nחזה - 26*6\n\nאימון A 2.11.2025\nמתח - 8' ? '' : t;
});
check('round trip property: 300 generated sessions survive format -> parse unchanged', () => {
  let seed = 7; const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const labels = ['חזה', 'מתח', 'יד קדמית', 'רגליים', 'כתפיים'];
  for (let i = 0; i < 300; i++) {
    const day = 1 + rnd(28), mon = 1 + rnd(12), yr = rnd(4) === 0 ? 2025 : 2026;
    const date = `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const s = { date, type: 'ABCD'[rnd(4)], locker: rnd(3) === 0 ? null : 1 + rnd(60), mode: 'sets', classes: [], exercises: [] };
    for (let k = 0, n = 1 + rnd(4); k < n; k++) s.exercises.push({ label: labels[rnd(5)], sets: Array.from({ length: 1 + rnd(5) }, () => (rnd(3) === 0 ? { w: null, r: 1 + rnd(20) } : { w: (rnd(120) + 1) / (rnd(2) ? 2 : 1), r: 1 + rnd(20) })), unparsed: [] });
    const back = W.parse(W.format([s], { now: NOW }), { now: NOW }).sessions[0];
    if (J(core(back)) !== J(core({ ...s, exercises: s.exercises.map((e) => ({ ...e, note: null })) }))) return 'mismatch at ' + i + ' ' + W.format([s], { now: NOW });
  }
});
// derived data
const S = (t) => W.parse(t, { now: NOW }).sessions[0];
const HIST = [S('אימון A 14 29.10\nחזה - 24*8, 22*8\nמתח - 8, 8'), S('אימון B 20 30.10\nרגליים - 7*7'), S('אימון A 14 2.11\nחזה - 26*6, 24*7, 20*11\nמתח - 8, 8, 8'), S('אימון A 31 5.11\nחזה - 28*3, 24*8\nכתפיים - 10*10, 12*8')];
check('derive: counts, usual locker (mode; a tie -> the most recent), usual weekday', () => {
  const d = W.derive(HIST).types;
  return d.A.count === 3 && d.A.usualLocker.n === 14 && d.A.usualLocker.count === 2 && d.B.usualLocker.n === 20 && d.A.usualWeekday != null && d.A.lastDate === '2026-11-05' ? '' : J(d.A);
});
check('derive: a locker tie goes to the most recent session', () => {
  const d = W.derive([S('אימון A 14 29.10\nחזה - 20*10'), S('אימון A 31 5.11\nחזה - 20*10')]).types;
  return d.A.usualLocker.n === 31 ? '' : J(d.A.usualLocker);
});
check('derive: template = the last 3 sessions of the type, the most recent session\'s order first, last sets, set pattern', () => {
  const t = W.derive(HIST).types.A.template;
  return t.map((x) => x.label).join() === 'חזה,כתפיים,מתח' && J(t[0].lastSets.map((x) => [x.w, x.r])) === '[[28,3],[24,8]]' && t[0].pattern === 'descending' && t[1].pattern === 'ascending' && t[2].pattern === 'bodyweight' ? '' : J(t.map((x) => [x.label, x.pattern]));
});
check('set patterns: straight / descending / ascending / mixed / bodyweight', () => {
  const p = (t) => W.pattern(S('אימון A 2.11\nx - ' + t).exercises[0].sets);
  return [p('20*10, 20*8, 20*6'), p('28*3, 24*8, 20*10'), p('20*10, 24*8'), p('20*10, 24*8, 22*6'), p('8, 8, 8')].join() === 'straight,descending,ascending,mixed,bodyweight' ? '' : [p('20*10, 20*8'), p('28*3, 24*8'), p('20*10, 24*8'), p('20*10, 24*8, 22*6'), p('8, 8')].join();
});
check('last time: the previous occurrence strictly before the date (the "בפעם שעברה" line)', () => {
  const a = W.lastTimeBefore(HIST, 'חזה', '2026-11-05'), b = W.lastTimeBefore(HIST, 'חזה', '2026-10-29'), c = W.lastTimeBefore(HIST, ' חזה ', '2026-11-09'), d = W.derive(HIST).lastByLabel['חזה'];
  return a.date === '2026-11-02' && W.setsText(a.sets) === '26×6 · 24×7 · 20×11' && b === null && c.date === '2026-11-05' && d.date === '2026-11-05' ? '' : J({ a, b, c });
});
check('muscle aliases: the defaults, a user alias overrides', () => {
  const c = { aliases: { 'חזה': { muscle: 'pecs' } } };
  return W.muscleOf('חזה') === 'chest' && W.muscleOf('מתח') === 'back' && W.muscleOf('יד אחורית') === 'triceps' && W.muscleOf('חזה', c) === 'pecs' && W.muscleOf('קרוספיט') === null ? '' : 'alias';
});
// weeks
const H = 3600000;
check('weekRange: Sunday-Saturday, any weekday inside the week gives the same week', () => {
  const a = W.weekRange('2026-11-05'), b = W.weekRange('2026-11-01'), c = W.weekRange('2026-11-07');
  return [a, b, c].every((w) => w.start === '2026-11-01' && w.end === '2026-11-07' && w.days.length === 7) ? '' : J([a.start, b.start, c.start]);
});
check('weekRange from instants near midnight in Jerusalem (Sat 23:30 -> this week, Sun 00:30 -> next)', () => {
  const sat = W.weekRange(new Date(Date.UTC(2026, 10, 7, 21, 30))), sun = W.weekRange(new Date(Date.UTC(2026, 10, 7, 22, 30)));
  return sat.start === '2026-11-01' && sun.start === '2026-11-08' ? '' : sat.start + ' ' + sun.start;
});
check('weekRange DST start (Fri 2026-03-27): week 22-28 Mar is 7 days minus 1 hour; instants are exact', () => {
  const w = W.weekRange('2026-03-27');
  return w.start === '2026-03-22' && w.end === '2026-03-28' && w.startMs === Date.UTC(2026, 2, 21, 22) && w.endMs === Date.UTC(2026, 2, 28, 21) && w.endMs - w.startMs === 7 * 24 * H - H ? '' : J({ w, d: (w.endMs - w.startMs) / H });
});
check('weekRange DST end (Sun 2026-10-25): week 25-31 Oct is 7 days plus 1 hour; instants are exact', () => {
  const w = W.weekRange('2026-10-25');
  return w.start === '2026-10-25' && w.end === '2026-10-31' && w.startMs === Date.UTC(2026, 9, 24, 21) && w.endMs === Date.UTC(2026, 9, 31, 22) && w.endMs - w.startMs === 7 * 24 * H + H ? '' : J({ w, d: (w.endMs - w.startMs) / H });
});
check('weekRange: 60 consecutive weeks across both 2026 DST changes tile with no gap or overlap', () => {
  let prev = W.weekRange('2026-01-04');
  for (let i = 1; i < 60; i++) { const nx = W.weekRange(W.addDaysYmd(prev.start, 7)); if (nx.startMs !== prev.endMs || W.weekRange(new Date(nx.startMs)).start !== nx.start) return 'gap at ' + i; prev = nx; }
});

rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.err ? 'FAIL' : 'PASS'}  ${r.name}${r.err ? '  <- ' + r.err : ''}`));
const failed = rows.filter((r) => r.err).length;
console.log(`\n${rows.length - failed}/${rows.length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
