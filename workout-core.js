// Workout core: the shorthand grammar, its round trip, week ranges and everything derived from sessions.
// PURE: no DOM, no storage, no network, never throws. Browser: window.WCore. Node: module.exports (tests).
//   Header   אימון <letter any case> [locker int] [date d.m[.yyyy]]      (locker = the equipment-locker number, optional)
//   Exercise <label> - <set>, <set>, ...      set = <weight>*<reps> (decimal . or ,; separators * x X ×) | <reps> alone = bodyweight
//   Class    <label> - <N> דקות               stored as a set-less session
// A leading "[...] Name:" (a pasted chat prefix) is ignored. Anything that does not parse is KEPT as an unparsed token.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TZ = 'Asia/Jerusalem';
  var DEFAULT_ALIASES = { 'חזה': 'chest', 'כתפיים': 'shoulders', 'יד קדמית': 'biceps', 'יד אחורית': 'triceps', 'רגליים': 'legs', 'מתח': 'back' };

  // ── time helpers (always in the tz, DST-safe) ──
  var pad = function (n) { return String(n).padStart(2, '0'); };
  function ymdIn(d, tz) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || TZ }).format(d); }
  function dowOfYmd(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
  function addDaysYmd(ymd, n) { var p = ymd.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function validYmd(y, m, d) { var x = new Date(Date.UTC(y, m - 1, d)); return m >= 1 && m <= 12 && x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; }
  // The instant of local midnight of `ymd` in `tz`.
  function startOfDayMs(ymd, tz) {
    var p = ymd.split('-'), guess = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    function offset(ms) {
      var o = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(ms)).forEach(function (x) { o[x.type] = +x.value; });
      return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(ms / 1000) * 1000;
    }
    var t = guess - offset(guess); t = guess - offset(t); return t;
  }
  // Sunday-Saturday week containing `date` (a Date or 'YYYY-MM-DD'). endMs is EXCLUSIVE (the next Sunday 00:00 local).
  function weekRange(date, tz) {
    var ymd = typeof date === 'string' ? date : ymdIn(date || new Date(), tz);
    var start = addDaysYmd(ymd, -dowOfYmd(ymd)), end = addDaysYmd(start, 6), days = [];
    for (var i = 0; i < 7; i++) days.push(addDaysYmd(start, i));
    return { start: start, end: end, days: days, startMs: startOfDayMs(start, tz), endMs: startOfDayMs(addDaysYmd(end, 1), tz) };
  }

  // ── parser ──
  var MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;
  var PREFIX = /^\s*\[[^\]\n]*\]\s*[^:\n]{1,40}:\s*/;                  // the ONE tolerance: "[19:30, 2.11.2026] Name:"
  var HEADER = /^אימון\s+([A-Za-zא-ת])(?=\s|$)(.*)$/;
  var TOKEN = /\d+(?:[.,]\d+)?(?:\s*[*xX×]\s*\d+)+|\([^)]*\)|[^\s,;]+/g;
  var SET = /^(\d+(?:[.,]\d+)?)\s*[*xX×]\s*(\d+)$/;
  var CLASS_VALUE = /^(\d{1,3})\s*דק(?:ות|׳|')?\.?$/;
  var num = function (s) { return parseFloat(String(s).replace(',', '.')); };
  function labelKey(s) { return String(s || '').toLowerCase().replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim(); }
  function cleanText(t) { return String(t == null ? '' : t).replace(MARKS, '').replace(/ /g, ' ').replace(/\r\n?/g, '\n'); }

  // d.m[.yyyy] -> {ymd} ; the year is the current one, a date more than 7 days ahead means LAST year.
  function resolveDate(d, m, y, now) {
    var today = ymdIn(now), cy = +today.slice(0, 4), yy;
    if (y != null) { yy = y < 100 ? 2000 + y : y; return validYmd(yy, m, d) ? { ymd: yy + '-' + pad(m) + '-' + pad(d), explicit: true } : null; }
    if (!validYmd(cy, m, d)) return null;
    var cand = cy + '-' + pad(m) + '-' + pad(d);
    if (cand > addDaysYmd(today, 7)) { if (!validYmd(cy - 1, m, d)) return null; cand = (cy - 1) + '-' + pad(m) + '-' + pad(d); }
    return { ymd: cand, explicit: false };
  }

  function parseSets(value, ex, warn) {
    var m, re = new RegExp(TOKEN.source, 'g');
    while ((m = re.exec(value))) {
      var tk = m[0], p;
      if (tk.charAt(0) === '(' && tk.charAt(tk.length - 1) === ')') { ex.note = (ex.note ? ex.note + ' ' : '') + tk.slice(1, -1).trim(); continue; }
      if ((p = tk.match(SET))) { ex.sets.push({ w: num(p[1]), r: parseInt(p[2], 10), raw: tk }); continue; }
      if (/^\d+$/.test(tk)) { ex.sets.push({ w: null, r: parseInt(tk, 10), raw: tk }); continue; }
      ex.unparsed.push(tk);
    }
    ex.sets.forEach(function (s) {
      if (s.r < 1 || s.r > 50) warn.push({ code: 'reps', label: ex.label, value: s.r });
      if (s.w != null && (s.w <= 0 || s.w > 500)) warn.push({ code: 'weight', label: ex.label, value: s.w });
    });
  }

  // parse(text, {now}) -> {sessions, errors:[code]} ; sessions carry their own warnings[]. Several sessions may be pasted at once.
  function parse(text, opts) {
    var now = (opts && opts.now) || new Date(), lines = cleanText(text).split('\n'), sessions = [], cur = null, stray = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(PREFIX, '').trim();
      if (!line) continue;
      var h = line.match(HEADER);
      if (h) {
        var s = { date: null, type: h[1].toUpperCase(), typeRaw: h[1], locker: null, mode: 'sets', classes: [], exercises: [], warnings: [] }, hasDate = false;
        h[2].trim().split(/\s+/).filter(Boolean).forEach(function (tk) {
          var d;
          if (/^\d{1,3}$/.test(tk)) { if (s.locker == null) s.locker = parseInt(tk, 10); else s.warnings.push({ code: 'token', value: tk }); }
          else if ((d = tk.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/)) && !hasDate) {
            var r = resolveDate(+d[1], +d[2], d[3] ? +d[3] : null, now);
            if (r) { s.date = r.ymd; hasDate = true; } else { s.warnings.push({ code: 'invalidDate', value: tk }); hasDate = true; }
          } else s.warnings.push({ code: 'token', value: tk });
        });
        if (!s.date) { if (!hasDate) s.warnings.push({ code: 'noDate' }); s.date = ymdIn(now); }
        sessions.push(s); cur = s; continue;
      }
      if (!cur) { stray++; continue; }
      var e = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (!e) { cur.warnings.push({ code: 'line', value: line }); continue; }
      var label = e[1].replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim(), value = e[2].trim(), c = value.match(CLASS_VALUE);
      if (c) { cur.classes.push({ label: label, minutes: parseInt(c[1], 10) }); continue; }
      var ex = { label: label, sets: [], unparsed: [] };
      parseSets(value, ex, cur.warnings);
      if (!ex.sets.length && !ex.unparsed.length && !ex.note) cur.warnings.push({ code: 'emptyExercise', label: label });
      cur.exercises.push(ex);
    }
    sessions.forEach(function (s) { s.mode = s.exercises.length ? 'sets' : (s.classes.length ? 'class' : 'sets'); s.hash = hashOf(s); });
    var errors = [];
    if (!sessions.length) errors.push(stray ? 'noHeader' : 'empty');
    return { sessions: sessions, errors: errors };
  }

  // ── identity: same date + type + same sets ──
  function fmtNum(n) { return String(n); }
  function setsKey(s) {
    return (s.exercises || []).map(function (e) { return labelKey(e.label) + ':' + (e.sets || []).map(function (x) { return (x.w == null ? '' : fmtNum(x.w)) + 'x' + x.r; }).join(','); }).join('|')
      + '#' + (s.classes || []).map(function (c) { return labelKey(c.label) + c.minutes; }).join(',');
  }
  function fnv(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  function hashOf(s) { return fnv(s.date + '|' + s.type + '|' + setsKey(s)); }
  // 'new' | 'exists' (same date + type, same sets) | 'conflict' (same date + type, other sets); with = the existing session
  function classify(session, existing) {
    var same = (existing || []).filter(function (x) { return x.date === session.date && x.type === session.type; });
    if (!same.length) return { kind: 'new', with: null };
    var k = setsKey(session), hit = same.filter(function (x) { return setsKey(x) === k; })[0];
    return hit ? { kind: 'exists', with: hit } : { kind: 'conflict', with: same[0] };
  }

  // ── format: the same grammar, so parse(format(x)) gives x back ──
  function format(sessions, opts) {
    var now = (opts && opts.now) || new Date();
    return (sessions || []).map(function (s) {
      var p = s.date.split('-'), y = +p[0], m = +p[1], d = +p[2], r = resolveDate(d, m, null, now);
      var ds = d + '.' + m + (r && r.ymd === s.date ? '' : '.' + y);
      var out = ['אימון ' + s.type + (s.locker != null ? ' ' + s.locker : '') + ' ' + ds];
      (s.exercises || []).forEach(function (e) {
        var parts = (e.sets || []).map(function (x) { return x.w == null ? String(x.r) : fmtNum(x.w) + '*' + x.r; }).concat(e.unparsed || []);
        if (e.note) parts.push('(' + e.note + ')');
        out.push(e.label + ' - ' + parts.join(', '));
      });
      (s.classes || []).forEach(function (c) { out.push(c.label + ' - ' + c.minutes + ' דקות'); });
      return out.join('\n');
    }).join('\n\n');
  }

  // ── derived data (never stored) ──
  function setsText(sets) { return (sets || []).map(function (x) { return x.w == null ? String(x.r) : fmtNum(x.w) + '×' + x.r; }).join(' · '); }
  // straight (same weight) | descending | ascending | mixed | bodyweight
  function pattern(sets) {
    if (!sets || !sets.length) return 'none';
    if (sets.every(function (x) { return x.w == null; })) return 'bodyweight';
    var w = sets.map(function (x) { return x.w == null ? 0 : x.w; }), up = false, down = false;
    for (var i = 1; i < w.length; i++) { if (w[i] > w[i - 1]) up = true; if (w[i] < w[i - 1]) down = true; }
    return up && down ? 'mixed' : up ? 'ascending' : down ? 'descending' : 'straight';
  }
  var byRecent = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')); };
  function sortRecent(sessions) { return (sessions || []).slice().sort(byRecent); }
  function mode(list) {                                                  // most common value; ties -> the first (most recent) one
    var c = {}, best = null; list.forEach(function (v) { c[v] = (c[v] || 0) + 1; });
    list.forEach(function (v) { if (best == null || c[v] > c[best]) best = v; });
    return best == null ? null : { value: best, count: c[best] };
  }
  function derive(sessions) {
    var recent = sortRecent(sessions), types = {}, last = {};
    recent.forEach(function (s) {
      var t = types[s.type] || (types[s.type] = { type: s.type, count: 0, lastDate: s.date, sessions: [] });
      t.count++; t.sessions.push(s);
      (s.exercises || []).forEach(function (e) { var k = labelKey(e.label); if (!last[k] && e.sets && e.sets.length) last[k] = { key: k, label: e.label, date: s.date, type: s.type, locker: s.locker, sets: e.sets }; });
    });
    Object.keys(types).forEach(function (k) {
      var t = types[k], ss = t.sessions, lockers = ss.filter(function (x) { return x.locker != null; }).map(function (x) { return x.locker; });
      var m = mode(lockers); t.usualLocker = m ? { n: m.value, count: m.count } : null;
      t.weekdays = [0, 1, 2, 3, 4, 5, 6].map(function () { return 0; });
      ss.forEach(function (x) { t.weekdays[dowOfYmd(x.date)]++; });
      var top = Math.max.apply(null, t.weekdays); t.usualWeekday = top > 0 ? t.weekdays.indexOf(top) : null;
      var seen = {}, template = [];
      ss.slice(0, 3).forEach(function (x) { (x.exercises || []).forEach(function (e) { var key = labelKey(e.label); if (seen[key] || !e.sets || !e.sets.length) return; seen[key] = 1; template.push({ key: key, label: e.label, lastSets: e.sets, pattern: pattern(e.sets) }); }); });
      t.template = template; delete t.sessions;
    });
    return { types: types, lastByLabel: last, recent: recent };
  }
  // The previous time this exercise was done, strictly before `date` (and not the session `excludeKey` itself).
  function lastTimeBefore(sessions, label, date) {
    var key = labelKey(label), hit = null;
    sortRecent(sessions).forEach(function (s) {
      if (hit || s.date >= date) return;
      (s.exercises || []).forEach(function (e) { if (!hit && labelKey(e.label) === key && e.sets && e.sets.length) hit = { date: s.date, type: s.type, locker: s.locker, sets: e.sets }; });
    });
    return hit;
  }
  function muscleOf(label, catalog) {
    var k = labelKey(label), a = catalog && catalog.aliases && catalog.aliases[k];
    return (a && a.muscle) || DEFAULT_ALIASES[k] || null;
  }

  // ── live workout engine: targets, rest, ONE reducer over an action log (pure; times come in on the actions) ──
  var EQUIP = { dumbbell: { unit: 'kg', step: 2 }, barbell: { unit: 'kg', step: 2.5 }, machine: { unit: 'plates', step: 0.5 }, cable: { unit: 'kg', step: 2.5 }, bodyweight: { unit: null, step: 0 } };
  var round2 = function (x) { return Math.round(x * 100) / 100; };
  // snap to the step, never below one step; step 0 (bodyweight) = no weight
  function snap(w, step) { if (w == null || !isFinite(w)) return null; if (!step) return round2(w); return Math.max(step, round2(Math.round(w / step) * step)); }
  function rangeStatus(r, range) { return !range ? 'in' : r < range[0] ? 'below' : r > range[1] ? 'above' : 'in'; }
  function restFor(reps, ex) { if (ex && ex.restSec > 0) return ex.restSec; return reps <= 6 ? 150 : reps <= 10 ? 120 : 75; }
  function rangeOf(ex, i) { var rs = (ex.scheme && ex.scheme.ranges) || [[8, 12]]; return rs[Math.min(i, rs.length - 1)]; }
  // Targets for every slot of an exercise: [{w, range, aim}]. `last` = the last session's sets for it (history beats the formula),
  // `logged` = the sets already done today (set 1 off its target by more than a step rescales the rest).
  function targetsFor(ex, last, logged) {
    var sc = ex.scheme || {}, n = Math.max(sc.sets || 3, (logged || []).length), drop = sc.drop == null ? 0.2 : sc.drop, step = ex.step || 0, bw = ex.equip === 'bodyweight' || !step;
    var out = [];
    for (var i = 0; i < n; i++) {
      var range = rangeOf(ex, i), l = last && last[i], w, aim;
      if (l && l.r != null) {
        if (l.r >= range[1]) { w = bw ? null : snap((l.w || 0) + step, step); aim = bw ? Math.min(l.r + 1, range[1]) : range[0]; }
        else { w = bw ? null : snap(l.w, step); aim = Math.min(Math.max(l.r + 1, range[0]), range[1]); }
      } else {
        w = bw ? null : i === 0 ? snap(ex.startW, step) : snap(out[i - 1].w * (1 - drop), step);
        aim = range[0];
      }
      out.push({ w: w, range: range, aim: aim });
    }
    var s1 = logged && logged[0];
    if (!bw && s1 && s1.w != null && out[0].w && Math.abs(s1.w - out[0].w) > step) {
      var ratio = s1.w / out[0].w;
      for (var k = 1; k < out.length; k++) out[k].w = snap(out[k].w * ratio, step);
    }
    return out;
  }
  function nextEx(exs, from) {                                            // the next exercise not skipped and not complete
    for (var k = 1; k <= exs.length; k++) { var j = (from + k) % exs.length, e = exs[j]; if (!e.skipped && e.sets.length < ((e.scheme && e.scheme.sets) || 3)) return j; }
    return from;
  }
  function liveEx(p) { return { pid: p.id || null, label: String(p.label || ''), muscle: p.muscle || null, equip: p.equip || 'dumbbell', unit: p.unit === undefined ? (EQUIP[p.equip] || EQUIP.dumbbell).unit : p.unit, step: p.step == null ? (EQUIP[p.equip] || EQUIP.dumbbell).step : p.step, scheme: p.scheme || { sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 }, startW: p.startW == null ? null : p.startW, restSec: p.restSec || 0, skipped: false, sets: [] }; }
  // ONE reducer. Unknown or malformed actions are ignored (tolerant replay of an old draft).
  function reduce(st, a) {
    if (!a || !a.type) return st;
    if (a.type === 'START') return { program: { id: a.program && a.program.id, name: (a.program && a.program.name) || '' }, startedAt: a.at, locker: a.locker == null ? null : a.locker, exIdx: 0, exercises: ((a.program && a.program.exercises) || []).map(liveEx), rest: null, finished: null, lastAt: a.at };
    if (!st) return st;
    var s = JSON.parse(JSON.stringify(st)), e = s.exercises[a.ex];
    s.lastAt = Math.max(s.lastAt || 0, a.at || 0);
    switch (a.type) {
      case 'LOG_SET':
        if (!e || !(a.r >= 0)) return st;
        e.sets.push({ w: e.step && a.w != null ? a.w : null, r: a.r, t: a.at });
        var sec = restFor(a.r, e); s.rest = { endsAt: a.at + sec * 1000, total: sec };
        s.exIdx = e.sets.length >= ((e.scheme && e.scheme.sets) || 3) ? nextEx(s.exercises, a.ex) : a.ex;
        return s;
      case 'EDIT_SET': if (!e || !e.sets[a.i]) return st; if (a.w !== undefined) e.sets[a.i].w = e.step ? a.w : null; if (a.r != null) e.sets[a.i].r = a.r; return s;
      case 'DELETE_SET': if (!e || !e.sets[a.i]) return st; e.sets.splice(a.i, 1); return s;
      case 'SKIP_EXERCISE': if (!e) return st; e.skipped = true; s.exIdx = nextEx(s.exercises, a.ex); return s;
      case 'ADD_EXERCISE': if (!a.exercise || !String(a.exercise.label || '').trim()) return st; s.exercises.push(liveEx(a.exercise)); s.exIdx = s.exercises.length - 1; return s;
      case 'REST_ADJUST': if (!s.rest) return st; s.rest.endsAt = Math.max(a.at || 0, s.rest.endsAt + (a.delta || 0) * 1000); s.rest.total = Math.max(1, s.rest.total + (a.delta || 0)); return s;
      case 'REST_SKIP': s.rest = null; return s;
      case 'FINISH': s.finished = { at: a.at, effort: a.effort == null ? null : a.effort }; return s;
      default: return st;
    }
  }
  // Replay a draft's log; UNDO pops the last applied action (START is never undone).
  function replay(actions) {
    var eff = [];
    (Array.isArray(actions) ? actions : []).forEach(function (a) { if (a && a.type === 'UNDO') { if (eff.length > 1) eff.pop(); } else if (a && a.type) eff.push(a); });
    var st = null; eff.forEach(function (a) { try { st = reduce(st, a); } catch (_) { } });
    return st;
  }
  function durationSec(st, now) { return st ? Math.max(0, Math.round(((st.finished ? st.finished.at : now) - st.startedAt) / 1000)) : 0; }
  // The finished state -> a session in the stored shape (no id/createdAt: the caller adds them).
  function sessionFromLive(st) {
    var s = { date: ymdIn(new Date(st.startedAt)), type: st.program.name, typeRaw: st.program.name, locker: st.locker, mode: 'sets', classes: [],
      exercises: st.exercises.filter(function (e) { return e.sets.length; }).map(function (e) { return { label: e.label, sets: e.sets.map(function (x) { return { w: x.w, r: x.r, t: x.t }; }), unparsed: [], note: null }; }),
      source: 'live', programId: st.program.id || null, effort: st.finished ? st.finished.effort : null, durationSec: durationSec(st, st.lastAt) };
    s.hash = hashOf(s);
    return s;
  }

  return { parse: parse, format: format, classify: classify, setsKey: setsKey, hashOf: hashOf, weekRange: weekRange, derive: derive, pattern: pattern, setsText: setsText,
    lastTimeBefore: lastTimeBefore, sortRecent: sortRecent, muscleOf: muscleOf, labelKey: labelKey, resolveDate: resolveDate, ymdIn: ymdIn, addDaysYmd: addDaysYmd, DEFAULT_ALIASES: DEFAULT_ALIASES, TZ: TZ,
    EQUIP: EQUIP, snap: snap, rangeStatus: rangeStatus, restFor: restFor, targetsFor: targetsFor, reduce: reduce, replay: replay, durationSec: durationSec, sessionFromLive: sessionFromLive };
});
