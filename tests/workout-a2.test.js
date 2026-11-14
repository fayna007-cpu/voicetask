// node tests/workout-a2.test.js — Milestone A2 part 1 pure logic: typed weights + step override, combined sets "6+5",
// completed = locked, swap within a muscle group, one note per muscle group. INVENTED data only. Runs under TZ=Asia/Jerusalem AND UTC.
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
const NOW = Date.UTC(2026, 10, 4, 8, 0);                                 // Wed 4 Nov 2026 10:00 Jerusalem
const iso = (d, hh, mm = 0) => new Date(Date.UTC(2026, 10, d, hh - 2, mm)).toISOString();
const DESC = { type: 'desc', sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 };

// ── 1. weights ──
check('typed weight: decimals with . or , ; 0 allowed; odd values kept; junk / negative / > 999 -> null', () => {
  const r = ['22.5', '22,5', '0.25', '0', '17', ' 7.75 ', '', 'abc', '-2', '1000', '3.333'].map(W.parseWeight);
  return J(r) === J([22.5, 22.5, 0.25, 0, 17, 7.75, null, null, null, null, 3.33]) ? '' : J(r);
});
check('step: the catalog step (the owner\'s choice) wins over the program / history default; chips are 0.5 / 1 / 2.5 / 5', () => {
  const ex = { label: 'חזה', step: 2 }, cat = { aliases: { 'חזה': { step: 2.5 } } };
  return W.effStep(ex, cat) === 2.5 && W.effStep(ex, {}) === 2 && W.effStep(ex, null) === 2 && W.effStep({ label: 'x', step: 0 }, cat) === 0 && J(W.STEP_CHIPS) === '[0.5,1,2.5,5]' ? '' : 'x';
});
check('stepping never snaps a typed odd weight back to the grid: 22.75 + 2.5 = 25.25; never below 0', () => J([W.addStep(22.75, 2.5, 1), W.addStep(1, 2.5, -1), W.addStep(null, 2, 1)]) === J([25.25, 0, 2]) ? '' : J([W.addStep(22.75, 2.5, 1), W.addStep(1, 2.5, -1), W.addStep(null, 2, 1)]));

