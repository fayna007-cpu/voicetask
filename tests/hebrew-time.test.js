// Run: node tests/hebrew-time.test.js      (no dependencies)
// "now" is fixed to Wed 2026-11-04 10:00 Asia/Jerusalem (08:00Z, standard time) unless a case says otherwise.
const { parseHebrewDateTime: parse, toDate } = require('../hebrew-time.js');

const NOW = '2026-11-04T08:00:00Z';
const rows = [];
function check(name, fn) {
  let err = '';
  try { err = fn() || ''; } catch (e) { err = 'THREW ' + e.message; }
  rows.push({ name, ok: !err, err });
}
// c: [name, text, expected{date,time,title}, ambiguity reason|null, optional list of "date time" option strings, optional now]
function parseCase(name, text, exp, amb, optList, now) {
  check(name, () => {
    const r = parse(text, { now: new Date(now || NOW) });
    for (const k of Object.keys(exp)) {
      const got = k === 'alt' ? (r.alternative ? r.alternative.date + ' ' + r.alternative.time : null) : r[k];   // alt = flip chip "date time"
      if (got !== exp[k]) return `${k}: got ${JSON.stringify(got)}, want ${JSON.stringify(exp[k])}`;
    }
    const got = r.ambiguity ? r.ambiguity.reason : null;
    if (got !== amb) return `ambiguity: got ${got}, want ${amb}`;
    if (optList) {
      const o = r.ambiguity.options.filter(x => !x.pick).map(x => x.date + ' ' + x.time);
      if (JSON.stringify(o) !== JSON.stringify(optList)) return `options: got ${JSON.stringify(o)}, want ${JSON.stringify(optList)}`;
      if (!r.ambiguity.options.some(x => x.pick) && amb === 'past') return 'past ambiguity must offer a "pick another" option';
    }
    return '';
  });
}

// ── The cases the spec names ────────────────────────────────────────────────
parseCase('מחר ב-18:00 לקנות חלב', 'מחר ב-18:00 לקנות חלב', { date: '2026-11-05', time: '18:00', title: 'לקנות חלב', ok: true }, null);
parseCase('היום בערב', 'היום בערב', { date: '2026-11-04', time: '19:00', title: '' }, null);
parseCase('ביום שישי בצהריים', 'ביום שישי בצהריים', { date: '2026-11-06', time: '13:00', title: '' }, null);
parseCase('אימון ביום שישי בצהריים (title)', 'אימון ביום שישי בצהריים', { date: '2026-11-06', time: '13:00', title: 'אימון' }, null);
parseCase('בעוד שעה', 'בעוד שעה', { date: '2026-11-04', time: '11:00', title: '' }, null);
parseCase('בעוד 30 דקות', 'בעוד 30 דקות', { date: '2026-11-04', time: '10:30' }, null);
parseCase('עוד חצי שעה', 'עוד חצי שעה', { date: '2026-11-04', time: '10:30' }, null);
parseCase('מחרתיים בבוקר', 'מחרתיים בבוקר', { date: '2026-11-06', time: '08:00' }, null);
parseCase('ב-5 לדצמבר (date, no time)', 'ב-5 לדצמבר', { date: '2026-12-05', time: null, ok: true }, null);
parseCase('5/12 + title', '5/12 לשלם ארנונה', { date: '2026-12-05', time: null, title: 'לשלם ארנונה' }, null);
parseCase('5.12 is a date (valid D.M)', '5.12 פגישה', { date: '2026-12-05', time: null, title: 'פגישה' }, null);
parseCase('18.30 is a time (30 is no month)', '18.30 פגישה', { date: '2026-11-04', time: '18:30', title: 'פגישה' }, null);
parseCase('date already passed this year -> next year', '3/11 יום הולדת', { date: '2027-11-03', time: null, title: 'יום הולדת' }, null);

// ── Windows / bare hours ─────────────────────────────────────────────────────
parseCase('ב-7 בערב -> PM', 'מחר ב-7 בערב', { date: '2026-11-05', time: '19:00' }, null);
parseCase('בשעה 6 אחה"צ -> PM', 'מחר בשעה 6 אחה"צ', { date: '2026-11-05', time: '18:00' }, null);
parseCase('ב-8 בבוקר -> AM', 'מחר ב-8 בבוקר', { date: '2026-11-05', time: '08:00' }, null);
parseCase('10 בלילה -> 22:00', 'מחר ב-10 בלילה', { date: '2026-11-05', time: '22:00' }, null);
parseCase('typed date + 2 בלילה -> 02:00 of the night AFTER that date', 'מחר ב-2 בלילה', { date: '2026-11-06', time: '02:00' }, null);
parseCase('typed date + 12 בלילה -> the midnight after that date', 'מחר ב-12 בלילה', { date: '2026-11-06', time: '00:00' }, null);
parseCase('typed future date, bare 7 -> 07:00 + flip to 19:00', 'מחר ב-7', { date: '2026-11-05', time: '07:00', alt: '2026-11-05 19:00' }, null);
parseCase('typed היום, bare 9 at 10:00 -> 21:00 (only future reading), no flip', 'היום ב-9', { date: '2026-11-04', time: '21:00', alt: null }, null);

