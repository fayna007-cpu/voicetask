// node tests/routine-schedule.test.js — routine scheduling (D2). Runs itself under TZ=Asia/Jerusalem AND TZ=UTC.
const { spawnSync } = require('child_process');
if (!process.env.RS_CHILD) {
  let bad = 0;
  for (const tz of ['Asia/Jerusalem', 'UTC']) {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, RS_CHILD: '1' }, encoding: 'utf8' });
    process.stdout.write(`── TZ=${tz}\n${r.stdout}${r.stderr}`);
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}
const R = require('../routine-schedule.js');
const TZ = 'Asia/Jerusalem';
const rows = []; const check = (name, fn) => { let err = ''; try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.stack.split('\n').slice(0, 2).join(' '); } rows.push({ name, err }); };
const at = (s) => new Date(s);                                                // explicit offsets below
const wd = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(iso));
const hm = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const ymd = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const show = (ps) => ps.map((p) => `${wd(p.iso)} ${ymd(p.iso).slice(8)} ${hm(p.iso)}`).join(', ');
const pat = (spec) => R.weeklyPattern(spec).map((p) => `${p.dow}@${p.time}`).join(',');
const T1 = '3 פעמים בשבוע, פעמיים באמצע שבוע בערב, ועוד פעם אחת ביום שישי בצהריים';
const T2 = '3 אימונים בשבוע בסה״כ, מתוכם פעמיים באמצע שבוע בערב עם הפרש של יום ביניהם, ועוד פעם אחת ביום שישי בצהריים';
const NOW = at('2026-11-06T09:26:00+02:00');                                   // Fri 6 Nov 2026, 09:26