// ── 2. combined sets ──
check('parse: "28*6+5" -> ONE set {w 28, r 11, parts [6,5]}; "6+5" bodyweight; "28*6+24*5" a drop set (part weight); plain sets unchanged', () => {
  const s = W.parse('אימון A 2.11\nחזה - 28*6+5, 24*8\nמתח - 6+5, 8\nכתפיים - 28*6+24*5', { now: new Date(NOW) }).sessions[0];
  const [a, b, c] = s.exercises;
  return J(a.sets.map((x) => [x.w, x.r, x.parts || null])) === J([[28, 11, [{ r: 6 }, { r: 5 }]], [24, 8, null]])
    && J(b.sets.map((x) => [x.w, x.r, x.parts || null])) === J([[null, 11, [{ r: 6 }, { r: 5 }]], [null, 8, null]])
    && J(c.sets[0].parts) === J([{ r: 6 }, { r: 5, w: 24 }]) && c.sets[0].w === 28 && c.sets[0].r === 11 && !a.unparsed.length && !s.warnings.length ? '' : J(s);
});
check('a*b*c and "8-10" still stay unparsed (nothing dropped)', () => { const e = W.parse('אימון A 2.11\nחזה - 2*3*4, 8-10', { now: new Date(NOW) }).sessions[0].exercises[0]; return J(e.unparsed) === '["2*3*4","8-10"]' ? '' : J(e); });
check('format / setText: "28*6+5", "6+5", "28*6+24*5"; parse(format(x)) round trip', () => {
  const text = 'אימון A 2.11\nחזה - 28*6+5, 24*8\nמתח - 6+5\nכתפיים - 28*6+24*5';
  const s = W.parse(text, { now: new Date(NOW) }).sessions; const f = W.format(s, { now: new Date(NOW) });
  const back = W.parse(f, { now: new Date(NOW) }).sessions[0];
  return /28\*6\+5/.test(f) && /מתח - 6\+5/.test(f) && /28\*6\+24\*5/.test(f) && W.setText({ w: 28, r: 11, parts: [{ r: 6 }, { r: 5 }] }) === '28×6+5' && W.setText({ w: null, r: 8 }) === '8'
    && J(back.exercises.map((e) => e.sets.map((x) => [x.w, x.r, x.parts || null]))) === J(s[0].exercises.map((e) => e.sets.map((x) => [x.w, x.r, x.parts || null]))) ? '' : f;
});
check('identity: a combined set hashes differently from a plain set of the same total; plain sessions keep their old hash', () => {
  const a = { date: 'd', type: 'A', exercises: [{ label: 'x', sets: [{ w: 28, r: 11, parts: [{ r: 6 }, { r: 5 }] }] }] }, b = { date: 'd', type: 'A', exercises: [{ label: 'x', sets: [{ w: 28, r: 11 }] }] };
  return W.hashOf(a) !== W.hashOf(b) && W.setsKey(b) === 'x:28x11#' ? '' : W.setsKey(a);
});
check('first part rules: e1RM / PR / progression / range status use the FIRST part; volume uses the total', () => {
  const cx = { w: 28, r: 11, parts: [{ r: 6 }, { r: 5 }] };
  const t = W.targetsFor({ equip: 'dumbbell', step: 2, startW: 28, scheme: DESC }, [cx], []);
  const prs = W.prsFor({ exercises: [{ label: 'חזה', unit: 'kg', sets: [cx] }] }, [{ id: 'a', exercises: [{ label: 'חזה', unit: 'kg', sets: [{ w: 28, r: 7 }] }] }]);
  return W.firstR(cx) === 6 && W.firstR({ r: 9 }) === 9 && t[0].w === 30 && t[0].aim === 4 && !prs.length
    && W.volume({ exercises: [{ sets: [cx, { w: 20, r: 10 }, { w: null, r: 8 }] }] }) === 28 * 11 + 200 ? '' : J([t[0], prs]);
});
check('reducer: LOG_SET with parts stores r = the sum and the parts; bad parts are dropped; rest from the total', () => {
  const s = W.replay([{ type: 'START', at: NOW, program: { id: 'p', name: 'P', exercises: [{ label: 'חזה', equip: 'dumbbell', step: 2, scheme: DESC }] } },
    { type: 'LOG_SET', at: NOW + 1, ex: 0, w: 28, r: 6, parts: [{ r: 6 }, { r: 5 }] }, { type: 'LOG_SET', at: NOW + 2, ex: 0, w: 24, r: 8, parts: [{ r: 'x' }, null] }]);
  const x = s.exercises[0].sets;
  return x[0].r === 11 && J(x[0].parts) === J([{ r: 6 }, { r: 5 }]) && x[1].r === 8 && !x[1].parts && s.rest.total === 120 ? '' : J(x);
});
check('draft: an M1a v1 log (no parts) and a v2 log both replay; a finished session keeps the parts', () => {
  const v1 = W.replay([{ type: 'START', at: NOW, program: { id: 'p', name: 'P', exercises: [{ label: 'חזה' }] } }, { type: 'LOG_SET', at: NOW + 1, ex: 0, w: 20, r: 8 }]);
  const v2 = W.replay([{ type: 'START', at: NOW, program: { id: 'p', name: 'P', exercises: [{ label: 'חזה', equip: 'dumbbell', step: 2 }] } }, { type: 'LOG_SET', at: NOW + 1, ex: 0, w: 20, r: 8, parts: [{ r: 8 }, { r: 3 }] }]);
  const s = W.sessionFromLive(v2);
  return W.DRAFT_V === 2 && v1.exercises[0].sets[0].r === 8 && J(s.exercises[0].sets[0].parts) === J([{ r: 8 }, { r: 3 }]) && s.exercises[0].sets[0].r === 11 ? '' : J([v1, s]);
});

// ── 3. completed = locked ──
check('card: a saved live session for the routine + date = DONE even before completion; startBlock refuses a done instance', () => {
  const R = { id: 9, completedDates: [iso(4, 18)] }, S = [{ source: 'live', routineId: '9', dateStr: iso(4, 12) }];
  const r = [W.cardState({ now: NOW, dt: iso(4, 12), hasSession: true }), W.startBlock({ routine: R, dateStr: iso(4, 18), sessions: [] }), W.startBlock({ routine: R, dateStr: iso(4, 12), sessions: S }),
    W.startBlock({ routine: R, dateStr: iso(5, 18), sessions: S }), W.startBlock({ routine: null, dateStr: null, sessions: S })];
  return J(r) === J(['done', 'done', 'done', null, null]) ? '' : J(r);
});