// ── Bare hours: no question, preselect + flip chip (now = Wed 10:00 unless stated) ────────────────
parseCase('"ב-7" -> 19:00 today, flip = tomorrow 07:00', 'ב-7', { date: '2026-11-04', time: '19:00', alt: '2026-11-05 07:00', ok: true }, null);
parseCase('"ב-7" at 20:00 -> tomorrow 07:00, flip = tomorrow 19:00', 'ב-7', { date: '2026-11-05', time: '07:00', alt: '2026-11-05 19:00' }, null, null, '2026-11-04T18:00:00Z');
parseCase('"ב-3" -> 15:00 (hours 1-6 are PM)', 'ב-3', { date: '2026-11-04', time: '15:00' }, null);
parseCase('"בשעה 3" -> 15:00', 'בשעה 3 פגישה', { date: '2026-11-04', time: '15:00', title: 'פגישה' }, null);
parseCase('"ב-9" at 08:00 -> 09:00 today, flip = 21:00', 'ב-9', { date: '2026-11-04', time: '09:00', alt: '2026-11-04 21:00' }, null, null, '2026-11-04T06:00:00Z');
parseCase('"ב-9" at 23:00 -> tomorrow 09:00', 'ב-9', { date: '2026-11-05', time: '09:00', alt: '2026-11-05 21:00' }, null, null, '2026-11-04T21:00:00Z');
parseCase('"ב-12" -> 12:00, no flip', 'ב-12', { date: '2026-11-04', time: '12:00', alt: null }, null);
parseCase('"ב-5 ורבע" -> 17:15 + flip 05:15', 'מחר ב-5 ורבע', { date: '2026-11-05', time: '17:15', alt: '2026-11-05 05:15' }, null);
parseCase('explicit window beats the heuristic: ב-7 בבוקר tomorrow', 'מחר ב-7 בבוקר', { date: '2026-11-05', time: '07:00', alt: null }, null);
parseCase('typed היום, both readings passed -> past ambiguity (not moved)', 'היום ב-7', { date: '2026-11-04', time: null }, 'past', ['2026-11-05 07:00', '2026-11-05 19:00'], '2026-11-04T18:00:00Z');
parseCase('number before a window needs no "ב": "מחר 7 בערב"', 'מחר 7 בערב פגישה', { date: '2026-11-05', time: '19:00', title: 'פגישה' }, null);
parseCase('"3 אחה"צ" -> 15:00', '3 אחה"צ', { date: '2026-11-04', time: '15:00' }, null);
parseCase('"10 בלילה" -> 22:00', '10 בלילה', { date: '2026-11-04', time: '22:00', alt: null }, null);
parseCase('"12 בלילה" -> the coming midnight', '12 בלילה', { date: '2026-11-05', time: '00:00' }, null);
parseCase('"2 בלילה" -> 02:00 of the coming night', '2 בלילה', { date: '2026-11-05', time: '02:00' }, null);
parseCase('"2 בלילה" at 01:00 -> still ahead tonight', '2 בלילה', { date: '2026-11-04', time: '02:00' }, null, null, '2026-11-03T23:00:00Z');
parseCase('leading zero = 24h, no question', 'מחר ב-08:30', { date: '2026-11-05', time: '08:30' }, null);

// ── Past time, midnight, weekdays ────────────────────────────────────────────
parseCase('past time today -> ambiguity, NOT moved', 'היום ב-8 בבוקר', { date: '2026-11-04', time: '08:00' }, 'past', ['2026-11-05 08:00']);
parseCase('00:30 with no date (past) -> ambiguity', 'ב-00:30 לקום', { date: '2026-11-04', time: '00:30', title: 'לקום' }, 'past', ['2026-11-05 00:30']);
parseCase('מחר 00:30 is fine', 'מחר ב-00:30', { date: '2026-11-05', time: '00:30' }, null);
parseCase('Friday', 'ביום שישי', { date: '2026-11-06', time: null }, null);
parseCase('Saturday (בשבת)', 'בשבת ב-20:00', { date: '2026-11-07', time: '20:00' }, null);
parseCase('same weekday as today -> next week', 'ביום רביעי', { date: '2026-11-11', time: null }, null);
parseCase('weekday + בשבוע הבא', 'ביום חמישי בשבוע הבא', { date: '2026-11-12', time: null }, null);
parseCase('בשבוע הבא alone = +7 days', 'בשבוע הבא', { date: '2026-11-11', time: null }, null);
parseCase('הערב + title', 'הערב: סידורים', { date: '2026-11-04', time: '19:00', title: 'סידורים' }, null);

