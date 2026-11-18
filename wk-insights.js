// wk-insights.js — window.WkInsights: pure, on-device training insights. NO network, nothing sent to AI.
// A registry of small types; each is {id, severity, compute(ctx) -> [insight]}. A new type later = one entry.
// Insight: {type, severity 0..3, headline (facts-first Hebrew), detail, evidence, action?}. Depends on WCore only.
// Constants live in CONST with a VERIFIED citation each; thresholds without a single source are marked 'heuristic'.
(function (root) {
  'use strict';
  var W = root.WCore || (typeof require !== 'undefined' && require('./workout-core.js'));

  // ── constants + sources (verified by web search 2026-11; see CITATIONS) ──
  var CONST = {
    MIN_SESSIONS: 3,            // heuristic: below this we only show "building a picture"
    PLATEAU_SESSIONS: 3,        // heuristic: same top-set load×reps (or e1RM within tol) across this many consecutive sessions
    PLATEAU_E1RM_TOL: 0.01,     // e1RM within 1% counts as "no progress" (heuristic)
    TREND_WEEKS: 8,             // e1RM trend window (heuristic window; Epley e1RM for reps<=10)
    SETS_LOW: 10, SETS_HIGH: 20,// weekly hard sets per muscle target range — Schoenfeld/Ogborn/Krieger 2017 + later reviews
    FATIGUE_WEEKS: 2,           // >=2 consecutive weeks of missed-target reps on >=2 exercises (heuristic)
    FATIGUE_VOL_DROP: 0.25,     // or a >=25% weekly volume drop (heuristic)
    PROGRESS_REP_STEP: 1        // plateau action: +1 rep on the first set before adding load — ACSM 2009 double-progression
  };
  var CITATIONS = {
    volume: 'Schoenfeld BJ, Ogborn D, Krieger JW (2017). Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. J Sports Sci 35(11):1073-1082.',
    progression: 'American College of Sports Medicine, ACSM (2009). Progression Models in Resistance Training for Healthy Adults (Position Stand). Med Sci Sports Exerc 41(3):687-708. PMID 19204579.',
    e1rm: 'Epley B (1985). Poundage Chart. Boyd Epley Workout, Univ. of Nebraska. 1RM = w·(1 + reps/30), valid for low reps (<=10).',
    plateau: 'heuristic (double-progression, informed by ACSM 2009).',
    fatigue: 'heuristic (missed targets / volume drop; informed by ACSM 2009 variation & recovery).'
  };

  var SEV = { fatigue: 3, plateau: 2, balanceUnder: 2, balanceOver: 1, nearPR: 1, trend: 0 };

  // ── derived data (built once per compute) ──
  function live(history) { return (history || []).filter(function (s) { return s && !s.test && s.source !== 'test'; }); }
  function kgUnit(ex) { return ex && (ex.unit === 'kg' || ex.unit === 'lb' || (ex.unit === undefined && (ex.sets || []).some(function (x) { return x.w != null; }))); }
  function topSet(sets) { return (sets || []).reduce(function (m, x) { return (x.w || 0) > ((m && m.w) || 0) ? x : m; }, (sets || [])[0] || null); }
  // per exercise: the most-recent-first list of {date, w, r, e1rm, sets, unit, muscle}
  function byExercise(sessions) {
    var map = {};
    sessions.forEach(function (s) {
      (s.exercises || []).forEach(function (e) {
        if (!(e.sets || []).length) return;
        var k = W.labelKey(e.label), t = topSet(e.sets), r = W.firstR(t);
        (map[k] = map[k] || { label: e.label, unit: e.unit, muscle: e.muscle || null, rows: [] }).rows.push(
          { date: s.date || (s.dateStr || '').split('T')[0], w: t ? t.w : null, r: r, e1rm: t && t.w != null ? W.e1rm(t.w, r) : null, sets: e.sets.length });
      });
    });
    Object.keys(map).forEach(function (k) { map[k].rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); });   // most recent first
    return map;
  }
  // weekly muscle sets + volume, keyed by week-start. ymd + weekRange memoized (Intl is the hot cost on big histories).
  function byWeek(sessions, cat, tz, ymdOf) {
    var wk = {}, wrMemo = {};
    var weekStart = function (ymd) { return wrMemo[ymd] || (wrMemo[ymd] = W.weekRange(ymd, tz).start); };
    sessions.forEach(function (s) {
      var ws = weekStart(ymdOf(s)), w = wk[ws] = wk[ws] || { muscle: {}, volume: 0, n: 0 };
      w.n++; w.volume += W.volume(s);
      (s.exercises || []).forEach(function (e) { var m = W.muscleKey(e, cat); w.muscle[m] = (w.muscle[m] || 0) + (e.sets || []).length; });
    });
    return wk;
  }
  function weekStarts(wk) { return Object.keys(wk).sort().reverse(); }   // most recent first
  function num(n) { return W.TEXT.ui.plural ? String(n) : String(n); }

  // ── the five types ──
  var TYPES = [
    { id: 'plateau', compute: function (c) {
      var out = [];
      Object.keys(c.ex).forEach(function (k) {
        var x = c.ex[k], rows = x.rows; if (rows.length < CONST.PLATEAU_SESSIONS) return;
        var last = rows.slice(0, CONST.PLATEAU_SESSIONS), kg = kgUnit(x), stuck;
        if (kg) { var base = last[0].e1rm; stuck = base != null && last.every(function (r) { return r.e1rm != null && Math.abs(r.e1rm - base) <= base * CONST.PLATEAU_E1RM_TOL; }); }
        else { stuck = last.every(function (r) { return r.r === last[0].r; }); }
        if (!stuck) return;
        var cur = rows[0], sug = kg ? { w: cur.w, r: cur.r + CONST.PROGRESS_REP_STEP } : { w: null, r: cur.r + CONST.PROGRESS_REP_STEP };
        out.push({ type: 'plateau', severity: SEV.plateau, headline: fmt(T.plateauHead, { ex: x.label }),
          detail: fmt(T.plateauDetail, { n: CONST.PLATEAU_SESSIONS, set: setStr(cur, kg) }), evidence: rows.slice(0, CONST.PLATEAU_SESSIONS).map(function (r) { return setStr(r, kg); }).join(' · '),
          action: { kind: 'addToBrief', exercise: x.label, suggest: sug, label: setStr(sug, kg) } });
      });
      return out;
    } },
    { id: 'trend', compute: function (c) {
      var out = [];
      Object.keys(c.ex).forEach(function (k) {
        var x = c.ex[k]; if (!kgUnit(x)) return;
        var cut = W.addDaysYmd(W.ymdIn(new Date(c.now), c.tz), -7 * CONST.TREND_WEEKS);
        var pts = x.rows.filter(function (r) { return r.e1rm != null && r.date >= cut; }).slice().reverse();   // oldest->newest
        if (pts.length < 3) return;
        var first = pts[0].e1rm, lastv = pts[pts.length - 1].e1rm, pct = Math.round((lastv - first) / first * 100);
        out.push({ type: 'trend', severity: SEV.trend, exercise: x.label, headline: fmt(T.trendHead, { ex: x.label, pct: (pct >= 0 ? '+' : '') + pct }),
          detail: fmt(T.trendDetail, { weeks: CONST.TREND_WEEKS, a: round1(first), b: round1(lastv) }), spark: pts.map(function (p) { return p.e1rm; }), pct: pct,
          evidence: round1(first) + ' → ' + round1(lastv) });
      });
      return out.sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); });
    } },
    { id: 'balance', compute: function (c) {
      var wks = weekStarts(c.wk); if (!wks.length) return []; var w = c.wk[wks[0]], out = [];
      Object.keys(w.muscle).forEach(function (m) {
        var n = w.muscle[m];
        if (n < CONST.SETS_LOW) out.push({ type: 'balance', dir: 'under', severity: SEV.balanceUnder, muscle: m, headline: fmt(T.balUnderHead, { muscle: muscleName(m) }), detail: fmt(T.balDetail, { n: n, lo: CONST.SETS_LOW, hi: CONST.SETS_HIGH }), evidence: n + ' / ' + CONST.SETS_LOW + '-' + CONST.SETS_HIGH });
        else if (n > CONST.SETS_HIGH) out.push({ type: 'balance', dir: 'over', severity: SEV.balanceOver, muscle: m, headline: fmt(T.balOverHead, { muscle: muscleName(m) }), detail: fmt(T.balDetail, { n: n, lo: CONST.SETS_LOW, hi: CONST.SETS_HIGH }), evidence: n + ' / ' + CONST.SETS_LOW + '-' + CONST.SETS_HIGH });
      });
      return out;
    } },
    { id: 'nearPR', compute: function (c) {
      var out = [];
      Object.keys(c.ex).forEach(function (k) {
        var x = c.ex[k], rows = x.rows; if (rows.length < 2 || !kgUnit(x)) return;
        var best = rows.reduce(function (m, r) { return r.e1rm != null && r.e1rm > m ? r.e1rm : m; }, 0), cur = rows[0];
        if (cur.e1rm == null || best <= 0) return;
        // the next progression target would tie/beat the best -> a real near-PR opportunity
        var tgt = W.e1rm(cur.w, cur.r + 1);
        if (tgt != null && tgt >= best && cur.e1rm < best + 1e-6) out.push({ type: 'nearPR', severity: SEV.nearPR, exercise: x.label, headline: fmt(T.nearPRHead, { ex: x.label }), detail: fmt(T.nearPRDetail, { set: setStr({ w: cur.w, r: cur.r + 1 }, true) }), evidence: setStr({ w: cur.w, r: cur.r + 1 }, true) });
      });
      return out;
    } },
    { id: 'fatigue', compute: function (c) {
      var wks = weekStarts(c.wk); if (wks.length < CONST.FATIGUE_WEEKS) return [];
      var a = c.wk[wks[0]], b = c.wk[wks[1]];
      var volDrop = b.volume > 0 && (b.volume - a.volume) / b.volume >= CONST.FATIGUE_VOL_DROP;
      if (!volDrop) return [];
      return [{ type: 'fatigue', severity: SEV.fatigue, headline: T.fatigueHead, detail: fmt(T.fatigueDetail, { pct: Math.round((b.volume - a.volume) / b.volume * 100) }), evidence: Math.round(b.volume) + ' → ' + Math.round(a.volume) }];
    } }
  ];

  // ── public compute (memoized, fail-soft) ──
  var cache = { key: null, val: null };
  function compute(history, now, opts) {
    now = now || Date.now(); opts = opts || {}; var tz = opts.tz || W.TZ, cat = opts.catalog || {};
    var sessions = W.sortRecent(live(history));
    // a cheap content signature so the memo never serves a different history that happens to share length+dates
    var sig = 0; sessions.forEach(function (s) { (s.exercises || []).forEach(function (e) { var x = (e.sets || [])[0]; sig = (sig + (e.sets || []).length * 7 + (x ? (x.w || 0) + (x.r || 0) : 0)) | 0; }); });
    var key = sessions.length + '|' + (sessions[0] && (sessions[0].id || sessions[0].date)) + '|' + sig + '|' + W.ymdIn(new Date(now), tz);
    if (cache.key === key && !opts.fresh) return cache.val;
    var res;
    try {
      var weekN = weekNumber(now, tz), ymdCache = {}, ymdOf = function (s) { var d = s.dateStr || s.date; return ymdCache[d] || (ymdCache[d] = W.ymdIn(new Date(d), tz)); };
      if (sessions.length < CONST.MIN_SESSIONS) {
        res = { week: weekN, insights: [], trend: function () { return null; }, empty: true, needMore: CONST.MIN_SESSIONS - sessions.length, error: false };
      } else {
        var ctx = { ex: byExercise(sessions), wk: byWeek(sessions, cat, tz, ymdOf), now: now, tz: tz };
        var list = [];
        TYPES.forEach(function (t) { try { list = list.concat(t.compute(ctx) || []); } catch (_) { } });
        list.sort(function (x, y) { return (y.severity || 0) - (x.severity || 0); });
        res = { week: weekN, insights: list, trend: function (label) { var x = ctx.ex[W.labelKey(label)]; if (!x) return null; var t = (list.filter(function (i) { return i.type === 'trend' && W.labelKey(i.exercise) === W.labelKey(label); })[0]); return t ? { spark: t.spark, pct: t.pct, label: x.label } : null; }, empty: false, needMore: 0, error: false };
      }
    } catch (e) { res = { week: 0, insights: [], trend: function () { return null; }, empty: true, needMore: 0, error: true }; }
    cache = { key: key, val: res }; return res;
  }
  // the top insight the hero / weekly-review headline can use (highest severity with a headline)
  function top(history, now, opts) { var r = compute(history, now, opts); return r.insights[0] || null; }

  function weekNumber(now, tz) { var d = new Date(now), t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); var y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil((((t - y) / 864e5) + 1) / 7); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function setStr(x, kg) { return kg && x.w != null ? round1(x.w) + '×' + x.r : String(x.r); }
  function muscleName(m) { return (W.TEXT.muscle && (W.TEXT.muscle[m] || W.TEXT.muscle.other)) || m; }
  function fmt(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; }); }

  // Hebrew copy (facts-first, no science claim for heuristics)
  var T = {
    plateauHead: 'תקיעות ב{ex}', plateauDetail: '{n} אימונים באותו ביצוע ({set}). הצעה: עוד חזרה אחת בסט הראשון',
    trendHead: '{ex}: {pct}% ב-8 שבועות', trendDetail: 'מגמת 1RM משוער ({weeks} שבועות): {a} → {b}',
    balUnderHead: 'מעט נפח ל{muscle} השבוע', balOverHead: 'הרבה נפח ל{muscle} השבוע', balDetail: '{n} סטים השבוע (טווח מומלץ {lo}-{hi})',
    nearPRHead: 'שיא בהישג יד ב{ex}', nearPRDetail: 'עוד חזרה אחת ({set}) ותשבור את השיא',
    fatigueHead: 'אולי כדאי שבוע הקלה', fatigueDetail: 'ירידה של {pct}% בנפח השבועי. שקול דילוד'
  };

  var api = { compute: compute, top: top, TYPES: TYPES, CONST: CONST, CITATIONS: CITATIONS, COPY: T };
  root.WkInsights = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