// ── 4. swap within the group ──
const CAT = { aliases: { 'פרפר': { muscle: 'chest' } }, variants: { chest: ['לחיצת חזה בשיפוע'] } };
const PROGS = [{ days: [{ exercises: [{ label: 'חזה', muscle: 'chest' }, { label: 'מקבילים', muscle: 'triceps' }, { label: 'לחיצה במכונה', muscle: 'chest' }] }] }];
check('muscle group: the exercise\'s own, else the catalog, else the default aliases, else other', () => J([W.muscleKey({ label: 'x', muscle: 'legs' }), W.muscleKey({ label: 'פרפר' }, CAT), W.muscleKey({ label: 'חזה' }), W.muscleKey({ label: 'משהו' })]) === J(['legs', 'chest', 'chest', 'other']) ? '' : 'x');
check('variants: SAME group only — the owner\'s added ones first, then the programs, then the defaults; no duplicates; the current one excluded', () => {
  const v = W.variantsFor('chest', { programs: PROGS, catalog: CAT, exclude: 'חזה' });
  return v[0] === 'לחיצת חזה בשיפוע' && v.includes('לחיצה במכונה') && !v.includes('חזה') && !v.includes('מקבילים') && new Set(v).size === v.length && v.length >= 4 ? '' : J(v);
});
check('reducer SWAP_EXERCISE: replaces the exercise for THIS session only, keeps the original name (swapOf) and the group; refused once sets are logged', () => {
  const base = [{ type: 'START', at: NOW, program: { id: 'p', name: 'P', exercises: [{ label: 'חזה', muscle: 'chest', equip: 'dumbbell', step: 2, scheme: DESC }, { label: 'מתח', equip: 'bodyweight', step: 0 }] } }];
  const s = W.replay([...base, { type: 'SWAP_EXERCISE', at: NOW + 1, ex: 0, exercise: { label: 'פרפר', equip: 'machine' } }, { type: 'SWAP_EXERCISE', at: NOW + 2, ex: 0, exercise: { label: 'לחיצת חזה בשיפוע', equip: 'dumbbell' } }]);
  const e = s.exercises[0], fin = W.sessionFromLive(W.replay([...base, { type: 'SWAP_EXERCISE', at: NOW + 1, ex: 0, exercise: { label: 'פרפר', equip: 'machine' } }, { type: 'LOG_SET', at: NOW + 2, ex: 0, w: 5, r: 8 }]));
  const locked = W.replay([...base, { type: 'LOG_SET', at: NOW + 1, ex: 1, r: 8 }, { type: 'SWAP_EXERCISE', at: NOW + 2, ex: 1, exercise: { label: 'חתירה' } }]);
  return e.label === 'לחיצת חזה בשיפוע' && e.swapOf === 'חזה' && e.muscle === 'chest' && e.step === 2 && fin.exercises[0].swapOf === 'חזה' && fin.exercises[0].muscle === 'chest' && locked.exercises[1].label === 'מתח' ? '' : J([e, fin.exercises[0], locked.exercises[1]]);
});

// ── 5. notes per muscle group ──
check('notes: one per group, in the order the groups first appear; empty notes skipped', () => {
  const n = W.notesFor([{ label: 'חזה', muscle: 'chest' }, { label: 'פרפר', muscle: 'chest' }, { label: 'מתח' }, { label: 'רגליים', muscle: 'legs' }], { notes: { chest: 'מרפקים צמודים', back: 'לאט למטה', legs: '  ' } });
  return J(n) === J([{ muscle: 'chest', text: 'מרפקים צמודים' }, { muscle: 'back', text: 'לאט למטה' }]) ? '' : J(n);
});
check('first of its group: the note shows before the FIRST exercise of that group only', () => { const ex = [{ label: 'חזה', muscle: 'chest' }, { label: 'מתח' }, { label: 'פרפר', muscle: 'chest' }]; return J([0, 1, 2].map((i) => W.firstOfGroup(ex, i, null))) === '[true,true,false]' ? '' : 'x'; });
check('string table: the new UI strings exist (keypad, step, + part, swap, remember, note, locked)', () => { const U = W.TEXT.ui; const miss = ['typeW', 'stepT', 'addPart', 'swap', 'swapT', 'remember', 'addVariant', 'noteT', 'noteEdit', 'locked'].filter((k) => !U[k]); return miss.length ? J(miss) : W.TEXT.variants && W.TEXT.variants.chest.length >= 3 ? '' : 'variants'; });

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