// ── Regressions found by exploratory runs ───────────────────────────────────
parseCase('"2.5 ק"ג" is a quantity, not a date', 'לקנות 2.5 ק"ג עגבניות', { ok: false, date: null, time: null, title: 'לקנות 2.5 ק"ג עגבניות' }, null);
parseCase('"12.50 ש"ח" is a price, not a time', 'לשלם 12.50 ש"ח', { ok: false, time: null }, null);
parseCase('ב-7 וחצי בערב = 19:30', 'מחר ב-7 וחצי בערב', { date: '2026-11-05', time: '19:30', title: '' }, null);
parseCase('orphan separators collapse in title', 'תזכורת: מחר בבוקר: סידורים', { date: '2026-11-05', time: '08:00', title: 'תזכורת: סידורים' }, null);

parseCase('"ארוחת ערב" is a meal, not 19:00 — title kept intact', 'להזמין שולחן לארוחת ערב', { ok: false, date: null, time: null, title: 'להזמין שולחן לארוחת ערב' }, null);
parseCase('"ארוחת בוקר" keeps its words; "מחר" still parsed', 'ארוחת בוקר מחר', { date: '2026-11-05', time: null, title: 'ארוחת בוקר' }, null);
parseCase('"בשני סוגים" is not Monday', 'לקנות בשני סוגים', { ok: false, date: null, title: 'לקנות בשני סוגים' }, null);
parseCase('"ביום שני" is Monday', 'ביום שני ב-20:00', { date: '2026-11-09', time: '20:00' }, null);
parseCase('bare "בשישי" is Friday', 'בשישי', { date: '2026-11-06', time: null }, null);

// ── No time / garbage ────────────────────────────────────────────────────────
parseCase('date, no time -> time:null', 'מחר לקנות חלב', { date: '2026-11-05', time: null, title: 'לקנות חלב', ok: true }, null);
parseCase('plain title -> ok:false', 'לקנות חלב', { ok: false, date: null, time: null, title: 'לקנות חלב' }, null);
parseCase('invalid time 25:99 is ignored', 'ב-25:99', { ok: false, date: null, time: null }, null);
parseCase('invalid date 31/2 is ignored', '31/2', { ok: false, date: null }, null);
check('garbage input never throws, ok:false', () => {
  for (const g of ['', '   ', '???', 'asdf', null, undefined, 12345, {}, [], '\u0000‮', 'ב-', ':::']) {
    const r = parse(g, { now: new Date(NOW) });
    if (r.ok !== false || r.date !== null || r.time !== null || r.ambiguity !== null) return 'bad result for ' + JSON.stringify(g);
  }
  if (parse('מחר', {}).ok !== true) return 'missing opts object failed';
  if (parse('מחר', { now: 'garbage' }).ok !== true) return 'invalid now failed';
  return '';
});

// ── Midnight rollover + DST (computed with Intl, no hardcoded offsets) ──────
parseCase('rollover: 23:50 + 20 min -> next day 00:10', 'בעוד 20 דקות', { date: '2026-11-05', time: '00:10' }, null, null, '2026-11-04T21:50:00Z');
parseCase('spring DST (27/3/26 02:00->03:00): 00:30 + 3h = 04:30', 'בעוד 3 שעות', { date: '2026-03-27', time: '04:30' }, null, null, '2026-03-26T22:30:00Z');
parseCase('autumn DST (25/10/26 02:00->01:00): 00:30 + 3h = 02:30', 'בעוד 3 שעות', { date: '2026-10-25', time: '02:30' }, null, null, '2026-10-24T21:30:00Z');
check('toDate winter (+02:00): 2026-03-26 12:00 = 10:00Z', () => { const d = toDate('2026-03-26', '12:00'); return d && d.toISOString() === '2026-03-26T10:00:00.000Z' ? '' : String(d); });
check('toDate summer (+03:00): 2026-03-27 12:00 = 09:00Z', () => { const d = toDate('2026-03-27', '12:00'); return d && d.toISOString() === '2026-03-27T09:00:00.000Z' ? '' : String(d); });
check('toDate after autumn change: 2026-10-26 12:00 = 10:00Z', () => { const d = toDate('2026-10-26', '12:00'); return d && d.toISOString() === '2026-10-26T10:00:00.000Z' ? '' : String(d); });
check('toDate bad input -> null, no throw', () => (toDate('x', 'y') === null && toDate(null, null) === null ? '' : 'not null'));
check('parse "now" in summer: tomorrow 18:00 is date-correct', () => {
  const r = parse('מחר ב-18:00', { now: new Date('2026-07-10T21:30:00Z') });   // 00:30 Sat 11/7 Jerusalem
  return r.date === '2026-07-12' && r.time === '18:00' ? '' : JSON.stringify(r);
});

// ── Report ───────────────────────────────────────────────────────────────────
const w = Math.max(...rows.map(r => r.name.length));
rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}${r.ok ? '' : '  <- ' + r.err}`));
const failed = rows.filter(r => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
