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
  return U.finishHere === 'סיים אימון כאן' && U.exDoneOf(2, 6) === '2 מתוך 6 תרגילים בוצעו' && U.savePartial === 'סיים ושמור כאימון חלקי' && U.discardW === 'בטל בלי לשמור' && U.partialT(2, 6) === 'אימון חלקי · 2 מתוך 6 תרגילים' ? '' : 'missing';
});

let bad = 0; rows.forEach(([n, e], i) => { if (e) bad++; console.log(`${String(i + 1).padStart(2)}. ${e ? 'FAIL' : 'PASS'}  ${n}${e ? '\n      ' + e : ''}`); });
console.log(`\n${rows.length - bad}/${rows.length} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