for (const [k, t] of [['breakdown phrasing', T2], ['short phrasing', T1]]) {
  check(`${k}: exactly 3 slots (never additive), Mon 18:00 + Wed 18:00 (one free day) + Fri 13:00`, () => {
    const p = R.parseRoutineDescription(t);
    return p.ok && R.perWeek(p) === 3 && pat(p) === '1@18:00,3@18:00,5@13:00' && !p.note ? '' : JSON.stringify({ ok: p.ok, n: p.ok && R.perWeek(p), pat: p.ok && pat(p), note: p.note });
  });
}
const S2 = R.parseRoutineDescription(T2);
for (const [start, want] of [['2026-11-08', 'Mon 09 18:00, Wed 11 18:00, Fri 13 13:00'], ['2026-11-06', 'Fri 06 13:00, Mon 09 18:00, Wed 11 18:00'], ['2026-11-11', 'Wed 11 18:00, Fri 13 13:00, Mon 16 18:00']]) {
  check(`"התחל מ" ${start} (now Fri 6/11 09:26) -> the next 3 occurrences: ${want}`, () => { const g = show(R.generateProposals(S2, start, NOW)); return g === want ? '' : g; });
}
check('"התחל מ" today after 13:00: Friday noon has passed -> skipped, still exactly 3', () => {
  const g = R.generateProposals(S2, '2026-11-06', at('2026-11-06T15:00:00+02:00'));
  return g.length === 3 && show(g) === 'Mon 09 18:00, Wed 11 18:00, Fri 13 13:00' ? '' : show(g);
});
check('midweek pair: Tue+Thu only when Mon/Wed are busy (Thu touches Fri otherwise)', () => {
  const g = R.weeklyPattern(S2, { busyDays: [1] }).map((p) => p.dow).join(',');
  return g === '2,4,5' ? '' : g;
});
check('"ועוד" WITHOUT a leading total is additive (2 slots)', () => {
  const p = R.parseRoutineDescription('ביום ראשון בבוקר ועוד פעם ביום רביעי בערב');
  return p.ok && R.perWeek(p) === 2 && pat(p) === '0@07:00,3@18:00' ? '' : JSON.stringify(p);
});
check('parts summing to MORE than the total -> the parts are used + a text note', () => {
  const p = R.parseRoutineDescription('2 פעמים בשבוע, פעמיים באמצע שבוע ועוד פעם ביום שישי');
  return p.ok && R.perWeek(p) === 3 && /יותר מ-2/.test(p.note) ? '' : JSON.stringify(p);
});
check('parts summing to LESS than the total -> the remainder become flexible slots', () => {
  const p = R.parseRoutineDescription('4 פעמים בשבוע, פעם אחת ביום שישי בצהריים');
  const days = R.weeklyPattern(p).map((x) => x.dow);
  return p.ok && R.perWeek(p) === 4 && days.length === 4 && days.includes(5) && days.filter((d) => d !== 5).every((d) => d <= 4) && !p.note ? '' : JSON.stringify({ p, days });
});
check('"3 פעמים בשבוע" (no days at all) -> spread over Sun-Thu: Sun, Tue, Thu', () => { const p = R.parseRoutineDescription('3 פעמים בשבוע'); return pat(p) === '0@07:00,2@07:00,4@07:00' ? '' : pat(p); });
check('"כל יום ראשון" -> Sunday only, 1 per week', () => { const p = R.parseRoutineDescription('כל יום ראשון'); return p.ok && R.perWeek(p) === 1 && pat(p) === '0@07:00' ? '' : JSON.stringify(p); });
check('"ב׳ ו-ד׳ בערב" -> Mon + Wed 18:00', () => { const p = R.parseRoutineDescription('ב׳ ו-ד׳ בערב'); return p.ok && pat(p) === '1@18:00,3@18:00' ? '' : JSON.stringify(p); });
check('"בערב ב-17:30" -> the explicit time wins over the evening default', () => { const p = R.parseRoutineDescription('פעמיים בשבוע בערב ב-17:30'); return pat(p) === '0@17:30,3@17:30' ? '' : pat(p); });
check('"ברצף" allows consecutive days', () => { const p = R.parseRoutineDescription('3 פעמים בשבוע ברצף בערב'); return pat(p) === '0@18:00,1@18:00,2@18:00' ? '' : pat(p); });
check('"סופ״ש" = Friday; Saturday only when written', () => {
  const a = R.parseRoutineDescription('פעם בסופש בבוקר'), b = R.parseRoutineDescription('פעם אחת בשבת בבוקר');
  return pat(a) === '5@07:00' && pat(b) === '6@07:00' ? '' : pat(a) + ' | ' + pat(b);
});
for (const q of ['"', '״', '“', '”', '″']) {
  check(`quotes: "בסה${q}כ" (U+${q.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) parses to the same 3 slots (Mon+Wed evening, one free day, Fri noon)`, () => {
    const p = R.parseRoutineDescription(`3 אימונים בשבוע בסה${q}כ, מתוכם פעמיים באמצע שבוע בערב עם הפרש של יום ביניהם, ועוד פעם אחת ביום שישי בצהריים`);
    return p.ok && R.perWeek(p) === 3 && pat(p) === '1@18:00,3@18:00,5@13:00' && !p.note ? '' : JSON.stringify({ pat: p.ok && pat(p), note: p.note });
  });
  check(`quotes: "אחה${q}צ" -> the afternoon window (13:00)`, () => { const p = R.parseRoutineDescription(`פעם אחת ביום שישי אחה${q}צ`); return pat(p) === '5@13:00' ? '' : JSON.stringify(p); });
}
for (const a of ["'", '’', '׳']) {
  check(`apostrophes: "ב${a} ו-ד${a} בערב" (U+${a.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) -> Mon + Wed 18:00`, () => { const p = R.parseRoutineDescription(`ב${a} ו-ד${a} בערב`); return pat(p) === '1@18:00,3@18:00' ? '' : JSON.stringify(p); });
}
// D3: dates that already have an instance of THIS routine are skipped; N NEW proposals; never two on one day.
const LEGACY = R.normalizeRoutine({ timesPerWeek: 4, preferredDays: [1, 1, 3, 3, 5, 5], scheduleMode: 'verbal', verbCondition: T1, verbParsed: { timesPerWeek: 4 } });   // legacy-shaped corrupted record
const FRI9 = at('2026-11-06T09:00:00+02:00'), SAT9 = at('2026-11-07T09:00:00+02:00');
const D3 = [
  ['(a) Fri 6 09:00, existing Fri 6 10:00, start today', '2026-11-06', FRI9, ['2026-11-06T08:00:00.000Z'], 'Mon 09 18:00, Wed 11 18:00, Fri 13 13:00'],
  ['(b) the same, start Sun 8', '2026-11-08', FRI9, ['2026-11-06T08:00:00.000Z'], 'Mon 09 18:00, Wed 11 18:00, Fri 13 13:00'],
  ['(c) Sat 7 09:00, existing manual Sat 7 14:00', '2026-11-07', SAT9, ['2026-11-07T12:00:00.000Z'], 'Mon 09 18:00, Wed 11 18:00, Fri 13 13:00'],
  ['(d) existing Mon 9 + Wed 11', '2026-11-07', SAT9, ['2026-11-09T16:00:00.000Z', '2026-11-11T16:00:00.000Z'], 'Fri 13 13:00, Mon 16 18:00, Wed 18 18:00'],
  ['(e) start Tue 10', '2026-11-10', SAT9, [], 'Wed 11 18:00, Fri 13 13:00, Mon 16 18:00'],
  ['(f) no existing instance (as before)', '2026-11-06', FRI9, [], 'Fri 06 13:00, Mon 09 18:00, Wed 11 18:00'],
  ['(g) an existing COMPLETED/passed instance on a pattern day also blocks that day', '2026-11-08', SAT9, ['2026-11-09T05:00:00.000Z'], 'Wed 11 18:00, Fri 13 13:00, Mon 16 18:00'],
];
for (const [name, start, now, existing, want] of D3) {
  for (const [kind, spec] of [['clean', S2], ['legacy', LEGACY]]) {
    check(`D3 ${name} [${kind}] -> ${want}`, () => {
      const g = R.generateProposals(spec, start, now, { existing });
      const days = g.map((p) => ymd(p.iso)), taken = existing.map(ymd);
      return show(g) === want && new Set(days).size === days.length && !days.some((d) => taken.includes(d)) ? '' : show(g);
    });
  }
}
check('garbage -> ok:false with a short note', () => { const p = R.parseRoutineDescription('בלה בלה בלה'); return !p.ok && p.note ? '' : JSON.stringify(p); });
check('corrupted routine (×4, duplicate days, verbal): normalizeRoutine derives 3 from the description and does NOT mutate it', () => {
  const r = { id: 7, timesPerWeek: 4, preferredDays: [1, 1, 3, 3, 5, 5], scheduleMode: 'verbal', verbCondition: T1, verbParsed: { timesPerWeek: 4 }, scheduledWeeks: { '2026-11-01': [{ dt: '2026-11-02T16:00:00.000Z', eventId: 'e1' }] } };
  const before = JSON.stringify(r), s = R.normalizeRoutine(r), d = R.derive(s);
  return JSON.stringify(r) === before && d.perWeek === 3 && d.days.join() === '1,3,5' && d.daysLabel === 'ב׳+ד׳+ו׳' ? '' : JSON.stringify(d);
});
check('manual mode keeps its behaviour (next N of the chosen days), days deduped, count from the stepper', () => {
  const s = R.normalizeRoutine({ timesPerWeek: 2, preferredDays: [3, 1, 1, 3], timeWindow: 'evening', scheduleMode: 'manual' });
  const g = R.generateProposals(s, '2026-11-08', NOW), d = R.derive(s);
  return show(g) === 'Mon 09 18:00, Wed 11 18:00' && d.days.join() === '1,3' && d.perWeek === 2 ? '' : show(g) + ' ' + JSON.stringify(d);
});
check('manual mode with no chosen days -> "ימים גמישים" (any day; not "כל יום")', () => { const d = R.derive(R.normalizeRoutine({ timesPerWeek: 1, preferredDays: [], timeWindow: 'morning' })); return d.flexible && d.daysLabel === 'ימים גמישים' ? '' : JSON.stringify(d); });
check('plural helper: "פגישה אחת", "3 פגישות", "מופע אחד"', () => { const g = [R.plural(1, 'meeting'), R.plural(3, 'meeting'), R.plural(1, 'instance')].join('|'); return g === 'פגישה אחת|3 פגישות|מופע אחד' ? '' : g; });
// property: 400 consecutive start days across both 2026 DST changes (27 Mar, 25 Oct), 4 times of day, 3 specs
check('PROPERTY 400 days x 00:30/08:00/19:00/23:30 x 3 specs: count == proposals, all after now and on/after the start, weekday (Intl, Jerusalem) and wall time match the pattern, no duplicate day', () => {
  const specs = [S2, R.parseRoutineDescription('3 פעמים בשבוע'), R.normalizeRoutine({ timesPerWeek: 3, preferredDays: [0, 2, 4, 6], timeWindow: 'specific', specificTime: '06:15' })];
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    for (const t of ['00:30', '08:00', '19:00', '23:30']) {
      const now = require('../hebrew-time.js').toDate(day, t);
      for (const s of specs) {
        const g = R.generateProposals(s, day, now), want = R.perWeek(s), p = R.weeklyPattern(s);
        if (g.length !== want) return `${day} ${t}: ${g.length} != ${want}`;
        const days = new Set();
        for (const x of g) {
          const d = new Date(x.iso);
          if (!(d > now) || ymd(x.iso) < day) return `${day} ${t}: ${x.iso} not after now/start`;
          if (DOW[wd(x.iso)] !== x.dow) return `${day} ${t}: weekday ${wd(x.iso)} != ${x.dow}`;
          if (p.length && !p.some((q) => q.dow === x.dow && q.time === hm(x.iso))) return `${day} ${t}: ${wd(x.iso)} ${hm(x.iso)} not in pattern`;
          if (!p.length && hm(x.iso) !== '06:15') return `${day} ${t}: manual time ${hm(x.iso)}`;
          if (days.has(ymd(x.iso))) return `${day} ${t}: duplicate day ${ymd(x.iso)}`;
          days.add(ymd(x.iso)); n++;
        }
      }
    }
  }
  return n === 400 * 4 * 9 ? '' : 'checked ' + n;
});

rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.err ? 'FAIL' : 'PASS'}  ${r.name}${r.err ? '  <- ' + r.err : ''}`));
const failed = rows.filter((r) => r.err).length;
console.log(`\n${rows.length - failed}/${rows.length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
