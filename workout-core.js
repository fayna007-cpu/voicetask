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
  // rest: the exercise's override, else the goal's default (hypertrophy 90 s, general 75 s), else by reps (strength / no goal)
  function restFor(reps, ex, goal) {
    if (ex && ex.restSec > 0) return ex.restSec;
    if (goal && GOALS[goal] && goal !== 'strength') return GOALS[goal].rest;
    return reps <= 6 ? 150 : reps <= 10 ? 120 : 75;
  }
  function rangeOf(ex, i) { var rs = (ex.scheme && ex.scheme.ranges) || [[8, 12]]; return rs[Math.min(i, rs.length - 1)]; }
  // Targets for every slot of an exercise: [{w, range, aim}]. `last` = the last session's sets for it (history beats the formula),
  // `logged` = the sets already done today (set 1 off its target by more than a step rescales the rest).
  // opts.scale (e.g. 0.9 for a lighter day) scales every weight target, snapped.
  function targetsFor(ex, last, logged, opts) {
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
    var scale = opts && opts.scale;
    if (!bw && scale && scale !== 1) out.forEach(function (t) { if (t.w != null) t.w = snap(t.w * scale, step); });
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
  function liveEx(p) { return { pid: p.id || null, label: String(p.label || ''), muscle: p.muscle || null, equip: p.equip || 'dumbbell', unit: p.unit === undefined ? (EQUIP[p.equip] || EQUIP.dumbbell).unit : p.unit, step: p.step == null ? (EQUIP[p.equip] || EQUIP.dumbbell).step : p.step, scheme: p.scheme || { sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 }, startW: p.startW == null ? null : p.startW, restSec: p.restSec || 0, warmup: !!p.warmup, skipped: false, sets: [] }; }
  // ONE reducer. Unknown or malformed actions are ignored (tolerant replay of an old draft).
  function reduce(st, a) {
    if (!a || !a.type) return st;
    if (a.type === 'START') {
      var st0 = { program: { id: a.program && a.program.id, name: (a.program && a.program.name) || '' }, startedAt: a.at, locker: a.locker == null ? null : a.locker, exIdx: 0, exercises: ((a.program && a.program.exercises) || []).map(liveEx), rest: null, finished: null, lastAt: a.at };
      // optional (Milestone A): the day, the routine instance, the goal and the day's mode (full / light / short)
      ['dayId', 'dayName', 'routineId', 'dateStr', 'goal', 'mode'].forEach(function (k) { if (a[k] != null) st0[k] = a[k]; });
      if (a.mode === 'short') st0.exercises.forEach(function (e) { e.scheme = Object.assign({}, e.scheme, { sets: Math.min(2, e.scheme.sets || 3) }); });
      return st0;
    }
    if (!st) return st;
    var s = JSON.parse(JSON.stringify(st)), e = s.exercises[a.ex];
    s.lastAt = Math.max(s.lastAt || 0, a.at || 0);
    switch (a.type) {
      case 'LOG_SET':
        if (!e || !(a.r >= 0)) return st;
        e.sets.push({ w: e.step && a.w != null ? a.w : null, r: a.r, t: a.at });
        var sec = restFor(a.r, e, s.goal); s.rest = { endsAt: a.at + sec * 1000, total: sec };
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
      exercises: st.exercises.filter(function (e) { return e.sets.length; }).map(function (e) { return { label: e.label, unit: e.unit, sets: e.sets.map(function (x) { return { w: x.w, r: x.r, t: x.t }; }), unparsed: [], note: null }; }),
      source: 'live', programId: st.program.id || null, effort: st.finished ? st.finished.effort : null, durationSec: durationSec(st, st.lastAt) };
    ['dayId', 'dayName', 'routineId', 'dateStr', 'goal', 'mode'].forEach(function (k) { if (st[k] != null) s[k] = st[k]; });
    s.hash = hashOf(s);
    return s;
  }

  // ── programs (Milestone A). Stored: {v, activeId, programs:[{id,name,goal,lastDay,days:[{id,name,exercises}]}]}.
  // The M1a shape (exercises at the top level, no goal) is wrapped on READ only; nothing is rewritten until the owner edits.
  var GOALS = {
    strength: { scheme: { type: 'desc', sets: 3, ranges: [[3, 6], [4, 8], [6, 10]], drop: 0.2 }, rest: 150 },
    hypertrophy: { scheme: { type: 'straight', sets: 3, ranges: [[6, 12], [6, 12], [6, 12]], drop: 0 }, rest: 90 },
    general: { scheme: { type: 'straight', sets: 3, ranges: [[8, 15], [8, 15], [8, 15]], drop: 0 }, rest: 75 }
  };
  var RANGE_PRESETS = [[4, 6], [6, 10], [10, 15], [8, 12], [12, 15]];
  var copy = function (x) { return JSON.parse(JSON.stringify(x)); };
  function goalScheme(goal) { return copy((GOALS[goal] || GOALS.general).scheme); }
  // The scheme picker: fills defaults; 'custom' keeps the current ranges. sets = the current count where it makes sense.
  function schemeFor(type, goal, cur) {
    var n = (cur && cur.sets) || 3;
    if (type === 'desc') return { type: 'desc', sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 };
    if (type === 'asc') return { type: 'asc', sets: 3, ranges: [[10, 15], [6, 10], [4, 6]], drop: -0.2 };
    if (type === 'straight') { var r = { strength: [4, 8], hypertrophy: [6, 12], general: [8, 15] }[goal] || [8, 12], out = []; for (var i = 0; i < n; i++) out.push(r.slice()); return { type: 'straight', sets: n, ranges: out, drop: 0 }; }
    return Object.assign(copy(cur || goalScheme(goal)), { type: 'custom' });
  }
  // A rep range is whole numbers, 1-30, min < max. clampRange keeps the side just changed and moves the other.
  function rangeValid(r) { return Array.isArray(r) && r.length === 2 && r.every(function (x) { return x === Math.round(x); }) && r[0] >= 1 && r[1] <= 30 && r[0] < r[1]; }
  function clampRange(lo, hi, changed) {
    lo = Math.round(Math.min(30, Math.max(1, +lo || 1))); hi = Math.round(Math.min(30, Math.max(1, +hi || 1)));
    if (lo < hi) return [lo, hi];
    if (changed === 'hi') { if (hi < 2) hi = 2; return [hi - 1, hi]; }
    if (lo > 29) lo = 29; return [lo, lo + 1];
  }
  function setSets(sc, n) { var s = copy(sc); s.sets = Math.max(1, Math.min(10, n)); while (s.ranges.length < s.sets) s.ranges.push(s.ranges[s.ranges.length - 1].slice()); s.ranges.length = s.sets; return s; }
  function normProgram(p) {
    if (!p || typeof p !== 'object' || !p.id) return null;
    var legacy = !Array.isArray(p.days), days = !legacy ? p.days : Array.isArray(p.exercises) ? [{ id: p.id + '_d1', name: TEXT.dayOne, exercises: p.exercises }] : [];
    return { id: String(p.id), name: String(p.name || ''), goal: GOALS[p.goal] ? p.goal : legacy ? 'strength' : 'general', lastDay: p.lastDay || null,
      days: days.filter(function (d) { return d && typeof d === 'object'; }).map(function (d, i) {
        return { id: String(d.id || p.id + '_d' + (i + 1)), name: String(d.name || TEXT.dayN(i)), exercises: (Array.isArray(d.exercises) ? d.exercises : []).filter(function (e) { return e && typeof e === 'object' && e.label != null; }) };
      }) };
  }
  function readPrograms(raw) {
    var list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.programs) ? raw.programs : [];
    var ps = list.map(normProgram).filter(Boolean), a = raw && !Array.isArray(raw) ? raw.activeId : null;
    return { activeId: ps.some(function (p) { return p.id === a; }) ? a : ps[0] ? ps[0].id : null, programs: ps };
  }
  // The next day to train = the rotation after the last LOGGED day of this program (else lastDay, else the first day).
  function nextDay(p, sessions) {
    if (!p || !p.days || !p.days.length) return null;
    var ids = p.days.map(function (d) { return d.id; });
    var last = sortRecent((sessions || []).filter(function (s) { return s && s.programId === p.id && ids.indexOf(s.dayId) > -1; }))[0];
    var i = ids.indexOf(last ? last.dayId : p.lastDay);
    return p.days[i < 0 ? 0 : (i + 1) % ids.length];
  }
  // Warm-up: ~40% x 8, 60% x 5, 80% x 3 of the first work target, snapped; never counted as work sets.
  function warmupSets(w, step) {
    if (!(w > 0) || !step) return [];
    var out = [];
    [[0.4, 8], [0.6, 5], [0.8, 3]].forEach(function (f) { var x = snap(w * f[0], step); if (x < w && !out.some(function (o) { return o.w === x; })) out.push({ w: x, r: f[1] }); });
    return out;
  }
  // Epley e1RM, only from sets of 2-10 reps (an ESTIMATE); null otherwise.
  function e1rm(w, r) { return w > 0 && r >= 2 && r <= 10 ? Math.round(w * (1 + r / 30) * 10) / 10 : null; }
  // Personal records of a session against earlier sessions: kg -> the best e1RM; otherwise best reps at the same load.
  function prsFor(session, history) {
    var out = [];
    (session.exercises || []).forEach(function (e) {
      var k = labelKey(e.label), prev = [];
      (history || []).forEach(function (s) { if (s === session || (session.id && s.id === session.id)) return; (s.exercises || []).forEach(function (x) { if (labelKey(x.label) === k) prev = prev.concat(x.sets || []); }); });
      if (!prev.length) return;
      var kg = e.unit === 'kg' || (e.unit === undefined && (e.sets || []).some(function (x) { return x.w != null; }));
      if (kg) {
        var best = function (sets) { return sets.reduce(function (m, x) { var v = e1rm(x.w, x.r); return v != null && v > m ? v : m; }, 0); };
        var now = best(e.sets || []), was = best(prev);
        if (now > 0 && was > 0) { if (now > was) out.push({ label: e.label, kind: 'e1rm', value: now, prev: was }); return; }
      }
      var top = null;
      (e.sets || []).forEach(function (x) {
        var same = prev.filter(function (p) { return (p.w == null && x.w == null) || p.w === x.w; });
        if (!same.length) return;
        var m = Math.max.apply(null, same.map(function (p) { return p.r; }));
        if (x.r > m && (!top || x.r - m > top.r - top.prev)) top = { label: e.label, kind: 'reps', w: x.w, r: x.r, prev: m };
      });
      if (top) out.push(top);
    });
    return out;
  }
  // The HOME card state of a workout routine instance (null = not a card for this flow: the regular flow owns it).
  function cardState(o) {
    if (!o || !o.dt) return null;
    var now = o.now, today = ymdIn(new Date(now)), d = ymdIn(new Date(o.dt));
    if (o.completed) return 'done';
    if (d < today) return null;                                           // after midnight: missed / postpone own it
    if (o.inProgress) return 'progress';
    if (d > addDaysYmd(today, 1)) return 'far';
    if (d !== today) return 'tomorrow';
    return now < new Date(o.dt).getTime() - (o.unlockMin == null ? 30 : o.unlockMin) * 60000 ? 'locked' : 'open';
  }
  function daysBetween(a, b) { var p = a.split('-'), q = b.split('-'); return Math.round((Date.UTC(+q[0], q[1] - 1, +q[2]) - Date.UTC(+p[0], p[1] - 1, +p[2])) / 864e5); }
  // A variant from a list: stable for a seed, never the same index as `avoid` (the previous one).
  function pick(list, seed, avoid) {
    var n = list.length; if (!n) return { i: -1, text: '' };
    var i = parseInt(fnv(String(seed)), 16) % n; if (n > 1 && i === avoid) i = (i + 1) % n;
    return { i: i, text: list[i] };
  }
  function fill(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : ''; }); }
  // The coach line after a workout: ONE line with numbers, from the strongest fact (PR > progress > steady > first).
  function coachKind(session, prs, last) {
    if (prs && prs.length) return 'pr';
    if (!last) return 'first';
    var up = (session.exercises || []).some(function (e) { var l = (last.exercises || []).filter(function (x) { return labelKey(x.label) === labelKey(e.label); })[0]; var a = e.sets[0], b = l && l.sets[0]; return a && b && ((a.w || 0) > (b.w || 0) || ((a.w || 0) === (b.w || 0) && a.r > b.r)); });
    return up ? 'up' : 'same';
  }

  // ── ONE Hebrew string table for every workout screen and the HOME card (warm, short, masculine, never guilt) ──
  var TEXT = {
    dayOne: 'אימון', dayN: function (i) { return 'אימון ' + String.fromCharCode(65 + i); },
    goal: { strength: 'כוח', hypertrophy: 'מסה', general: 'כללי' },
    scheme: { desc: 'פירמידה יורדת', straight: 'סטים ישרים', asc: 'פירמידה עולה', custom: 'מותאם' },
    equip: { dumbbell: 'משקולות יד', barbell: 'מוט', machine: 'מכונה', cable: 'כבל', bodyweight: 'משקל גוף' },
    unitName: { kg: 'ק״ג', plates: 'פלטות', none: 'ללא' }, unit: { kg: 'ק״ג', plates: 'פלטות' },
    muscle: { chest: 'חזה', back: 'גב', shoulders: 'כתפיים', biceps: 'יד קדמית', triceps: 'יד אחורית', legs: 'רגליים', core: 'בטן', other: 'אחר' },
    templates: { fullbody: 'פול בודי · פירמידה יורדת', ppl: 'דחיפה / משיכה / רגליים', ul: 'עליון / תחתון', empty: 'תוכנית ריקה' },
    card: {
      far: ['אימון · בעוד {days} ימים', '{day} · בעוד {days} ימים', 'עוד {days} ימים, {day}'],
      tomorrow: ['מחר ב-{time} · {day}', 'מחר {day}, ב-{time}', '{day} מחר ב-{time}. נתכונן'],
      locked: ['היום ב-{time} · {day}', '{day} היום ב-{time}', 'היום {day}, ב-{time}'],
      open: ['הגיע הזמן, אדוני', 'הגיע הזמן. {day} מחכה', 'זה הרגע. {day}'],
      progress: ['המשך אימון · {elapsed} · סט {n}', 'באמצע {day} · {elapsed} · סט {n}', '{day} פתוח · {elapsed} · סט {n}'],
      done: ['הושלם · {duration} · {n} סטים', 'עשית את זה · {duration} · {n} סטים', 'סגרת את {day} · {duration} · {n} סטים'],
      last: ['בפעם שעברה {ex} {set}, היום יש מה לשבור', 'בפעם שעברה {ex} {set}. ממשיכים משם', '{ex} {set} בפעם שעברה. היום עוד קצת'],
      first: ['פעם ראשונה עם {day}. מתחילים רגוע', '{day} בפעם הראשונה. נבנה בסיס', 'אימון ראשון ב{day}. בלי לחץ'],
      unlocks: 'נפתח בעוד', openNow: 'פתח עכשיו', prepare: 'הכן אותי', start: 'התחל אימון', resume: 'המשך אימון', postpone: 'דחייה', skip: 'דלג',
      pr: function (t) { return 'שיא: ' + t; }, greetToday: function (t) { return 'היום אימון ב-' + t; }, greetOpen: 'האימון פתוח'
    },
    ui: {
      close: 'סגור', back: 'חזרה', save: 'שמור', cancel: 'ביטול', ok: 'אישור', none: 'אין', remove: 'הסר', more: 'עוד',
      programs: 'תוכניות', newProgram: '+ תוכנית חדשה', chooseTemplate: 'בחר תבנית', noPrograms: 'עוד אין תוכנית. בחר תבנית ונתחיל.',
      active: 'פעילה', makeActive: 'הגדר כפעילה', duplicate: 'שכפל', del: 'מחק', delProgram: 'למחוק את התוכנית?', copyOf: function (n) { return n + ' (עותק)'; },
      daysN: function (n) { return n === 1 ? 'יום אחד' : n + ' ימים'; }, exN: function (n) { return n === 1 ? 'תרגיל אחד' : n + ' תרגילים'; },
      editProgram: 'עריכת תוכנית', progName: 'שם התוכנית', goalT: 'מטרה', daysT: 'ימים', addDay: '+ יום', dayName: 'שם היום', removeDay: 'הסר יום',
      delDay: 'להסיר את היום?', addEx: '+ תרגיל', moveUp: 'הזז למעלה', moveDown: 'הזז למטה', discard: 'לצאת בלי לשמור?', noEx: 'אין עדיין תרגילים ביום הזה',
      exercise: 'תרגיל', exName: 'שם התרגיל', newEx: 'תרגיל חדש', muscleT: 'שריר', equipT: 'ציוד', unitT: 'יחידה', step: 'קפיצה', schemeT: 'שיטה',
      setsN: 'סטים', setN: function (i) { return 'סט ' + i; }, startW: 'משקל התחלה', restT: 'מנוחה', restAuto: 'אוטומטי', sec: 'שנ׳', warmT: 'חימום',
      warmOn: 'סטי חימום לפני התרגיל', saveEx: 'שמור תרגיל', removeEx: 'הסר תרגיל', delEx: 'להסיר את התרגיל?', needName: 'צריך שם לתרגיל',
      range: function (i) { return 'סט ' + i + ' · טווח חזרות'; }, min: 'מינימום', max: 'מקסימום', presets: 'מוכנים',
      ready: 'מוכן?', start: 'התחל', next: 'הבא', lockerT: 'תא ציוד', warmPreview: function (n) { return 'חימום · ' + n + ' סטים'; },
      feel: 'איך אתה מרגיש?', sleep: 'שינה', energy: 'אנרגיה', pain: 'כאבים', modeT: 'היום', modes: { full: 'מלא', light: 'קל יותר', short: 'קצר' },
      modeHint: { full: 'כל הסטים, היעדים הרגילים', light: 'היעדים פחות 10%', short: '2 סטים לכל תרגיל' }, suggested: 'הצעה',
      reps: 'חזרות', perHand: 'לכל יד', target: 'יעד', lastTime: 'בפעם שעברה', first: 'פעם ראשונה, מתחילים מהמשקל שהגדרת',
      st: { below: 'מתחת לטווח', 'in': 'בטווח', above: 'מעל הטווח' },
      done: '✓', doneLbl: 'סיימתי סט', rest: 'מנוחה', skipRest: 'דלג',
      addSet: '+ סט', skipEx: 'דלג על התרגיל', addExLive: '+ תרגיל', undo: '↶ בטל', finish: 'סיים אימון', allDone: 'זה הכל להיום. כל הכבוד.',
      pickEx: 'הוסף תרגיל', edit: 'עריכה', keep: 'שמור', warmSkip: 'דלג על החימום', warmDone: 'סט חימום בוצע',
      wake: 'השאר את המסך דולק', memFull: 'הזיכרון מלא. האימון נשמר רק כאן עד שתסיים',
      leave: 'לצאת? האימון נשמר, ותוכל להמשיך מאיפה שעצרת.', noSets: 'עוד לא נרשם אף סט. לסגור בלי לשמור?',
      sumT: 'סיכום', duration: 'משך', setsDone: function (n) { return n === 1 ? 'סט אחד' : n + ' סטים'; }, effort: 'כמה קשה היה?',
      backLive: 'חזרה לאימון', saveW: 'שמור אימון', existsQ: 'כבר שמרת היום אימון כזה', replace: 'החלף את הקיים', both: 'שמור את שניהם',
      saveErr: 'לא הצלחתי לשמור, אין מקום בזיכרון. האימון עדיין כאן',
      cmpFirst: 'פעם ראשונה', cmpSame: 'כמו בפעם שעברה', cmpKg: function (d, u) { return (d > 0 ? '+' : '') + d + ' ' + u; },
      cmpReps: function (d) { return d > 0 ? '+' + (d === 1 ? 'חזרה אחת' : d + ' חזרות') : (d === -1 ? 'חזרה אחת פחות' : -d + ' חזרות פחות'); },
      prE: function (l, v) { return l + ': 1RM משוער ' + v + ' ק״ג'; }, prR: function (l, w, r, u) { return l + ': ' + r + ' חזרות' + (w != null ? ' ב-' + w + ' ' + u : ''); },
      prsT: 'שיאים', estimate: 'הערכה לפי נוסחת Epley',
      lockerN: function (n) { return 'תא ' + n; }, kindT: 'סוג', kinds: { regular: 'רגיל', workout: 'אימון' }, minutes: function (n) { return n + ' דק׳'; }, open: 'יש אימון פתוח', resume: 'המשך', saveOld: 'שמור', delOld: 'מחק', delConfirm: 'למחוק את האימון הפתוח?',
      markQ: 'לסמן את השגרה כבוצעה?', mark: 'סמן כבוצעה', notNow: 'לא עכשיו', attachQ: 'לצרף לשגרה של היום?', attach: 'צרף', without: 'בלי', marked: 'סומן. כל הכבוד',
      asstStart: 'פותח את האימון.', asstNone: 'עוד אין תוכנית אימון. פותח את התוכניות.', asstNext: function (d, p, w) { return 'האימון הבא: ' + d + ' (' + p + ')' + (w ? ', ' + w : '') + '.'; },
      asstWhen: function (t) { return 'בשגרה: ' + t; }, asstOff: 'האימון החי כבוי כרגע.'
    },
    coach: {
      pr: ['שיא חדש ב{ex}: {val}. ככה בונים כוח', '{ex}: {val}, שיא. רשמתי', 'שברת שיא ב{ex}, {val}. יפה מאוד'],
      up: ['{ex}: {delta} מהפעם שעברה. ההתקדמות אמיתית', '{delta} ב{ex}. עוד צעד קדימה', '{ex} עלה ב-{delta}. בדיוק ככה'],
      same: ['{n} סטים, יציב כמו בפעם שעברה. בפעם הבאה עוד חזרה', '{n} סטים בכיס. יציבות זה כוח', 'שמרת על הקצב: {n} סטים'],
      first: ['אימון ראשון: {n} סטים. מכאן רק מודדים ועולים', '{n} סטים ראשונים. בפעם הבאה יהיה למה להשוות', 'התחלה טובה: {n} סטים']
    }
  };

  return { parse: parse, format: format, classify: classify, setsKey: setsKey, hashOf: hashOf, weekRange: weekRange, derive: derive, pattern: pattern, setsText: setsText,
    lastTimeBefore: lastTimeBefore, sortRecent: sortRecent, muscleOf: muscleOf, labelKey: labelKey, resolveDate: resolveDate, ymdIn: ymdIn, addDaysYmd: addDaysYmd, DEFAULT_ALIASES: DEFAULT_ALIASES, TZ: TZ,
    EQUIP: EQUIP, snap: snap, rangeStatus: rangeStatus, restFor: restFor, targetsFor: targetsFor, reduce: reduce, replay: replay, durationSec: durationSec, sessionFromLive: sessionFromLive,
    GOALS: GOALS, RANGE_PRESETS: RANGE_PRESETS, goalScheme: goalScheme, schemeFor: schemeFor, rangeValid: rangeValid, clampRange: clampRange, setSets: setSets,
    readPrograms: readPrograms, nextDay: nextDay, warmupSets: warmupSets, e1rm: e1rm, prsFor: prsFor, cardState: cardState, daysBetween: daysBetween,
    pick: pick, fill: fill, coachKind: coachKind, TEXT: TEXT };
});
