// node tests/workout-polish.test.js — Polish round 1 pure logic: finish mid-workout (exProgress / partial), and later the
// warm-up ramp + coach copy rules. INVENTED data only. Runs under TZ=Asia/Jerusalem AND UTC.
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

// ── S2: finish mid-workout ──
check('exProgress: exercises with >= 1 set of all; partial when any has none; sets counted (a skipped one counts as not done)', () => {
  const s = { exercises: [{ label: 'חזה', sets: [{ w: 20, r: 6 }, { w: 16, r: 8 }] }, { label: 'מתח', sets: [{ w: null, r: 8 }] }, { label: 'כתפיים', sets: [], skipped: true }, { label: 'רגליים', sets: [] }] };
  const p = W.exProgress(s);
  return J(p) === J({ done: 2, total: 4, partial: true, sets: 3 }) ? '' : J(p);
});
check('exProgress: all done -> not partial; empty / missing session -> 0 of 0, not partial', () => {
  const a = W.exProgress({ exercises: [{ sets: [{ r: 5 }] }, { sets: [{ r: 6 }] }] }), b = W.exProgress(null), c = W.exProgress({ exercises: [] });
  return !a.partial && a.done === 2 && J(b) === J({ done: 0, total: 0, partial: false, sets: 0 }) && J(c) === J(b) ? '' : J([a, b, c]);
});
check('strings: "סיים אימון כאן", "X מתוך Y תרגילים בוצעו", the two partial choices, the summary line', () => {
  const U = W.TEXT.ui;
  return U.finishHere === 'סיים אימון כאן' && U.exDoneOf(2, 6) === '2 מתוך 6 תרגילים בוצעו' && U.exDoneOf(1, 3) === '1 מתוך 3 תרגילים בוצע' && U.savePartial === 'סיים ושמור כאימון חלקי' && U.discardW === 'בטל בלי לשמור' && U.partialT(2, 6) === 'אימון חלקי · 2 מתוך 6 תרגילים' ? '' : 'missing';
});

// ── S3: warm-up ──
check('warm-up config: ONE ramp constant 40%x8 / 60%x5 / 80%x3', () => J(W.WARMUP_RAMP) === J([[0.4, 8], [0.6, 5], [0.8, 3]]) ? '' : J(W.WARMUP_RAMP));
check('warmupMode: true / "on" = on, "off" = off, false / missing = auto (older data keeps its meaning)', () => {
  const r = [{ warmup: true }, { warmup: 'on' }, { warmup: 'off' }, { warmup: false }, {}, null].map(W.warmupMode);
  return J(r) === J(['on', 'on', 'off', 'auto', 'auto', 'auto']) ? '' : J(r);
});
check('warmupIdx: auto = the FIRST weighted exercise of each muscle group; bodyweight never auto; on always; off never', () => {
  const ex = [
    { label: 'מתח', muscle: 'back', equip: 'bodyweight', unit: null, step: 0 },                      // 0 bw, auto -> no
    { label: 'לחיצת חזה', muscle: 'chest', equip: 'dumbbell', unit: 'kg', step: 2 },                  // 1 first chest -> yes
    { label: 'פרפר', muscle: 'chest', equip: 'machine', unit: 'kg', step: 5 },                         // 2 second chest -> no
    { label: 'חתירה', muscle: 'back', equip: 'cable', unit: 'plates', step: 0.5 },                     // 3 first WEIGHTED back -> yes
    { label: 'כתפיים', muscle: 'shoulders', equip: 'dumbbell', unit: 'kg', step: 2, warmup: 'off' },  // 4 off -> no
    { label: 'יד קדמית', muscle: 'biceps', equip: 'dumbbell', unit: 'kg', step: 1 },                   // 5 first biceps -> yes
    { label: 'פטישים', muscle: 'biceps', equip: 'dumbbell', unit: 'kg', step: 1, warmup: true },       // 6 on -> yes
    { label: 'מקבילים', muscle: 'triceps', equip: 'bodyweight', unit: null, step: 0, warmup: true }, // 7 bw on -> yes (light set)
    { label: 'לחיצת כתפיים', muscle: 'shoulders', equip: 'machine', unit: 'kg', step: 5 }];          // 8 the off one still "used" the group -> no
  const r = W.warmupIdx(ex, {});
  return J(r) === J([1, 3, 5, 6, 7]) ? '' : J(r);
});
check('warmupSets: snapped to the exercise step (2.5 / 0.5 plates), below the working weight, no duplicates; none without a weight / step', () => {
  const a = W.warmupSets(30, 2.5), b = W.warmupSets(6, 0.5), c = W.warmupSets(4, 2), d = W.warmupSets(0, 2), e = W.warmupSets(20, 0);
  const ok = J(a) === J([{ w: 12.5, r: 8 }, { w: 17.5, r: 5 }, { w: 25, r: 3 }]) && J(b) === J([{ w: 2.5, r: 8 }, { w: 3.5, r: 5 }, { w: 5, r: 3 }]) && c.every((x) => x.w < 4) && !d.length && !e.length;
  return ok ? '' : J([a, b, c, d, e]);
});
check('warmupBw: bodyweight = one light set at ~50% of the target reps (no weight); none without reps', () => {
  const r = [W.warmupBw(9), W.warmupBw(1), W.warmupBw(0), W.warmupBw(null)];
  return J(r) === J([[{ w: null, r: 5 }], [{ w: null, r: 1 }], [], []]) ? '' : J(r);
});
check('warm-ups are never work: a replayed draft with START + one LOG has exactly that one set (warm-up ticks live in UI state only)', () => {
  const ex = { id: 'e1', label: 'חזה', muscle: 'chest', equip: 'dumbbell', unit: 'kg', step: 2, startW: 20, restSec: 0, warmup: true, scheme: { type: 'straight', sets: 3, ranges: [[6, 10], [6, 10], [6, 10]], drop: 0 } };
  const s = W.replay([{ type: 'START', at: 1, program: { id: 'p', name: 'x', exercises: [ex] } }, { type: 'LOG_SET', at: 2, ex: 0, w: 20, r: 8 }]);
  return s && s.exercises[0].sets.length === 1 ? '' : J(s && s.exercises[0].sets);
});

