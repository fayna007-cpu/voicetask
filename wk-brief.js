// wk-brief.js — window.WkBrief: ONE pure read of "where the user stands with training right now".
// compute(o, now) -> a brief the home hero AND the notification journey both read, so they never disagree.
// Depends on WCore only (targetsFor / nextDay / weekRange / cardState / prsFor / e1rm / volume / lastTimeBefore).
// No DOM, no storage, no copy — numbers and phases only; the caller fills Hebrew copy from wk-copy using facts.
(function (root) {
  'use strict';
  var W = root.WCore || (typeof require !== 'undefined' && require('./workout-core.js'));
  var DAY = 864e5;

  // o = { enabled, instances:[{routineId,dt,completed,skipped}], routines:[{id,programId,name,kind,wkUnlockMin,enabled}],
  //       programs:(parsed or raw), sessions:[], catalog, draft:{startedAt,routineId,dateStr,exercises,test}|null, prefs, tz }
  function compute(o, now) {
    o = o || {}; now = now || Date.now();
    var tz = o.tz || W.TZ, today = W.ymdIn(new Date(now), tz);
    var brief = { phase: 'none', instance: null, isToday: false, workout: null, targets: null,
      facts: facts(o, now, tz), unlockAt: null, notifications: [] };
    var off = o.prefs && (o.prefs.testMode || o.prefs.off);
    var workoutRoutines = (o.routines || []).filter(function (r) { return r && r.kind === 'workout' && r.enabled !== false && program(o, r); });
    if (o.enabled === false || !workoutRoutines.length) return brief;

    // every upcoming / today non-skipped workout instance, each tied to its routine
    var insts = (o.instances || []).filter(function (i) { return i && i.dt && !i.skipped; })
      .map(function (i) { var r = routineOf(workoutRoutines, i.routineId); return r ? { i: i, r: r, ymd: W.ymdIn(new Date(i.dt), tz), ms: new Date(i.dt).getTime() } : null; })
      .filter(Boolean).sort(function (a, b) { return a.ms - b.ms; });

    // the hero is about TODAY if there is a workout today (an actionable one beats a finished one), else the NEXT upcoming one
    var isDone = function (x) { return x.i.completed || (o.sessions || []).some(function (s) { return s && s.source === 'live' && String(s.routineId) === String(x.r.id) && s.dateStr === x.i.dt; }); };
    var todays = insts.filter(function (x) { return x.ymd === today; });
    var hasDraft = function (x) { return o.draft && !o.draft.test && String(o.draft.routineId) === String(x.r.id) && o.draft.dateStr === x.i.dt && !isDone(x); };
    var todayInst = todays.filter(hasDraft)[0] || todays.filter(function (x) { return !isDone(x); })[0] || todays[0];
    var pick = todayInst || insts.filter(function (x) { return x.ymd >= today; })[0] || null;
    if (!pick) { brief.notifications = notifications(o, insts, now, tz); return brief; }   // the weekly summaries (friday/weekly review) fire from history even with no upcoming instance
    brief.instance = { routineId: String(pick.r.id), dt: pick.i.dt }; brief.isToday = pick === todayInst;

    var saved = (o.sessions || []).some(function (s) { return s && s.source === 'live' && String(s.routineId) === String(pick.r.id) && s.dateStr === pick.i.dt; });
    var dft = o.draft && !o.draft.test && String(o.draft.routineId) === String(pick.r.id) && o.draft.dateStr === pick.i.dt ? o.draft : null;
    var unlockMin = pick.r.wkUnlockMin == null ? 30 : pick.r.wkUnlockMin;
    brief.unlockAt = pick.ms - unlockMin * 60000;

    if (!brief.isToday) brief.phase = 'rest';
    else if (pick.i.completed || saved) brief.phase = 'done';
    else if (dft) brief.phase = 'inprogress';
    else brief.phase = W.cardState({ now: now, dt: pick.i.dt, unlockMin: unlockMin }) === 'open' ? 'open' : 'locked';

    var done = brief.phase === 'done' ? W.sortRecent((o.sessions || []).filter(function (s) { return String(s.routineId) === String(pick.r.id) && s.dateStr === pick.i.dt; }))[0] : null;
    brief.workout = done ? sessionPlan(done) : dayPlan(o, pick.r, now);
    brief.targets = done ? sessionTarget(o, done) : dayTarget(o, pick.r, now, brief.facts);
    if (done) { brief.facts.volume = Math.round(W.volume(done)); brief.facts.prCount = W.prsFor(done, (o.sessions || []).filter(function (s) { return s.id !== done.id && s.date <= done.date; })).length; }

    brief.notifications = notifications(o, insts, now, tz);
    return brief;
  }

  function routineOf(rs, id) { return rs.filter(function (r) { return String(r.id) === String(id); })[0] || null; }
  function program(o, r) {
    var raw = o.programs, st = raw && raw.programs ? raw : W.readPrograms(raw);
    return (st.programs || []).filter(function (p) { return p.id === (r && r.programId); })[0] || null;
  }
  function dayOf(o, r, now) { var p = program(o, r); return p ? W.nextDay(p, o.sessions) : null; }

  // the planned workout: muscles, exercise count, planned sets, a time estimate (rest + ~30 s work per set)
  function dayPlan(o, r, now) {
    var d = dayOf(o, r, now), p = program(o, r); if (!d || !d.exercises.length) return null;
    var muscles = [], seen = {}, sets = 0, secs = 0;
    d.exercises.forEach(function (e) {
      var m = W.muscleKey(e, o.catalog); if (!seen[m]) { seen[m] = 1; muscles.push(m); }
      var n = (e.scheme && e.scheme.sets) || 3; sets += n; secs += n * ((e.restSec || 90) + 30);
    });
    return { name: (p.days.length > 1 ? d.name : p.name) || p.name, muscles: muscles, exercises: d.exercises.length, sets: sets, mins: Math.max(1, Math.round(secs / 60)) };
  }
  function sessionPlan(s) {
    var muscles = [], seen = {}, sets = 0;
    (s.exercises || []).forEach(function (e) { var m = e.muscle || 'other'; if (!seen[m]) { seen[m] = 1; muscles.push(m); } sets += (e.sets || []).length; });
    return { name: s.dayName || s.type || '', muscles: muscles, exercises: (s.exercises || []).length, sets: sets, mins: Math.max(1, Math.round((s.durationSec || 0) / 60)) };
  }

  // the headline target: the first weighted exercise of the day; its next-set target and last time
  function dayTarget(o, r, now, f) {
    var d = dayOf(o, r, now); if (!d) return null;
    var ex = d.exercises.filter(function (e) { return e.equip !== 'bodyweight' && e.step && e.unit; })[0] || d.exercises[0]; if (!ex) return null;
    var last = W.lastTimeBefore(o.sessions, ex.label, W.addDaysYmd(W.ymdIn(new Date(now), o.tz), 1));
    var t = W.targetsFor(ex, last && last.sets, [])[0] || {}, l0 = last && last.sets && last.sets[0];
    var bw = ex.equip === 'bodyweight' || !ex.step || !ex.unit;
    var out = { exercise: ex.label, targetKg: bw ? null : (t.w == null ? null : t.w), targetReps: t.aim == null ? null : t.aim,
      lastKg: l0 && l0.w != null ? l0.w : null, lastReps: l0 ? W.firstR(l0) : null };
    f.nearPR = nearPR(o, ex, out);
    return out;
  }
  function sessionTarget(o, s) {
    var pr = W.prsFor(s, (o.sessions || []).filter(function (x) { return x.id !== s.id && x.date <= s.date; }))[0];
    var e = (s.exercises || []).filter(function (x) { return (x.sets || []).length; })[0];
    var top = e && (e.sets || []).reduce(function (a, b) { return (b.w || 0) > (a.w || 0) ? b : a; }, e.sets[0]);
    return { exercise: (pr && pr.label) || (e && e.label) || '', targetKg: top && top.w != null ? top.w : null, targetReps: top ? W.firstR(top) : null, lastKg: null, lastReps: null };
  }
  // hitting the target would tie or beat the best ever (kg -> Epley e1RM; bodyweight -> reps)
  function nearPR(o, ex, t) {
    var k = W.labelKey(ex.label), prev = [];
    (o.sessions || []).forEach(function (s) { (s.exercises || []).forEach(function (x) { if (W.labelKey(x.label) === k) prev = prev.concat(x.sets || []); }); });
    if (!prev.length) return false;
    if (t.targetKg != null && t.targetReps != null) {
      var te = W.e1rm(t.targetKg, t.targetReps); if (te == null) return false;
      var best = prev.reduce(function (m, x) { var v = W.e1rm(x.w, W.firstR(x)); return v != null && v > m ? v : m; }, 0);
      return best > 0 && te >= best;
    }
    if (t.targetReps != null) { var bw = prev.filter(function (x) { return x.w == null; }); return bw.length > 0 && t.targetReps > Math.max.apply(null, bw.map(W.firstR)); }
    return false;
  }

  // facts that stand regardless of phase: week progress, the streak, last-session volume / PRs
  function facts(o, now, tz) {
    var wk = W.weekRange(new Date(now), tz), sess = (o.sessions || []).filter(function (s) { return s && s.source === 'live'; });
    var inWeek = function (ms0, ms1) { return function (s) { var m = dateMs(s.dateStr || s.date); return m >= ms0 && m < ms1; }; };
    var weekDone = sess.filter(inWeek(wk.startMs, wk.endMs)).length;
    var weekPlanned = Math.max(weekDone, (o.instances || []).filter(function (i) { if (!i || i.skipped) return false; var m = new Date(i.dt).getTime(); return m >= wk.startMs && m < wk.endMs; }).length);
    var last = W.sortRecent(sess)[0];
    return { streakWeeks: streak(sess, wk, tz), weekDone: weekDone, weekPlanned: weekPlanned, nearPR: false,
      volume: last ? Math.round(W.volume(last)) : 0, prCount: 0 };
  }
  function streak(sess, wk, tz) {
    if (!sess.length) return 0;
    var has = {}; sess.forEach(function (s) { has[W.weekRange(W.ymdIn(new Date(s.dateStr || s.date), tz), tz).start] = 1; });
    var n = 0, start = wk.start;
    if (!has[start]) start = W.addDaysYmd(start, -7);                      // the streak may still count if THIS week is not done yet
    while (has[start]) { n++; start = W.addDaysYmd(start, -7); }
    return n;
  }
  function dateMs(s) { var p = String(s).split('T')[0].split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }

  // the 48 h journey: fire times only (copy is filled by the caller). Max 3/day; quiet 22:00–07:00 dropped; none in test / off.
  function notifications(o, insts, now, tz) {
    if (o.prefs && (o.prefs.testMode || o.prefs.off)) return [];
    var WIN = now + 2 * DAY, out = [];
    var localH = function (ms) { return +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(ms)).slice(0, 2); };
    var at = function (ymd, h, m) { var d = new Date(ymd + 'T00:00:00'); return dateMs(ymd) + (h * 60 + (m || 0)) * 60000 - tzOffset(ymd, tz); };
    var hm = function (s, dh, dm) { var m = /^(\d\d):(\d\d)$/.exec(String(s || '')); return m ? { h: +m[1], m: +m[2] } : { h: dh, m: dm }; };   // A14: configurable times
    var ev = hm(o.notif && o.notif.evening, 20, 0), mo = hm(o.notif && o.notif.morning, 9, 0);
    insts.forEach(function (x) {
      if (x.ms < now || x.ms > WIN || x.i.completed) return;
      var muscle = brMuscle(o, x.r, now);
      var add = function (type, ms) { if (ms > now && ms <= WIN) out.push({ type: type, fireAt: ms, instance: { routineId: String(x.r.id), dt: x.i.dt }, muscle: muscle }); };
      add('eveningBefore', at(W.addDaysYmd(x.ymd, -1), ev.h, ev.m));
      add('morning', at(x.ymd, mo.h, mo.m));
      add('warmup', x.ms - 45 * 60000);
      add('unlock', x.ms);
      add('rescue', x.ms + 60 * 60000);
    });
    // Friday teaser (summary) at 18:00, once in the window
    var fri = nextFriday(now, tz); if (fri > now && fri <= WIN) out.push({ type: 'fridayTeaser', fireAt: fri, instance: null, muscle: null });
    // B3 weekly review at Saturday 20:00 (configurable), once in the window -> deep-links to the insights screen
    var rev = hm(o.notif && o.notif.review, 20, 0), tday = W.ymdIn(new Date(now), tz);
    for (var kk = 0; kk < 3; kk++) { var yy = W.addDaysYmd(tday, kk); if (new Date(yy + 'T12:00:00').getDay() === 6) { var rms = at(yy, rev.h, rev.m); if (rms > now && rms <= WIN) out.push({ type: 'weeklyReview', fireAt: rms, instance: null, muscle: null }); break; } }
    // B4 backup reminder at Sunday 10:00 (configurable), only when >=1 real (non-test) session exists; deep-links to the export
    var bk = hm(o.notif && o.notif.backup, 10, 0), hasReal = (o.sessions || []).some(function (s) { return s && !s.test && s.source !== 'test'; });
    if (hasReal) for (var kb = 0; kb < 3; kb++) { var yb = W.addDaysYmd(tday, kb); if (new Date(yb + 'T12:00:00').getDay() === 0) { var bms = at(yb, bk.h, bk.m); if (bms > now && bms <= WIN) out.push({ type: 'backup', fireAt: bms, instance: null, muscle: null }); break; } }
    out = out.filter(function (n) { var h = localH(n.fireAt); return !(h >= 22 || h < 7); });   // quiet hours: drop
    out.sort(function (a, b) { return a.fireAt - b.fireAt; });
    return capPerDay(out, tz);
  }
  // when a day has more than 3, keep the ones nearest to acting; warm-up is the cuttable one (the cut list)
  var PRI = { unlock: 0, rescue: 1, morning: 2, warmup: 3, eveningBefore: 4, fridayTeaser: 5, weeklyReview: 6, backup: 7 };
  function capPerDay(list, tz) {
    var byDay = {};
    list.forEach(function (n) { var k = W.ymdIn(new Date(n.fireAt), tz); (byDay[k] = byDay[k] || []).push(n); });
    var keep = [];
    var pri = function (t) { return PRI[t] == null ? 9 : PRI[t]; };
    Object.keys(byDay).forEach(function (k) { byDay[k].sort(function (a, b) { return pri(a.type) - pri(b.type); }); keep = keep.concat(byDay[k].slice(0, 3)); });
    return keep.sort(function (a, b) { return a.fireAt - b.fireAt; });
  }
  function brMuscle(o, r, now) { var d = dayOf(o, r, now); return d && d.exercises[0] ? W.muscleKey(d.exercises[0], o.catalog) : null; }
  function nextFriday(now, tz) {
    var ymd = W.ymdIn(new Date(now), tz);
    for (var k = 0; k < 8; k++) { var y = W.addDaysYmd(ymd, k); if (new Date(y + 'T12:00:00').getDay() === 5) return atLocal(y, 18, tz); }
    return 0;
  }
  function atLocal(ymd, h, tz) { return dateMs(ymd) + h * 3600000 - tzOffset(ymd, tz); }
  function tzOffset(ymd, tz) {                                             // ms to subtract from a UTC-midnight so h is LOCAL
    var d = new Date(ymd + 'T00:00:00Z');
    var s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d).filter(function (p) { return p.type === 'timeZoneName'; })[0];
    var m = s && /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(s.value); if (!m) return 0;
    return (parseInt(m[1], 10) * 60 + (m[1][0] === '-' ? -1 : 1) * (m[2] ? +m[2] : 0)) * 60000;
  }

  var api = { compute: compute };
  root.WkBrief = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
