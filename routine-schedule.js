// Routine scheduling: ONE source of truth for a routine's weekly pattern. PURE: no DOM, no storage, no network.
// Browser: window.RSchedule (needs hebrew-time.js loaded first). Node: module.exports (tests).
//   spec  = { slots:[{days:[0-6]|null, count, window|null, time:'HH:MM'|null, gap, run, pick}], total, note }
//   perWeek, the days label and the proposals are DERIVED from spec.slots (never edited separately).
(function (root, factory) {
  var T = typeof module === 'object' && module.exports ? require('./hebrew-time.js') : (root.QAdd && root.QAdd.time);
  var api = factory(T);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RSchedule = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  var TZ = 'Asia/Jerusalem';
  // The ROUTINE system's existing window defaults (schedule screen: evening 18:00, noon 13:00). Not changed here.
  var WIN_TIME = { morning: '07:00', afternoon: '13:00', evening: '18:00' };
  var SUN_THU = [0, 1, 2, 3, 4], MIDWEEK = [1, 2, 3, 4], ALL = [0, 1, 2, 3, 4, 5, 6];
  var DAY_WORD = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
  var DAY_LETTER = { 'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5, 'ש': 6, 'שב': 6 };
  var NUM = { 'אחת': 1, 'אחד': 1, 'פעם': 1, 'פעמיים': 2, 'שתיים': 2, 'שניים': 2, 'שתי': 2, 'שני': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'שבע': 7 };
  var NOUN = '(?:פעמים|אימונים|פגישות|מופעים|ריצות|פעילויות|אירועים|שיעורים|אימון|פעם)';
  var GAP = /הפרש של יום|יום ביניהם|יום בינ(?:יהם|יהן)|יום מנוחה|יום הפסקה|הפסקה של יום|יום הפרש|יום הפרדה|הפרדה של יום|לא ברצף|לא רצוף|לא ימים עוקבים|יום בין/;
  var RUN = /(?:^|\s)ברצף|ימים רצופים|רצוף(?:ים)?(?!\S)/;

  // ── helpers ──
  var uniq = function (a) { var o = []; (a || []).forEach(function (x) { x = +x; if (x >= 0 && x <= 6 && o.indexOf(x) < 0) o.push(x); }); return o.sort(function (p, q) { return p - q; }); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var dowOf = function (ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); };
  var addDays = function (ymd, n) { var p = ymd.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  var ymdIn = function (date) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date); };
  var toDate = function (ymd, hm) { return T.toDate(ymd, hm); };            // Jerusalem wall time -> Date (DST-safe)
  var slotTime = function (s) { return s.time || WIN_TIME[s.window] || null; };

  // ── parser: deterministic code; returns {ok, slots, total, note} ──
  function words(seg) { return seg.replace(/[,.;:!?()]/g, ' ').split(/[\s\-–]+/).filter(Boolean); }
  function daysIn(seg) {
    var out = [], ws = words(seg);
    ws.forEach(function (w, i) {
      var m = w.match(/^ו?ב?([אבגדהו]|שב?)['׳]$/);              // ב׳ / ו-ד׳ / שב׳
      if (m && DAY_LETTER[m[1]] != null) { out.push(DAY_LETTER[m[1]]); return; }
      var x = w.replace(/^ו?[בל]?/, '');
      if (DAY_WORD[x] == null) return;
      // "שני" is also "second"/"two": a day only after יום/ימי or with a ב/ו prefix ("בשני", "ושני")
      if (x === 'שני' && x === w && !/^ו?ב?(?:יום|ימי)$/.test(ws[i - 1] || '')) return;
      out.push(DAY_WORD[x]);
    });
    if (/סופ"?ש|סוף\s*(?:ה)?שבוע/.test(seg)) out.push(5);              // סופ"ש = Friday; Saturday only when written
    return uniq(out);
  }
  function windowIn(seg) {
    if (/בוקר/.test(seg)) return 'morning';
    if (/ערב|לילה/.test(seg)) return 'evening';
    if (/צהריים|צהרים|אחה"צ|אחר הצהריים/.test(seg)) return 'afternoon';
    return null;
  }
  function timeIn(seg) {
    var m = seg.match(/(?:^|[^\d:])(\d{1,2}):(\d{2})(?![\d:])/);
    if (m && +m[1] < 24 && +m[2] < 60) return pad(+m[1]) + ':' + m[2];
    m = seg.match(/(?:ב-?|בשעה\s+)(\d{1,2})(?![\d:\/.])/);
    if (m && +m[1] >= 1 && +m[1] <= 23) { var h = +m[1]; if (h <= 11 && /ערב|לילה|אחה"צ|צהריים/.test(seg)) h += 12; return pad(h) + ':00'; }
    return null;
  }
  function countIn(seg) {
    var m = seg.match(new RegExp('(?:^|\\s)(\\d+)\\s*' + NOUN));
    if (m) return +m[1];
    if (/(?:^|\s)ו?פעמיים(?=\s|$)/.test(seg)) return 2;
    m = seg.match(new RegExp('(?:^|\\s)(אחת|אחד|שתיים|שתי|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע)\\s*' + NOUN));
    if (m) return NUM[m[1]];
    m = seg.match(new RegExp('(?:^|\\s)' + NOUN.slice(0, -1) + ')\\s+(אחת|אחד|נוספת|נוסף)'));
    if (m) return 1;
    if (/(?:^|\s)(?:עוד\s+)?פעם(?=\s|$)/.test(seg)) return 1;
    return null;
  }
  // "3 פעמים בשבוע" / "3 אימונים בשבוע בסה״כ" at the start = the stated TOTAL.
  var TOTAL_RE = new RegExp('^\\s*(\\d+|פעמיים|אחת|שתיים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע)\\s*' + NOUN + '?\\s*(?:ב|ל)שבוע(\\s*(?:בסה["״\']?כ|בסך הכל|סך הכל))?');

  // Every quotation-mark variant -> ASCII " (בסה"כ, אחה"צ, סופ"ש); every apostrophe variant -> ׳ (ב׳, ד׳).
  var normQuotes = function (s) { return String(s || '').replace(/["״“”″]/g, '"').replace(/['’]/g, '׳'); };
  function parseRoutineDescription(text) {
    var t = normQuotes(text).replace(/\s+/g, ' ').trim();
    if (!t) return { ok: false, slots: [], total: null, note: 'אין תיאור' };
    var total = null, rest = t, m = t.match(TOTAL_RE);
    if (m) { total = m[1] === 'פעמיים' ? 2 : (NUM[m[1]] || +m[1]); rest = t.slice(m[0].length); }
    var gapAll = GAP.test(t), runAll = RUN.test(t);
    // parts: split on commas / "ועוד" / "מתוכם" / " ו" + a day/range/window word
    var parts = rest.replace(/^\s*[,:\-–]?\s*(?:מתוכם|מתוכן|מהם|מהן)?\s*/, '')
      // (JS \b does not work with Hebrew letters: explicit lookarounds)
      .split(/\s*(?:,|;|(?:^|\s)(?:ועוד|מתוכם|מתוכן|וגם)(?=\s|$)|\s(?=ו(?:ב|ל)?(?:אמצע|סוף|סופ|יום|ימי|ראשון|שלישי|רביעי|חמישי|שישי|שבת)))\s*/)
      .map(function (s) { return s.replace(/^ו/, '').replace(/^(?:ועוד|עוד)\s+/, '').trim(); }).filter(Boolean);
    var slots = [];
    parts.forEach(function (p) {
      var days = daysIn(p), range = /אמצע\s*(?:ה)?שבוע|ימי אמצע/.test(p) ? MIDWEEK : /ימי עבודה|ימי חול|ימי השבוע/.test(p) ? SUN_THU : /כל יום(?!\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת))|כל ערב|כל בוקר/.test(p) ? ALL : null;
      var cnt = countIn(p), win = windowIn(p), tm = timeIn(p);
      if (!days.length && !range && cnt == null && !win && !tm) return;   // filler ("עם הפרש של יום ביניהם" alone)
      if (range === ALL && cnt == null) cnt = 7;
      if (cnt == null) cnt = days.length || (total && !slots.length && parts.length === 1 ? total : 1);
      slots.push({ days: days.length ? days : (range ? range.slice() : null), count: cnt, window: win, time: tm, gap: GAP.test(p) || gapAll, run: RUN.test(p) || runAll, pick: 'spread', range: !days.length && !!range });
    });
    // a window/time stated once for the whole text (e.g. "3 פעמים בשבוע בערב") applies to slots without one
    var winAll = windowIn(m ? m[0] + ' ' + (parts.length ? '' : rest) : ''), tmAll = null;
    if (!slots.length && total) { winAll = windowIn(t); tmAll = timeIn(t); }
    var note = '';
    var sum = slots.reduce(function (a, s) { return a + s.count; }, 0);
    if (total) {
      if (!slots.length) slots.push({ days: null, count: total, window: winAll, time: tmAll, gap: gapAll, run: runAll, pick: 'spread', range: false });
      else if (sum < total) slots.push({ days: null, count: total - sum, window: null, time: null, gap: gapAll, run: runAll, pick: 'spread', range: false, flexible: true });
      else if (sum > total) note = 'החלקים מסתכמים ב-' + sum + ', יותר מ-' + total + ' שנכתבו — לפי החלקים';
    }
    if (!slots.length) return { ok: false, slots: [], total: total, note: 'לא הצלחתי להבין את התיאור' };
    return { ok: true, slots: slots, total: total, note: note };
  }

  // ── normalizer: any routine (verbal or manual, old or new) -> spec. Never writes the routine. ──
  function specFromManual(r) {
    var count = Math.max(1, Math.min(7, +r.timesPerWeek || 3));
    var time = r.timeWindow === 'specific' ? (r.specificTime || '07:00') : null;
    var days = uniq(r.preferredDays);
    // Manual mode keeps its behaviour: the next `count` of the chosen days (any day when none was chosen).
    return { slots: [{ days: days.length ? days : null, count: count, window: time ? null : (r.timeWindow || 'morning'), time: time, gap: false, run: true, pick: 'earliest', manualWin: true }], total: count, note: '' };
  }
  function normalizeRoutine(r) {
    if (r && r.spec && Array.isArray(r.spec.slots) && r.spec.slots.length) return r.spec;
    if (r && r.scheduleMode === 'verbal' && r.verbCondition) { var p = parseRoutineDescription(r.verbCondition); if (p.ok) return p; }
    return specFromManual(r || {});
  }
  var perWeek = function (spec) { return spec.slots.reduce(function (a, s) { return a + s.count; }, 0); };

  // ── weekly pattern: the concrete weekday + time of every 'spread' slot (exactly sum(count) entries) ──
  function choose(cands, k, taken, gap, run, busy) {
    cands = uniq(cands);
    var free = cands.filter(function (d) { return taken.indexOf(d) < 0; });
    if (k >= free.length) return free;
    if (run) { for (var i = 0; i + k <= free.length; i++) { var w = free.slice(i, i + k); if (w[k - 1] - w[0] === k - 1) return w; } return free.slice(0, k); }
    var combos = [];
    (function rec(start, acc) { if (acc.length === k) { combos.push(acc.slice()); return; } for (var j = start; j < free.length; j++) { acc.push(free[j]); rec(j + 1, acc); acc.pop(); } })(0, []);
    var circ = function (a, b) { var x = Math.abs(a - b); return Math.min(x, 7 - x); };
    function score(c) {
      var all = c.concat(taken), minGap = 9;
      for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++) minGap = Math.min(minGap, circ(all[i], all[j]));
      var exact = gap ? c.every(function (d, i) { return i === 0 || d - c[i - 1] === 2; }) : true;    // exactly ONE free day between
      var busyHits = c.filter(function (d) { return busy.indexOf(d) >= 0; }).length;
      return [exact ? 1 : 0, -busyHits, Math.min(minGap, 3), -c.reduce(function (a, b) { return a + b; }, 0)];
    }
    combos.sort(function (a, b) { var x = score(a), y = score(b); for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
    return combos[0];
  }
  function weeklyPattern(spec, opts) {
    var busy = (opts && opts.busyDays) || [], out = [], taken = [];
    // fixed days first (they constrain the flexible picks), then ranges, then fully flexible slots
    var order = spec.slots.map(function (s, i) { return i; }).sort(function (a, b) {
      var r = function (s) { return s.pick === 'earliest' ? 3 : s.days && !s.range ? 0 : s.days ? 1 : 2; };
      return r(spec.slots[a]) - r(spec.slots[b]);
    });
    order.forEach(function (i) {
      var s = spec.slots[i];
      if (s.pick === 'earliest') return;
      var cands = s.days || SUN_THU;                                  // no days at all -> Sun-Thu
      var chosen = s.days && !s.range && s.days.length <= s.count ? s.days.filter(function (d) { return taken.indexOf(d) < 0; }) : choose(cands, s.count, taken, s.gap, s.run, busy);
      chosen.forEach(function (d) { taken.push(d); out.push({ dow: d, time: slotTime(s) || WIN_TIME.morning, slot: i }); });
    });
    return out.sort(function (a, b) { return a.dow - b.dow || a.time.localeCompare(b.time); });
  }

  // ── proposals: N NEW occurrences of the weekly pattern from `startYmd` (D3) ──
  // A date on which THIS routine already has an instance (opts.existing: ISO list; completed or not, passed or
  // not) is skipped and the walk goes on (max 4 weeks), so "one left + N new" whatever the start date.
  // Slots already passed are skipped; never two proposals on one day.
  var WALK_DAYS = 28;
  function generateProposals(spec, startYmd, now, opts) {
    now = now || new Date();
    var N = perWeek(spec), pat = weeklyPattern(spec, opts), out = [], taken = {}, held = {};
    // existing = the routine's LIVE instances (listRoutineInstances: deduped, not skipped). Only those exact dates block.
    ((opts && opts.existing) || []).forEach(function (iso) { if (iso) { var y = ymdIn(new Date(iso)); taken[y] = true; held[y] = iso; } });
    out.skipped = [];                                            // pattern days passed over because an instance is there
    var early = spec.slots.filter(function (s) { return s.pick === 'earliest'; });
    var need = early.map(function (s) { return s.count; });
    var start = startYmd < ymdIn(now) ? ymdIn(now) : startYmd;
    var put = function (ymd, hm, dow, slot) { var d = toDate(ymd, hm); if (d > now && !taken[ymd] && out.length < N) { out.push({ iso: d.toISOString(), dow: dow, slot: slot }); taken[ymd] = true; return true; } return false; };
    for (var k = 0; k < WALK_DAYS && out.length < N; k++) {
      var ymd = addDays(start, k), dow = dowOf(ymd);
      if (taken[ymd]) { if (held[ymd] && pat.some(function (p) { return p.dow === dow; }) && new Date(held[ymd]) > now) out.skipped.push({ ymd: ymd, dow: dow, iso: held[ymd] }); continue; }
      pat.forEach(function (p) { if (p.dow === dow) put(ymd, p.time, dow, p.slot); });
      early.forEach(function (s, j) {
        if (need[j] <= 0 || (s.days && s.days.indexOf(dow) < 0)) return;
        var hm = s.time || (s.manualWin ? ({ morning: '07:00', afternoon: '14:00', evening: '18:00' })[s.window] : slotTime(s)) || '07:00';
        if (put(ymd, hm, dow, spec.slots.indexOf(s))) need[j]--;
      });
    }
    // manual mode with too few chosen days: fill from any day (the old "pass 2" behaviour)
    for (var e = 0; e < early.length; e++) for (var k2 = 0; k2 < WALK_DAYS && need[e] > 0; k2++) {
      var y2 = addDays(start, k2), s2 = early[e];
      if (put(y2, s2.time || ({ morning: '07:00', afternoon: '14:00', evening: '18:00' })[s2.window] || '07:00', dowOf(y2), spec.slots.indexOf(s2))) need[e]--;
    }
    var sk = out.skipped; out.sort(function (a, b) { return a.iso < b.iso ? -1 : 1; }); out.skipped = sk;
    return out;
  }

  // ── HOME routines window: from today through the SATURDAY OF NEXT WEEK (weeks Sun-Sat; at most 14 days, in
  // Asia/Jerusalem). An instance stays until its END time has passed; a completed one stays (marked). ──
  function homeWindow(now) { var t = ymdIn(now || new Date()); return { from: t, to: addDays(t, 6 - dowOf(t) + 7) }; }
  function inHomeWindow(iso, durationMin, completed, now) {
    now = now || new Date();
    var w = homeWindow(now), day = ymdIn(new Date(iso));
    if (day < w.from || day > w.to) return false;
    return !!completed || new Date(+new Date(iso) + (durationMin || 60) * 60000) > now;
  }

  // ── derived values for the UI and the legacy fields ──
  var LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שב׳'];
  function derive(spec) {
    var fixed = uniq(weeklyPattern(spec).map(function (p) { return p.dow; }));
    var hasEarly = spec.slots.some(function (s) { return s.pick === 'earliest'; });
    var earlyDays = uniq([].concat.apply([], spec.slots.filter(function (s) { return s.pick === 'earliest' && s.days; }).map(function (s) { return s.days; })));
    var flex = hasEarly && !earlyDays.length;
    var days = uniq(fixed.concat(earlyDays));
    return { perWeek: perWeek(spec), days: days, flexible: flex, daysLabel: flex ? 'ימים גמישים' : days.map(function (d) { return LETTER[d]; }).join('+') };
  }
  // Hebrew count with the right form: "פגישה אחת", "2 פגישות"
  var NOUNS = { meeting: ['פגישה', 'פגישות'], event: ['אירוע', 'אירועים'], instance: ['מופע', 'מופעים'] };
  function plural(n, noun) { var w = NOUNS[noun] || [noun, noun]; return n === 1 ? w[0] + (w[0].endsWith('ה') ? ' אחת' : ' אחד') : n + ' ' + w[1]; }

  return { parseRoutineDescription: parseRoutineDescription, normalizeRoutine: normalizeRoutine, specFromManual: specFromManual, weeklyPattern: weeklyPattern,
    generateProposals: generateProposals, derive: derive, homeWindow: homeWindow, inHomeWindow: inHomeWindow, perWeek: perWeek, plural: plural, uniqDays: uniq, WIN_TIME: WIN_TIME, TZ: TZ };
});