// ── S5: copy — a number never ends a line bare ──
check('coach numbers: a bodyweight target / set carries its unit ("8 חזרות"); a weighted one stays "26×8"', () => {
  const C = require('../wk-coach.js'), st = { exercises: [{ label: 'מתח', sets: [{ w: null, r: 7 }], scheme: { sets: 3 } }], exIdx: 0 };
  const bw = W.coachMoment(st, { set: { w: null, r: 7 }, target: { w: null, r: 8 }, judge: C.judge, seen: {} });
  const kg = W.coachMoment(st, { set: { w: 26, r: 8 }, target: { w: 28, r: 8 }, judge: C.judge, seen: {} });
  const vis = (s) => String(s).replace(/[⁦-⁩]/g, '');
  const ok = bw && vis(bw.vars.target) === '8 חזרות' && vis(bw.vars.done) === '7 חזרות' && kg && vis(kg.vars.target) === '28×8' && vis(kg.vars.done) === '26×8';
  const line = bw && vis(C.fill('מתחת ליעד. הסט הבא: {target}', bw.vars));
  return ok && /חזרות$/.test(line) ? '' : J([bw && bw.vars, kg && kg.vars, line]);
});

// ── deploy fixes: singular / plural in every count; "אין חימום: משקל גוף" ──
check('counts: "1 מתוך 1 סט", "2 מתוך 3 סטים", HTML-wrapped numbers too; exercises, the verb, the confirm texts', () => {
  const U = W.TEXT.ui, b = (n) => '<bdi dir="ltr" data-wk-count="' + n + '">' + n + '</bdi>';
  const r = [U.tally(1, 1), U.tally(2, 3), U.tally(b(1), b(1)).replace(/<[^>]*>/g, ''), U.exDoneOf(1, 3), U.exDoneOf(2, 6), U.exDoneOf(1, 1), U.partialT(1, 2), U.setsLogged(1), U.setsLogged(4),
    U.factSets(1, 5), U.factSets(3, 5), U.warmPreview(1), U.warmPreview(3), U.cancelWorkoutQ(1), U.openRealSub('x', 1)];
  const want = ['ביעד: 1 מתוך 1 סט', 'ביעד: 2 מתוך 3 סטים', 'ביעד: 1 מתוך 1 סט', '1 מתוך 3 תרגילים בוצע', '2 מתוך 6 תרגילים בוצעו', '1 מתוך 1 תרגיל בוצע', 'אימון חלקי · 1 מתוך 2 תרגילים', 'סט אחד נרשם', '4 סטים נרשמו',
    'סט אחד ב-5 דק׳', '3 סטים ב-5 דק׳', 'חימום · סט אחד', 'חימום · 3 סטים', 'לבטל את האימון? סט אחד שנרשם יימחק ולא יישמר.', 'x · סט אחד נרשם. מה לעשות איתו?'];
  return J(r) === J(want) ? '' : J(r);
});
check('plural(): a lone 1 before a plural noun -> singular (plain / <bdi> / isolated); 11, 21, "2×1", "8-1" untouched; fill() applies it', () => {
  const r = [W.plural('1 סטים'), W.plural('כל הכבוד. <bdi dir="ltr">1</bdi> סטים'), W.plural('⁦1⁩ חזרות'), W.plural('11 סטים · 21 סטים'), W.plural('2×1 חזרות · 8-1 חזרות'), W.plural('1 ימים · 1 תרגילים · 1 אימונים'), W.fill('שמרת על הקצב: {n} סטים', { n: 1 }), W.fill('{n} סטים', { n: 5 })];
  const want = ['סט אחד', 'כל הכבוד. סט אחד', 'חזרה אחת', '11 סטים · 21 סטים', '2×1 חזרות · 8-1 חזרות', 'יום אחד · תרגיל אחד · אימון אחד', 'שמרת על הקצב: סט אחד', '5 סטים'];
  return J(r) === J(want) ? '' : J(r);
});
check('no table line breaks when its count is 1 (every "{n} סטים" / "{sets} סטים" template reads as Hebrew)', () => {
  const CP = require('../wk-copy.js'), bad = [];
  const walk = (o, p) => { for (const k in o) { const v = o[k]; if (Array.isArray(v)) v.forEach((t) => { if (/\{(n|sets)\} סטים/.test(t)) { const r = W.plural(t.replace(/\{(n|sets)\}/g, '1').replace(/\{\w+\}/g, 'x')); if (/(^|\D)1 סטים|סט אחד ראשונים/.test(r)) bad.push(p + '.' + k + ': ' + r); } }); else if (v && typeof v === 'object') walk(v, p + '.' + k); } };
  walk(CP.COPY, 'copy'); walk(W.TEXT, 'text');
  return bad.join(' | ');
});
check('strings: "אין חימום: משקל גוף" exists', () => W.TEXT.ui.noWarmBw === 'אין חימום: משקל גוף' ? '' : 'missing');

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
