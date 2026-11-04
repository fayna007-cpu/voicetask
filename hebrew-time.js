// Hebrew date/time parser for quick add. PURE: no DOM, no storage, no network, never throws.
// Browser: exposed as QAdd.time (the single QAdd namespace). Node: module.exports (used by tests).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.QAdd = root.QAdd || {}; root.QAdd.time = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Editable constants ────────────────────────────────────────────────────
  var TZ = 'Asia/Jerusalem';
  var WINDOWS = {              // default time when only a time-of-day word is given
    morning: '08:00',          // בבוקר
    noon: '13:00',             // בצהריים
    afternoon: '16:00',        // אחה"צ
    evening: '19:00',          // בערב
    night: '22:00'             // בלילה
  };
  var DAYS = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
  var MONTHS = { 'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
                 'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12 };

  // ── Calendar helpers (pure date math on 'YYYY-MM-DD', timezone via Intl only) ──
  var fmtCache = {};
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function partsIn(date, tz) {
    var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
    var o = {};
    f.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') o[p.type] = +p.value; });
    if (o.hour === 24) o.hour = 0;
    return o;
  }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function toUtc(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); }
  function addDays(s, n) { var d = toUtc(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function dowOf(s) { return toUtc(s).getUTCDay(); }
  function validYmd(y, m, d) { var t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }

  // Wall-clock date+time in `tz` -> real instant. Two passes handle DST without hardcoded offsets.
  function tzOffset(ms, tz) {
    var p = partsIn(new Date(ms), tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  function toDate(date, time, tz) {
    try {
      tz = tz || TZ;
      var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), t = /^(\d{2}):(\d{2})$/.exec(time);
      if (!d || !t) return null;
      var wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
      var guess = wall - tzOffset(wall, tz);
      return new Date(wall - tzOffset(guess, tz));
    } catch (e) { return null; }
  }

  // ── Patterns ───────────────────────────────────────────────────────────────
  // Every pattern is built as (prefix)(core)(suffix) so a match never starts/ends inside a word.
  // JS \b does not understand Hebrew, hence the explicit Hebrew-letter class. No lookbehind (old iOS).
  var HEB = '\\u05D0-\\u05EA';
  // "2.5 ק"ג", "12.50 ש"ח": a dotted number followed by a unit is a quantity/price, never a date or a time.
  var NOT_UNIT = '(?!\\s*(?:ק"ג|קג|גרם|ליטר|מ"ל|מטר|ס"מ|ק"מ|שעות|דקות|₪|ש"ח|שקל|%))';
  function W(core) { return new RegExp('(^|[^' + HEB + '])(' + core + ')(?![' + HEB + '])'); }                       // Hebrew word
  function Nm(core) { return new RegExp('(^|[^\\d:./' + HEB + '])(' + core + ')(?![\\d:/])(?!\\.\\d)'); }            // number / time
  function Mo(core) { return new RegExp('(^|[^\\d:./' + HEB + '])(' + core + ')(?![' + HEB + '])'); }                 // number + Hebrew word
  var RE = {
    rel: W('ב?עוד\\s+(?:(\\d+(?:\\.\\d+)?)\\s*(דקות|דקה|שעות|שעה)|שעה\\s+וחצי|שעתיים|חצי\\s+שעה|רבע\\s+שעה|שעה)'),
    dateSlash: Nm('(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?'),
    dateDot: Nm('(\\d{1,2})\\.(\\d{1,2})' + NOT_UNIT),
    dateMonth: Mo('(?:[בלה]-?)?(\\d{1,2})\\s*[בל]?(' + Object.keys(MONTHS).join('|') + ')'),
    dayAfter: W('ל?מחרתיים'),
    tomorrow: W('ל?מחר'),
    today: W('היום'),
    tonight: W('הערב'),
    nextWeek: W('ב?שבוע\\s+הבא'),
    // "ביום X" / "יום X" accept any day; the bare "בשישי" form excludes שני/ראשון ("בשני סוגים" is not Monday).
    weekday: W('(?:(?:[בל]-?)?יום\\s+(?:ה-?)?(' + Object.keys(DAYS).join('|') + ')|[בל]-?(?:ה-?)?(שלישי|רביעי|חמישי|שישי|שבת))'),
    // Time-of-day words need the "ב" prefix, so "ארוחת ערב" / "ארוחת בוקר" (meals) stay in the title.
    win: {
      afternoon: W('אחה"צ|אחה\'צ|אחהצ|אחר\\s+הצהרי?ים|אחרי\\s+הצהרי?ים'),
      noon: W('בצהרי?ים'),
      morning: W('בבוקר'),
      evening: W('בערב(?!\\s+(?:שבת|חג|פסח|ראש))'),
      night: W('בלילה')
    },
    timeColon: Nm('(?:ב-?|בשעה\\s*)?(\\d{1,2}):(\\d{2})'),
    timeDot: Nm('(?:ב-?|בשעה\\s*)?(\\d{1,2})\\.(\\d{2})' + NOT_UNIT),
    timeBare: Nm('(?:ב-?|בשעה\\s*)(\\d{1,2})(?:\\s+(וחצי|ורבע)(?![' + HEB + ']))?'),  // "ב-7 וחצי" = 7:30
    // "12 בלילה", "7 בערב", "3 אחה"צ": a number right before a time-of-day word is an hour (no "ב" needed)
    timeWinNum: Nm('(\\d{1,2})(?=\\s+(?:בבוקר|בצהרי?ים|בערב|בלילה|אחה"צ|אחה\'צ|אחהצ|אחר\\s+הצהרי?ים|אחרי\\s+הצהרי?ים))')
  };

  function normalize(s) {   // 1:1 character replacements only, so indexes stay valid for the original text
    return s.replace(/[\u05BE\u2010-\u2015]/g, '-').replace(/[\u201C\u201D\u05F4]/g, '"').replace(/[\u2018\u2019\u05F3]/g, "'");
  }

  function parseHebrewDateTime(text, opts) {
    // alternative = the other reading of a bare hour ({label,date,time}); the UI offers it as a one-tap flip.
    var out = { ok: false, date: null, time: null, title: '', ambiguity: null, alternative: null };
    try {
      if (typeof text !== 'string') return out;
      var now = opts && opts.now instanceof Date && !isNaN(opts.now.getTime()) ? opts.now : new Date();
      var tz = (opts && opts.tz) || TZ;
      var np = partsIn(now, tz);
      var today = ymd(np.year, np.month, np.day);
      var tomorrow = addDays(today, 1);
      var nowHM = pad(np.hour) + ':' + pad(np.minute);

      var work = normalize(text), blank = [], i;
      function take(re) { var m = re.exec(work); return m ? { m: m, start: m.index + m[1].length, len: m[2].length } : null; }
      function eat(h) {
        if (!h) return;
        for (i = h.start; i < h.start + h.len; i++) blank[i] = true;
        work = work.slice(0, h.start) + new Array(h.len + 1).join(' ') + work.slice(h.start + h.len);
      }
      function finish() {
        var t = '';
        for (i = 0; i < text.length; i++) t += blank[i] ? ' ' : text.charAt(i);
        out.title = t.replace(/\s+/g, ' ').replace(/([,:;])(?:\s*[,:;])+/g, '$1').replace(/^[\s,.:;\-\u2013\u2014]+|[\s,.:;\-\u2013\u2014]+$/g, '');
        out.ok = !!(out.date || out.time || out.ambiguity);
        return out;
      }
      function pastOptions(time) {
        return [{ label: 'מחר ' + time, date: tomorrow, time: time }, { label: 'בחר זמן אחר', pick: true }];
      }

      // 1) Relative: "בעוד שעה", "בעוד 30 דקות", "עוד חצי שעה" — computed from the real instant, so DST-safe.
      var rel = take(RE.rel);
      if (rel) {
        var mins = rel.m[3] ? parseFloat(rel.m[3]) * (/^שע/.test(rel.m[4]) ? 60 : 1)
          : /וחצי/.test(rel.m[2]) ? 90 : /שעתיים/.test(rel.m[2]) ? 120 : /חצי/.test(rel.m[2]) ? 30 : /רבע/.test(rel.m[2]) ? 15 : 60;
        var p = partsIn(new Date(now.getTime() + Math.round(mins * 60000)), tz);
        eat(rel);
        out.date = ymd(p.year, p.month, p.day);
        out.time = pad(p.hour) + ':' + pad(p.minute);
        return finish();
      }

      // 2) Explicit date: 5/12, 5.12 (only when it is a valid D.M), "ב-5 לדצמבר"
      function mkDate(day, mon, yr) {
        var y = yr ? (yr < 100 ? 2000 + yr : yr) : np.year;
        if (!validYmd(y, mon, day)) return null;
        var s = ymd(y, mon, day);
        if (!yr && s < today) { y = np.year + 1; if (!validYmd(y, mon, day)) return null; s = ymd(y, mon, day); }
        return s;
      }
      var date = null, hit, dh = null;
      if ((hit = take(RE.dateSlash)) && (date = mkDate(+hit.m[3], +hit.m[4], hit.m[5] ? +hit.m[5] : 0))) dh = hit;
      if (!dh && (hit = take(RE.dateDot)) && +hit.m[4] <= 12 && (date = mkDate(+hit.m[3], +hit.m[4], 0))) dh = hit;
      if (!dh && (hit = take(RE.dateMonth)) && (date = mkDate(+hit.m[3], MONTHS[hit.m[4]], 0))) dh = hit;
      if (dh) eat(dh); else date = null;

      // 3) Day words (only if no explicit date)
      var nextWeek = take(RE.nextWeek), wd = take(RE.weekday), win = null;
      if (!date) {
        if ((hit = take(RE.dayAfter))) { date = addDays(today, 2); eat(hit); }
        else if ((hit = take(RE.tomorrow))) { date = addDays(today, 1); eat(hit); }
        else if ((hit = take(RE.today))) { date = today; eat(hit); }
        else if ((hit = take(RE.tonight))) { date = today; win = 'evening'; eat(hit); }
        else if (wd) {
          var target = DAYS[wd.m[3] || wd.m[4]], dow = dowOf(today);
          if (nextWeek) { date = addDays(today, (7 - dow) % 7 || 7); date = addDays(date, target); }   // Sunday-based week
          else { date = addDays(today, (target - dow + 7) % 7 || 7); }                                    // never "today"
          eat(wd);
          if (nextWeek) eat(nextWeek);
        } else if (nextWeek) { date = addDays(today, 7); eat(nextWeek); }
      }

      // 4) Time-of-day word (the earliest one in the text wins)
      var numWin = take(RE.timeWinNum);   // looked up now, while the time-of-day word is still in the text
      var best = null, key;
      for (key in RE.win) { hit = take(RE.win[key]); if (hit && (!best || hit.start < best.hit.start)) best = { key: key, hit: hit }; }
      if (best) { eat(best.hit); if (!win) win = best.key; }

      // 5) Explicit time: 18:00, 18.30, ב-7, בשעה 6
      var tm = null, th;
      if ((th = take(RE.timeColon)) && +th.m[3] <= 23 && +th.m[4] <= 59) tm = { h: +th.m[3], m: +th.m[4], lz: /^0\d/.test(th.m[3]) };
      else if ((th = take(RE.timeDot)) && +th.m[3] <= 23 && +th.m[4] <= 59) tm = { h: +th.m[3], m: +th.m[4], lz: /^0\d/.test(th.m[3]) };
      else if ((th = take(RE.timeBare)) && +th.m[3] <= 23) tm = { h: +th.m[3], m: th.m[4] === 'וחצי' ? 30 : th.m[4] === 'ורבע' ? 15 : 0, lz: false };
      else if (numWin && +numWin.m[3] <= 23) { th = numWin; tm = { h: +numWin.m[3], m: 0, lz: false }; }
      if (tm) eat(th);

      // 6) Resolve the time. No question is asked for a bare hour: preselect one reading, offer the other as `alternative`.
      var time = null, alt = null, implied = !date, pastNone = null;
      function occ(t) { return t >= nowHM ? today : tomorrow; }   // nearest upcoming occurrence of t when no date was typed
      function altFor(t, d, rolls) {                               // the other reading; null if it would land in the past
        var ad = d;
        if (ad === today && t < nowHM) { if (!rolls) return null; ad = tomorrow; }
        return { label: (ad !== d ? 'מחר ' : '') + t, date: ad, time: t };
      }
      if (tm) {
        var h = tm.h, mm = pad(tm.m);
        if (h === 0 || h >= 13) time = pad(h) + ':' + mm;                                   // 24h as typed
        else if (h === 12 && win !== 'night') time = '12:' + mm;
        else if (win === 'night' && (h === 12 || h <= 5)) {                                 // "12/1-5 בלילה": the coming night
          time = pad(h === 12 ? 0 : h) + ':' + mm;
          date = implied ? occ(time) : addDays(date, 1);                                    // typed date D -> the night after D
        }
        else if (win === 'afternoon' || win === 'evening' || win === 'night') time = pad(h + 12) + ':' + mm;
        else if (win === 'noon') time = pad(h <= 5 ? h + 12 : h) + ':' + mm;
        else if (win === 'morning' || tm.lz) time = pad(h) + ':' + mm;                      // "08:30" is typed as 24h
        else {                                                                              // bare hour, no time-of-day word
          var am = pad(h) + ':' + mm, pm = pad(h + 12) + ':' + mm, first;
          if (h <= 6) { time = pm; alt = altFor(am, date || today, implied); }              // 1-6 -> PM
          else if (implied || date === today) {                                             // 7-11 -> nearest upcoming
            first = am >= nowHM ? am : pm >= nowHM ? pm : null;
            if (first) { time = first; date = today; alt = altFor(first === am ? pm : am, today, implied); }
            else if (implied) { time = am; date = tomorrow; alt = altFor(pm, tomorrow, false); }
            else pastNone = [am, pm];                                                       // typed "היום", both readings passed
          } else { time = am; alt = altFor(pm, date, false); }                              // typed future date -> morning first
        }
      } else if (win) time = WINDOWS[win];

      if (!date && time) date = today;   // a time with no date means today
      out.date = date;
      out.time = time;

      // 7) Past times are never moved silently
      if (pastNone) {
        out.date = today;
        out.ambiguity = { reason: 'past', options: pastNone.map(function (t) { return { label: 'מחר ' + t, date: tomorrow, time: t }; }).concat([{ label: 'בחר זמן אחר', pick: true }]) };
      } else if (out.time && date === today && out.time < nowHM) {
        out.ambiguity = { reason: 'past', options: pastOptions(out.time) };   // date/time stay as typed
      }
      out.alternative = out.ambiguity ? null : alt;
      return finish();
    } catch (e) {
      return { ok: false, date: null, time: null, title: typeof text === 'string' ? text.trim() : '', ambiguity: null, alternative: null };
    }
  }

  return { parseHebrewDateTime: parseHebrewDateTime, toDate: toDate, WINDOWS: WINDOWS, TZ: TZ };
});
