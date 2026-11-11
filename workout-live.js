// WorkoutLive: every full-screen workout view (programs, program / exercise editors, ready, live, summary) in ONE shell (#wkLive:
// fixed header, a scroll area only inside the content, a fixed footer with the ONE primary action), the bottom picker (#wkPick),
// the HOME card of workout routines (WorkoutHome) and the routine-form hooks (WorkoutForm). Pure logic + every string: workout-core.js.
// State of a workout = an action log replayed by WCore.replay; vt_wk_draft is saved after EVERY action, so a killed app resumes.
// Storage (all OPTIONAL keys): vt_wk_programs, vt_wk_draft, vt_wk_coach; a finished workout is appended to vt_wk_sessions.
// Kill switch: vt_wk_off = '1'. Routines: only the optional kind / programId fields, and a silent completion when the owner taps it.
(function () {
  'use strict';
  var W = window.WCore, T = W.TEXT, S = T.ui;
  var KEY_P = 'vt_wk_programs', KEY_D = 'vt_wk_draft', KEY_S = 'vt_wk_sessions', KEY_OFF = 'vt_wk_off', KEY_HINT = 'vt_wk_wakehint', KEY_COACH = 'vt_wk_coach';
  var STALE_MS = 6 * 3600e3, RING = 552.92;
  var EQUIP_ORDER = ['dumbbell', 'barbell', 'machine', 'cable', 'bodyweight'], MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'other'];
  var START_W = { dumbbell: 10, barbell: 20, machine: 4, cable: 15, bodyweight: null }, STEPS = [0.5, 1, 1.25, 2, 2.5, 5], RESTS = [0, 60, 90, 120, 150, 180];
  var $ = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n) { return '<bdi dir="ltr">' + h(n) + '</bdi>'; };
  var setTxt = function (x) { return '<bdi dir="ltr">' + (x.w == null ? h(x.r) : h(x.w) + '×' + h(x.r)) + '</bdi>'; };
  var js = function (v) { return h(JSON.stringify(v)); };                // a value inside an onclick="" attribute

  // ── storage (never throws; a full storage keeps the workout in memory) ──
  function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (_) { return def; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  function drop(k) { try { localStorage.removeItem(k); } catch (_) { } }
  function enabled() { try { return localStorage.getItem(KEY_OFF) !== '1'; } catch (_) { return true; } }
  var sessions = function () { var s = load(KEY_S, []); return Array.isArray(s) ? s : []; };
  var uid = (function () { var last = 0; return function (p) { last = Math.max(Date.now(), last + 1); return p + last.toString(36); }; })();
  var copy = function (x) { return JSON.parse(JSON.stringify(x)); };
  // index.html keeps routines in a top-level `let` (shared by classic scripts, not on window)
  function allRoutines() { try { return Array.isArray(routines) ? routines : []; } catch (_) { return []; } }

  // ── programs ──
  function store() { return W.readPrograms(load(KEY_P, null)); }
  function saveStore(st) { return put(KEY_P, { v: 2, activeId: st.activeId, programs: st.programs }); }
  function programById(id) { var st = store(); return st.programs.filter(function (p) { return p.id === id; })[0] || st.programs.filter(function (p) { return p.id === st.activeId; })[0] || null; }
  function mkEx(label, equip, muscle, goal) {
    var q = W.EQUIP[equip];
    return { id: uid('e'), label: label, muscle: muscle || null, equip: equip, unit: q.unit, step: q.step, scheme: W.goalScheme(goal || 'general'), startW: START_W[equip], restSec: 0, warmup: false };
  }
  function day(name, list, goal) { return { id: uid('d'), name: name, exercises: list.map(function (x) { return mkEx(x[0], x[1], x[2], goal); }) }; }
  function template(kind) {
    var N = T.templates;
    if (kind === 'fullbody') {
      var p = { id: uid('p'), name: N.fullbody, goal: 'strength', lastDay: null, days: [day(T.dayOne, [['מתח', 'bodyweight', 'back'], ['חזה', 'dumbbell', 'chest'], ['כתפיים', 'dumbbell', 'shoulders'], ['יד קדמית', 'dumbbell', 'biceps'], ['יד אחורית', 'dumbbell', 'triceps'], ['רגליים', 'machine', 'legs']], 'strength')] };
      p.days[0].exercises.forEach(function (e) { e.scheme = W.schemeFor('desc', 'strength'); });
      return p;
    }
    if (kind === 'ppl') return { id: uid('p'), name: N.ppl, goal: 'hypertrophy', lastDay: null, days: [
      day('דחיפה', [['חזה', 'dumbbell', 'chest'], ['כתפיים', 'dumbbell', 'shoulders'], ['יד אחורית', 'cable', 'triceps']], 'hypertrophy'),
      day('משיכה', [['מתח', 'bodyweight', 'back'], ['חתירה', 'cable', 'back'], ['יד קדמית', 'dumbbell', 'biceps']], 'hypertrophy'),
      day('רגליים', [['סקוואט', 'barbell', 'legs'], ['לחיצת רגליים', 'machine', 'legs'], ['תאומים', 'machine', 'legs']], 'hypertrophy')] };
    if (kind === 'ul') return { id: uid('p'), name: N.ul, goal: 'general', lastDay: null, days: [
      day('עליון', [['חזה', 'dumbbell', 'chest'], ['חתירה', 'cable', 'back'], ['כתפיים', 'dumbbell', 'shoulders']], 'general'),
      day('תחתון', [['רגליים', 'machine', 'legs'], ['ירך אחורית', 'machine', 'legs'], ['בטן', 'bodyweight', 'core']], 'general')] };
    return { id: uid('p'), name: N.empty, goal: 'general', lastDay: null, days: [{ id: uid('d'), name: T.dayN(0), exercises: [] }] };
  }
  var unitTxt = function (ex) { return ex.unit === 'plates' ? T.unit.plates : ex.unit === 'kg' ? T.unit.kg : ''; };
  var isBw = function (ex) { return ex.equip === 'bodyweight' || !ex.step || !ex.unit; };
  var rangesTxt = function (sc) { return (sc.ranges || []).slice(0, sc.sets || 3).map(function (r) { return '<bdi dir="ltr">' + r[0] + '-' + r[1] + '</bdi>'; }).join(' · '); };

  // ── draft (action log) ──
  var draft = null, state = null;
  function readDraft() {
    var d = load(KEY_D, null);
    if (!d || typeof d !== 'object' || !Array.isArray(d.actions)) return null;
    var s = W.replay(d.actions);
    return s && !s.finished ? { d: d, s: s } : null;
  }
  function hasDraft() { return enabled() && !!readDraft(); }
  function isStale(d) { return Date.now() - Math.max(d.s.startedAt || 0, d.s.lastAt || 0) > STALE_MS; }
  function dispatch(a) {
    a.at = a.at || Date.now();
    if (a.type === 'UNDO') { if (draft.actions.length > 1) draft.actions.pop(); }
    else draft.actions.push(a);
    state = W.replay(draft.actions);
    ui.memOnly = !put(KEY_D, draft);
  }

  // ── UI state (not persisted) ──
  var ui = { mode: 'live', stack: [], view: 0, pend: {}, extra: {}, editing: null, memOnly: false, effort: null, locker: null, exists: false, err: '',
    chimed: 0, wakeHint: false, lastTap: 0, warm: {}, prog: null, dirty: false, dayIdx: 0, ex: null, exIdx: -1, ctx: null, ready: null, pick: null, after: null };
  var timer = null, wake = null;
  var tomorrow = function () { return W.addDaysYmd(W.ymdIn(new Date()), 1); };
  function lastOf(label) { return W.lastTimeBefore(sessions(), label, tomorrow()); }
  var exDone = function (ex) { return ex.skipped || ex.sets.length >= ((ex.scheme && ex.scheme.sets) || 3); };
  var clock = function (sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60, hh = Math.floor(m / 60); return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  var hms = function (sec) { sec = Math.max(0, Math.floor(sec)); var p = function (n) { return String(n).padStart(2, '0'); }; return p(Math.floor(sec / 3600)) + ':' + p(Math.floor(sec / 60) % 60) + ':' + p(sec % 60); };
  var mins = function (sec) { return S.minutes(Math.max(1, Math.round((sec || 0) / 60))); };
  var elMin = function (ms) { return Math.max(0, Math.floor(ms / 60000)); };           // elapsed whole minutes (a card never shows a clock-like 12:00)

  // ── the shell: fixed header, scroll area, fixed footer; page scroll locked; the keyboard never hides the footer ──
  var lockY = 0, locked = false;
  function lockPage() {
    if (locked) return; locked = true; lockY = window.scrollY || 0;
    var b = document.body.style; b.position = 'fixed'; b.top = -lockY + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
    document.body.classList.add('wk-lock');
  }
  function unlockPage() {
    if (!locked) return; locked = false;
    var b = document.body.style; b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
    document.body.classList.remove('wk-lock'); window.scrollTo(0, lockY);
  }
  function fitViewport() {                                             // follow the visual viewport (keyboard open) so the footer stays visible
    var el = $('wkLive'), vv = window.visualViewport; if (!el || !vv) return;
    el.style.setProperty('--wk-vh', Math.round(vv.height) + 'px'); el.style.setProperty('--wk-top', Math.round(vv.offsetTop) + 'px');
  }
  function ensure() {
    if ($('wkLive')) return;
    var el = document.createElement('div');
    el.id = 'wkLive'; el.className = 'wk-live'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.dir = 'rtl';
    el.innerHTML = '<div class="wk-lv-head"><button class="wk-lv-x" id="wkLvX" onclick="WorkoutLive.close()" aria-label="' + S.close + '">✕</button><div class="wk-lv-name" id="wkLvName"></div><div class="wk-lv-el" id="wkLvEl" dir="ltr"></div></div>'
      + '<div class="wk-lv-prog" id="wkLvProg"></div><div class="wk-lv-main" id="wkLvMain"></div><div class="wk-lv-dock" id="wkLvDock"></div>';
    document.body.appendChild(el);
    var pk = document.createElement('div');
    pk.id = 'wkPick'; pk.className = 'wk-pick'; pk.dir = 'rtl';
    pk.innerHTML = '<div class="wk-pick-bg" onclick="WorkoutLive.pickClose()"></div><div class="wk-pick-card" role="dialog" aria-modal="true"><div class="wk-pick-h"><span id="wkPickT"></span><button class="wk-lv-x" onclick="WorkoutLive.pickClose()" aria-label="' + S.close + '">✕</button></div><div class="wk-pick-b" id="wkPickB"></div><div class="wk-pick-f" id="wkPickF"></div></div>';
    document.body.appendChild(pk);
    [el, pk].forEach(function (x) { x.addEventListener('pointerdown', onPress); });
    ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, stopRepeat, true); });
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitViewport); window.visualViewport.addEventListener('scroll', fitViewport); }
    el.addEventListener('focusin', function (e) { if (e.target.matches('input')) setTimeout(function () { fitViewport(); e.target.scrollIntoView({ block: 'center' }); }, 250); });
  }
  function isOpen() { return !!($('wkLive') && $('wkLive').classList.contains('on')); }
  function show() { ensure(); fitViewport(); $('wkLive').classList.add('on'); lockPage(); render(); startTimer(); }
  function hide() {
    var el = $('wkLive'); if (el) el.classList.remove('on'); pickClose(); unlockPage();
    stopTimer(); releaseWake(); stopRepeat(); ui.stack = [];
  }
  function go(mode) { ui.mode = mode; var m = $('wkLvMain'); render(); if (m) m.scrollTop = 0; }
  function push(mode) { ui.stack.push(ui.mode); go(mode); }
  function back() { var m = ui.stack.pop(); if (m) go(m); else { hide(); refreshAll(); } }
  function refreshAll() { var s = $('wkSheet'); if (s && s.classList.contains('on') && window.Workout) window.Workout.open(); try { if (window.render) window.render(); } catch (_) { } banner(); }

  // ── THE single entry: HOME card, sheet button, assistant ──
  function start(o) {
    o = o || {};
    if (!enabled()) return;
    audio(true);
    var r = readDraft();
    if (r) { draft = r.d; state = r.s; ui.view = state.exIdx; ui.pend = {}; ui.extra = {}; ui.editing = null; ui.stack = []; ui.mode = 'live'; acquireWake(); hideBanner(); show(); return; }
    ui.ctx = { routineId: o.routineId != null ? String(o.routineId) : null, dateStr: o.dateStr || null, programId: o.programId || null };
    if (!store().programs.length) { ui.after = 'ready'; ui.stack = []; ui.mode = 'programs'; show(); return; }
    openReady();
  }
  function routineOf(id) { try { return allRoutines().filter(function (r) { return String(r.id) === String(id); })[0] || null; } catch (_) { return null; } }
  function openReady() {
    var c = ui.ctx || {}, r = c.routineId ? routineOf(c.routineId) : null;
    var p = programById(c.programId || (r && r.programId) || null); if (!p) { ui.mode = 'programs'; show(); return; }
    var d = W.nextDay(p, sessions()), prev = W.sortRecent(sessions()).filter(function (s) { return s.programId === p.id && s.locker != null; })[0];
    ui.ready = { programId: p.id, dayId: d ? d.id : null, nextId: d ? d.id : null, locker: prev ? prev.locker : null, warmOpen: false, feelOpen: false, feel: {}, mode: 'full', modeTouched: false };
    ui.stack = []; ui.mode = 'ready'; show();
  }
  function begin() {
    var R = ui.ready, p = programById(R.programId), d = p && p.days.filter(function (x) { return x.id === R.dayId; })[0];
    if (!d || !d.exercises.length) return;
    var c = ui.ctx || {};
    draft = { v: 1, startedAt: Date.now(), actions: [] };
    dispatch({ type: 'START', at: draft.startedAt, locker: R.locker, program: { id: p.id, name: p.days.length > 1 ? p.name + ' · ' + d.name : p.name, exercises: copy(d.exercises) },
      dayId: d.id, dayName: d.name, routineId: c.routineId, dateStr: c.dateStr, goal: p.goal, mode: R.mode });
    ui.view = 0; ui.pend = {}; ui.extra = {}; ui.editing = null; ui.effort = null; ui.exists = false; ui.err = ''; ui.chimed = 0; ui.warm = {}; ui.stack = [];
    acquireWake(); hideBanner(); go('live');
  }
  function close() {
    if (ui.pick) { pickClose(); return; }
    if (ui.mode === 'program' && ui.dirty && !confirm(S.discard)) return;
    if (ui.mode === 'finish') { go('live'); return; }
    if (ui.mode === 'live') {
      var logged = state && state.exercises.some(function (e) { return e.sets.length; });
      if (logged) { if (!confirm(S.leave)) return; }
      else { drop(KEY_D); draft = null; state = null; }
      hide(); refreshAll(); return;
    }
    if (ui.mode === 'programs' && ui.after === 'ready') { ui.after = null; hide(); refreshAll(); return; }
    back();
  }

  // ── programs screen ──
  function openPrograms(after) { ui.after = after || null; ui.stack = []; ui.mode = 'programs'; show(); }
  function useTemplate(kind) {
    var st = store(), p = template(kind); st.programs.push(p); st.activeId = p.id; saveStore(st); pickClose();
    if (ui.after === 'form') { ui.after = null; form.programId = p.id; hide(); formRender(); return; }
    if (ui.after === 'ready') { ui.after = null; ui.ctx = ui.ctx || {}; ui.ctx.programId = p.id; openReady(); return; }
    editProgram(p.id);
  }
  function programMenu(id) {
    var st = store(), p = st.programs.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    pickOpen(h(p.name), [st.activeId !== id ? row(S.makeActive, 'WorkoutLive.setActive(' + js(id) + ')') : '', row(S.duplicate, 'WorkoutLive.dupProgram(' + js(id) + ')'), row(S.del, 'WorkoutLive.delProgram(' + js(id) + ')', 'wk-danger')].join(''), '');
  }
  function setActive(id) { var st = store(); st.activeId = id; saveStore(st); pickClose(); render(); }
  function dupProgram(id) { var st = store(), p = copy(st.programs.filter(function (x) { return x.id === id; })[0]); p.id = uid('p'); p.name = S.copyOf(p.name); p.lastDay = null; p.days.forEach(function (d) { d.id = uid('d'); d.exercises.forEach(function (e) { e.id = uid('e'); }); }); st.programs.push(p); saveStore(st); pickClose(); render(); }
  function delProgram(id) { if (!confirm(S.delProgram)) return; var st = store(); st.programs = st.programs.filter(function (x) { return x.id !== id; }); if (st.activeId === id) st.activeId = st.programs[0] ? st.programs[0].id : null; saveStore(st); pickClose(); render(); }
  function templatesPick() {
    pickOpen(S.chooseTemplate, ['fullbody', 'ppl', 'ul', 'empty'].map(function (k) {
      var p = template(k); return row(T.templates[k], 'WorkoutLive.useTemplate(\'' + k + '\')', '', S.daysN(p.days.length) + ' · ' + T.goal[p.goal]);
    }).join(''), '');
  }

  // ── program editor (works on a copy; "שמור" writes) ──
  function editProgram(id) { var p = programById(id); if (!p) return; ui.prog = copy(p); ui.dirty = false; ui.dayIdx = 0; if (!isOpen()) { ui.stack = []; ui.mode = 'program'; show(); } else push('program'); }
  function pDay() { return ui.prog.days[Math.min(ui.dayIdx, ui.prog.days.length - 1)]; }
  function setProgName(v) { ui.prog.name = v; ui.dirty = true; }
  function setGoal(g) { ui.prog.goal = g; ui.dirty = true; render(); }
  function selDay(i) { ui.dayIdx = i; render(); }
  function addDay() { ui.prog.days.push({ id: uid('d'), name: T.dayN(ui.prog.days.length), exercises: [] }); ui.dayIdx = ui.prog.days.length - 1; ui.dirty = true; render(); }
  function setDayName(v) { pDay().name = v; ui.dirty = true; var c = document.querySelector('.wk-daychip.on'); if (c) c.textContent = v || ' '; }
  function removeDay() { if (ui.prog.days.length < 2 || !confirm(S.delDay)) return; ui.prog.days.splice(ui.dayIdx, 1); ui.dayIdx = 0; ui.dirty = true; render(); }
  function moveEx(i, d) { var l = pDay().exercises, j = i + d; if (j < 0 || j >= l.length) return; var t = l[i]; l[i] = l[j]; l[j] = t; ui.dirty = true; render(); }
  function saveProgram() {
    var p = ui.prog; p.name = String(p.name || '').trim() || T.templates.empty;
    p.days.forEach(function (d, i) { d.name = String(d.name || '').trim() || T.dayN(i); });
    var st = store(), i = st.programs.map(function (x) { return x.id; }).indexOf(p.id);
    if (i > -1) st.programs[i] = p; else st.programs.push(p);
    if (!st.activeId) st.activeId = p.id;
    saveStore(st); ui.dirty = false; back();
  }

  // ── exercise editor ──
  function editEx(i) { var d = pDay(); ui.exIdx = i; ui.ex = i < 0 ? mkEx('', 'dumbbell', null, ui.prog.goal) : copy(d.exercises[i]); if (!ui.ex.scheme) ui.ex.scheme = W.goalScheme(ui.prog.goal); ui.err = ''; push('exercise'); }
  function exSet(k, v) {
    var e = ui.ex;
    if (k === 'label') { e.label = v; return; }
    if (k === 'equip') { var q = W.EQUIP[v]; e.equip = v; e.unit = q.unit; e.step = q.step; e.startW = START_W[v]; }
    else if (k === 'unit') { e.unit = v === 'none' ? null : v; if (!e.unit) { e.step = 0; e.startW = null; } else if (!e.step) { e.step = v === 'plates' ? 0.5 : 2; e.startW = v === 'plates' ? 4 : 10; } }
    else if (k === 'scheme') e.scheme = W.schemeFor(v, ui.prog.goal, e.scheme);
    else e[k] = v;
    render();
  }
  function saveEx() {
    var e = ui.ex; e.label = String(e.label || '').trim();
    if (!e.label) { ui.err = S.needName; render(); var b = $('wkExName'); if (b) b.focus(); return; }
    var l = pDay().exercises; if (ui.exIdx < 0) l.push(e); else l[ui.exIdx] = e;
    ui.dirty = true; back();
  }
  function removeEx() { if (!confirm(S.delEx)) return; pDay().exercises.splice(ui.exIdx, 1); ui.dirty = true; back(); }
  // the rep-range picker: one bottom sheet, two steppers, preset chips
  function rangeOpen(j) { ui.pick = { kind: 'range', j: j, r: ui.ex.scheme.ranges[j].slice() }; renderRangePick(); }
  function renderRangePick() {
    var P = ui.pick, r = P.r;
    pickOpen(S.range(P.j + 1), '<div class="wk-rgp">' + stepper('rlo', r[0], S.min, 'wkRgLo') + stepper('rhi', r[1], S.max, 'wkRgHi') + '</div>'
      + '<div class="wk-lv-cap">' + S.presets + '</div><div class="wk-chips">' + W.RANGE_PRESETS.map(function (x) { return '<button class="wk-chip' + (x[0] === r[0] && x[1] === r[1] ? ' on' : '') + '" onclick="WorkoutLive.rangePreset(' + x[0] + ',' + x[1] + ')"><bdi dir="ltr">' + x[0] + '-' + x[1] + '</bdi></button>'; }).join('') + '</div>',
      '<button class="wk-big" onclick="WorkoutLive.rangeOk()">' + S.ok + '</button>', true);
  }
  function rangePreset(a, b) { ui.pick.r = [a, b]; renderRangePick(); }
  function rangeOk() { var P = ui.pick, sc = ui.ex.scheme; if (W.rangeValid(P.r)) { sc.ranges[P.j] = P.r; sc.type = 'custom'; } pickClose(); render(); }

  // ── the ready screen ──
  function readySet(k, v) {
    var R = ui.ready;
    if (k === 'program') { var p = programById(v), d = W.nextDay(p, sessions()); R.programId = p.id; R.dayId = R.nextId = d ? d.id : null; pickClose(); }
    else if (k === 'day') R.dayId = v;
    else if (k === 'warm') R.warmOpen = !R.warmOpen;
    else if (k === 'feelOpen') R.feelOpen = !R.feelOpen;
    else if (k === 'mode') { R.mode = v; R.modeTouched = true; }
    else if (k === 'sleep' || k === 'energy' || k === 'pain') { R.feel[k] = v; if (!R.modeTouched) R.mode = suggestMode(R.feel); }
    render();
  }
  // neutral: the mean of sleep, energy and (6 - pain) -> full / lighter / short; the owner can always pick another
  function suggestMode(f) { var v = []; if (f.sleep) v.push(f.sleep); if (f.energy) v.push(f.energy); if (f.pain) v.push(6 - f.pain); if (!v.length) return 'full'; var m = v.reduce(function (a, b) { return a + b; }, 0) / v.length; return m >= 3.5 ? 'full' : m >= 2.5 ? 'light' : 'short'; }
  function programPick(cb) {
    var st = store();
    pickOpen(S.programs, st.programs.map(function (p) { return row(h(p.name), cb + '(' + js(p.id) + ')', p.id === (ui.ready ? ui.ready.programId : st.activeId) ? 'on' : '', S.daysN(p.days.length) + ' · ' + T.goal[p.goal]); }).join('')
      + row(S.programs + ' ›', 'WorkoutLive.pickClose();WorkoutLive.programs()', 'wk-link'), '');
  }

  // ── steppers: data-k = what, data-d = direction; long-press repeats; only the value's text node changes ──
  var rep = { t: null, i: null };
  function stopRepeat() { clearTimeout(rep.t); clearInterval(rep.i); rep.t = rep.i = null; }
  function onPress(ev) {
    var b = ev.target.closest && ev.target.closest('[data-k]'); if (!b) return;
    ev.preventDefault(); stopRepeat();
    var k = b.getAttribute('data-k'), d = +b.getAttribute('data-d');
    b.classList.add('wk-pressed'); setTimeout(function () { b.classList.remove('wk-pressed'); }, 100);
    bump(k, d);
    rep.t = setTimeout(function () { rep.i = setInterval(function () { bump(k, d); }, 90); }, 400);
  }
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var txt = function (id, v) { var t = $(id); if (t) t.textContent = v; };
  function bump(k, d) {
    if (k === 'w' || k === 'r') {                                          // the active set (or the set being edited)
      var c = ui.editing || cur(), ex = state.exercises[c.ex];
      if (k === 'w') c.w = W.snap(Math.max(ex.step, (c.w || 0) + d * ex.step), ex.step); else c.r = clamp((c.r || 0) + d, 0, 99);
      txt('wkLvW', c.w); txt('wkLvR', c.r); return;
    }
    if (k === 'lk' || k === 'rlk') {                                       // the locker (summary / ready)
      var o = k === 'lk' ? ui : ui.ready, v = o.locker == null ? (d > 0 ? 1 : null) : o.locker + d;
      o.locker = v && v > 0 ? Math.min(999, v) : null; txt('wkLk', o.locker == null ? S.none : o.locker); return;
    }
    if (k === 'rlo' || k === 'rhi') { var P = ui.pick, r = k === 'rlo' ? W.clampRange(P.r[0] + d, P.r[1], 'lo') : W.clampRange(P.r[0], P.r[1] + d, 'hi'); P.r = r; txt('wkRgLo', r[0]); txt('wkRgHi', r[1]); document.querySelectorAll('#wkPickB .wk-chip').forEach(function (c) { c.classList.toggle('on', c.textContent === r[0] + '-' + r[1]); }); return; }
    var e = ui.ex; if (!e) return;
    if (k === 'step') { e.step = STEPS[clamp(STEPS.indexOf(e.step) + d, 0, STEPS.length - 1)]; txt('wkExStep', e.step); }
    else if (k === 'sw') { e.startW = W.snap(Math.max(e.step, (e.startW || 0) + d * e.step), e.step); txt('wkExSw', e.startW); }
    else if (k === 'sets') { e.scheme = W.setSets(e.scheme, e.scheme.sets + d); stopRepeat(); render(); }
  }

  // ── the current (active) set of the viewed exercise ──
  function targets(i) { var ex = state.exercises[i], l = lastOf(ex.label); return W.targetsFor(ex, l && l.sets, ex.sets, { scale: state.mode === 'light' ? 0.9 : 1 }); }
  function cur() {
    var i = ui.view, ex = state.exercises[i], slot = ex.sets.length, key = i + ':' + slot;
    if (!ui.pend[key]) { var t = targets(i), tg = t[Math.min(slot, t.length - 1)], prevSet = ex.sets[slot - 1]; ui.pend[key] = { ex: i, w: tg.w != null ? tg.w : (prevSet && prevSet.w) || null, r: tg.aim }; }
    return ui.pend[key];
  }
  function warmIdx() { for (var i = 0; i < state.exercises.length; i++) if (!isBw(state.exercises[i])) return i; return -1; }

  // ── live actions ──
  function logSet() {
    var now = performance.now(); if (ui.lastTap && now - ui.lastTap < 300) return; ui.lastTap = now;   // double tap guard (monotonic clock)
    var c = cur(), ex = state.exercises[c.ex];
    dispatch({ type: 'LOG_SET', ex: c.ex, w: isBw(ex) ? null : c.w, r: c.r });
    delete ui.extra[c.ex]; ui.view = state.exIdx; ui.chimed = 0;
    sound('tick'); render();
  }
  function undo() { if (!draft || draft.actions.length < 2) return; dispatch({ type: 'UNDO' }); ui.pend = {}; ui.view = Math.min(ui.view, state.exercises.length - 1); render(); }
  function view(i) { ui.view = i; ui.editing = null; render(); }
  function addSet() { ui.extra[ui.view] = 1; render(); }
  function skipEx() { dispatch({ type: 'SKIP_EXERCISE', ex: ui.view }); ui.view = state.exIdx; render(); }
  function editSet(i) { var x = state.exercises[ui.view].sets[i]; ui.editing = { ex: ui.view, i: i, w: x.w, r: x.r }; render(); }
  function saveEdit() { var e = ui.editing; dispatch({ type: 'EDIT_SET', ex: e.ex, i: e.i, w: e.w, r: e.r }); ui.editing = null; ui.pend = {}; render(); }
  function delSet() { var e = ui.editing; dispatch({ type: 'DELETE_SET', ex: e.ex, i: e.i }); ui.editing = null; ui.pend = {}; render(); }
  function cancelEdit() { ui.editing = null; render(); }
  function restAdj(d) { dispatch({ type: 'REST_ADJUST', delta: d }); renderDock(); tick(); }
  function restSkip() { dispatch({ type: 'REST_SKIP' }); renderDock(); }
  function warm(i, k) { var w = ui.warm[i] = ui.warm[i] || { open: false, done: {} }; if (k === 'toggle') w.open = !w.open; else if (k === 'skip') w.skip = true; else w.done[k] = !w.done[k]; render(); }
  // + exercise during the workout: a picker of known exercises (no typing inside the live screen)
  function addPick() {
    var seen = {}, list = [];
    store().programs.forEach(function (p) { p.days.forEach(function (d) { d.exercises.forEach(function (e) { var k = W.labelKey(e.label); if (!seen[k]) { seen[k] = 1; list.push(e); } }); }); });
    state.exercises.forEach(function (e) { seen[W.labelKey(e.label)] = 2; });
    pickOpen(S.pickEx, list.filter(function (e) { return seen[W.labelKey(e.label)] === 1; }).map(function (e, i) { ui['_add' + i] = e; return row(h(e.label), 'WorkoutLive.addEx(' + i + ')', '', T.equip[e.equip] || ''); }).join('') || '<div class="wk-lv-cap">' + S.noEx + '</div>', '');
  }
  function addEx(i) { var e = ui['_add' + i]; if (!e) return; dispatch({ type: 'ADD_EXERCISE', exercise: copy(e) }); pickClose(); ui.view = state.exIdx; render(); }
  function finishOpen() {
    var logged = state.exercises.some(function (e) { return e.sets.length; });
    if (!logged) { if (confirm(S.noSets)) { drop(KEY_D); draft = null; state = null; hide(); refreshAll(); } return; }
    ui.locker = state.locker; ui.exists = false; ui.err = ''; go('finish');
  }
  function effort(n) { ui.effort = n; render(); }
  function preview() {                                                   // the session as it would be stored, for the summary and the save
    var fin = W.reduce(state, { type: 'FINISH', at: Math.max(Date.now(), state.lastAt || 0), effort: ui.effort });
    var s = W.sessionFromLive(fin); s.locker = ui.locker; s.hash = W.hashOf(s); return s;
  }
  function saveWorkout(how) {
    // FINISH is applied in memory only: the draft stays until the session is really stored (no data loss if the app dies here)
    var s = preview(), all = sessions(), same = all.filter(function (x) { return x.date === s.date && x.type === s.type; });
    if (same.length && !how) { ui.exists = true; render(); return; }
    var now = new Date().toISOString(), rec = Object.assign({ id: uid('w'), createdAt: now, updatedAt: now, instanceId: null }, s);
    if (how === 'replace') { var idx = all.indexOf(same[0]); rec.id = same[0].id; rec.createdAt = same[0].createdAt || now; all[idx] = rec; }
    else all.push(rec);
    if (!put(KEY_S, all)) { ui.err = S.saveErr; render(); return; }
    // lastDay only on a program already stored in the days shape (an M1a-shaped store is never rewritten by a workout)
    var raw = load(KEY_P, null), rp = raw && (Array.isArray(raw) ? raw : raw.programs) || [], stored = rp.filter(function (x) { return x && x.id === s.programId; })[0];
    if (stored && Array.isArray(stored.days) && s.dayId) { var st = store(); st.programs.forEach(function (x) { if (x.id === s.programId) x.lastDay = s.dayId; }); saveStore(st); }
    drop(KEY_D); draft = null; state = null;
    hide(); if (window.Workout && $('wkSheet') && $('wkSheet').classList.contains('on')) window.Workout.close();
    refreshAll(); offerComplete(rec);
  }

  // ── after the workout: back home, ONE tap to mark the routine done (never un-complete) ──
  function todayWorkoutInstance() {
    var today = W.ymdIn(new Date()), out = null;
    allRoutines().filter(function (r) { return r.enabled !== false && r.kind === 'workout'; }).forEach(function (r) {
      (window.listRoutineInstances ? window.listRoutineInstances(r) : []).forEach(function (i) { if (!out && !i.skipped && !i.completed && W.ymdIn(new Date(i.dt)) === today) out = { routineId: String(r.id), dateStr: i.dt }; });
    });
    return out;
  }
  function isCompleted(rid, ds) { var r = routineOf(rid); return !!(r && (r.completedDates || []).indexOf(ds) > -1); }
  function offerComplete(rec) {
    var linked = rec.routineId && rec.dateStr && routineOf(rec.routineId), t = !linked && todayWorkoutInstance();
    if (linked && isCompleted(rec.routineId, rec.dateStr)) return;
    if (!linked && !t) return;
    prompt(linked ? S.markQ : S.attachQ, linked ? S.mark : S.attach, linked ? S.notNow : S.without, function () {
      var rid = linked ? rec.routineId : t.routineId, ds = linked ? rec.dateStr : t.dateStr;
      if (!linked) { var all = sessions(), x = all.filter(function (y) { return y.id === rec.id; })[0]; if (x) { x.routineId = rid; x.dateStr = ds; put(KEY_S, all); } }
      completeRoutine(rid, ds);
    });
  }
  function completeRoutine(rid, ds) {
    if (isCompleted(rid, ds)) return false;                               // never toggles a completed instance back
    var r = routineOf(rid); if (!r || typeof window.toggleRoutineComplete !== 'function') return false;
    window.toggleRoutineComplete(r.id, ds, { silent: true }); return true;
  }
  function prompt(q, yes, no, onYes) {
    var old = $('wkPrompt'); if (old) old.remove();
    var b = document.createElement('div'); b.id = 'wkPrompt'; b.className = 'wk-prompt'; b.dir = 'rtl';
    b.innerHTML = '<div class="wk-prompt-q">' + h(q) + '</div><div class="wk-prompt-a"><button class="wk-big" id="wkPromptYes">' + h(yes) + '</button><button class="wk-lv-link" id="wkPromptNo">' + h(no) + '</button></div>';
    document.body.appendChild(b);
    $('wkPromptYes').onclick = function () { b.remove(); onYes(); };
    $('wkPromptNo').onclick = function () { b.remove(); };
  }

  // ── the bottom picker ──
  function row(label, onclick, cls, sub) { return '<button class="wk-row ' + (cls || '') + '" onclick="' + onclick + '"><span class="wk-row-l">' + label + '</span>' + (sub ? '<span class="wk-row-s">' + sub + '</span>' : '') + (cls === 'on' ? '<span class="wk-row-c">✓</span>' : '') + '</button>'; }
  function pickOpen(title, body, foot, keep) {
    ensure(); if (!keep) ui.pick = ui.pick && ui.pick.kind === 'range' ? null : { kind: 'list' };
    $('wkPickT').innerHTML = title; $('wkPickB').innerHTML = body; $('wkPickF').innerHTML = foot || '';
    $('wkPick').classList.add('on'); lockPage();
  }
  function pickClose() { var p = $('wkPick'); if (p) p.classList.remove('on'); ui.pick = null; stopRepeat(); if (!isOpen()) unlockPage(); }

  // ── render: ONE function into the shell's containers ──
  var TITLES = { programs: function () { return S.programs; }, program: function () { return S.editProgram; }, exercise: function () { return S.exercise; }, ready: function () { return S.ready; } };
  function render() {
    if (!$('wkLive')) return;
    var name = $('wkLvName'), el = $('wkLvEl'), prog = $('wkLvProg'), main = $('wkLvMain');
    $('wkLive').setAttribute('data-mode', ui.mode);
    $('wkLvX').textContent = ui.stack.length ? '›' : '✕'; $('wkLvX').setAttribute('aria-label', ui.stack.length ? S.back : S.close);
    if (TITLES[ui.mode]) {
      name.textContent = TITLES[ui.mode](); el.textContent = ''; prog.innerHTML = '';
      main.innerHTML = ui.mode === 'programs' ? programsHtml() : ui.mode === 'program' ? programHtml() : ui.mode === 'exercise' ? exerciseHtml() : readyHtml();
      renderDock(); return;
    }
    name.innerHTML = h(state.program.name) + (state.locker != null ? '<span class="wk-lv-lk">' + h(S.lockerN(state.locker)) + '</span>' : '');
    prog.innerHTML = state.exercises.map(function (e, i) {
      var n = (e.scheme && e.scheme.sets) || 3, f = e.skipped ? 1 : Math.min(1, e.sets.length / n);
      return '<button class="wk-seg' + (i === ui.view ? ' on' : '') + (e.skipped ? ' skip' : '') + '" onclick="WorkoutLive.view(' + i + ')" aria-label="' + h(e.label) + '"><i style="width:' + Math.round(f * 100) + '%"></i></button>';
    }).join('');
    main.innerHTML = ui.mode === 'finish' ? finishHtml() : liveHtml();
    renderDock(); tick();
  }
  function chips(list, sel, fn, labels) { return '<div class="wk-chips">' + list.map(function (k) { return '<button class="wk-chip' + (sel === k ? ' on' : '') + '" onclick="' + fn(k) + '">' + labels[k] + '</button>'; }).join('') + '</div>'; }
  function stepper(k, val, unit, id, small) {
    return '<div class="wk-stp' + (small ? ' sm' : '') + '"><button class="wk-stp-b" data-k="' + k + '" data-d="-1" aria-label="−">−</button><div class="wk-stp-v"><bdi dir="ltr" id="' + id + '">' + h(val) + '</bdi>' + (unit ? '<span class="wk-stp-u">' + unit + '</span>' : '') + '</div><button class="wk-stp-b" data-k="' + k + '" data-d="1" aria-label="+">+</button></div>';
  }
  var line = function (label, ctl) { return '<div class="wk-lv-line"><span class="wk-lv-lbl">' + label + '</span>' + ctl + '</div>'; };
  var group = function (inner, title) { return (title ? '<div class="wk-grp-t">' + title + '</div>' : '') + '<div class="wk-lv-group">' + inner + '</div>'; };

  function programsHtml() {
    var st = store();
    if (!st.programs.length) return '<div class="wk-empty">' + S.noPrograms + '</div>';
    return group(st.programs.map(function (p) {
      var n = p.days.reduce(function (a, d) { return a + d.exercises.length; }, 0);
      return '<div class="wk-prow"><button class="wk-row" onclick="WorkoutLive.editProgram(' + js(p.id) + ')"><span class="wk-row-l">' + h(p.name) + '</span><span class="wk-row-s">' + S.daysN(p.days.length) + ' · ' + S.exN(n) + ' · ' + T.goal[p.goal] + (p.id === st.activeId ? ' · <b class="wk-on">' + S.active + '</b>' : '') + '</span></button>'
        + '<button class="wk-more" onclick="WorkoutLive.programMenu(' + js(p.id) + ')" aria-label="' + S.more + '">⋯</button></div>';
    }).join(''));
  }
  function programHtml() {
    var p = ui.prog, d = pDay();
    return group('<label class="wk-lv-cap" for="wkPName">' + S.progName + '</label><input class="rfi" id="wkPName" value="' + h(p.name) + '" oninput="WorkoutLive.setProgName(this.value)" enterkeyhint="done">'
        + '<div class="wk-lv-cap">' + S.goalT + '</div>' + chips(['strength', 'hypertrophy', 'general'], p.goal, function (k) { return 'WorkoutLive.setGoal(\'' + k + '\')'; }, T.goal))
      + '<div class="wk-grp-t">' + S.daysT + '</div><div class="wk-chips wk-days">' + p.days.map(function (x, i) { return '<button class="wk-chip wk-daychip' + (x === d ? ' on' : '') + '" onclick="WorkoutLive.selDay(' + i + ')">' + h(x.name) + '</button>'; }).join('') + '<button class="wk-chip wk-ghost" onclick="WorkoutLive.addDay()">' + S.addDay + '</button></div>'
      + group('<label class="wk-lv-cap" for="wkDName">' + S.dayName + '</label><input class="rfi" id="wkDName" value="' + h(d.name) + '" oninput="WorkoutLive.setDayName(this.value)" enterkeyhint="done">'
        + (d.exercises.length ? d.exercises.map(function (e, i) {
          return '<div class="wk-exrow"><div class="wk-mv"><button class="wk-mv-b" onclick="WorkoutLive.moveEx(' + i + ',-1)" aria-label="' + S.moveUp + '"' + (i ? '' : ' disabled') + '>⌃</button><button class="wk-mv-b" onclick="WorkoutLive.moveEx(' + i + ',1)" aria-label="' + S.moveDown + '"' + (i < d.exercises.length - 1 ? '' : ' disabled') + '>⌄</button></div>'
            + '<button class="wk-row" onclick="WorkoutLive.editEx(' + i + ')"><span class="wk-row-l">' + h(e.label) + '</span><span class="wk-row-s">' + (T.equip[e.equip] || '') + ' · ' + S.setsN + ' ' + num((e.scheme || {}).sets || 3) + ' · ' + rangesTxt(e.scheme || W.goalScheme(p.goal)) + '</span></button></div>';
        }).join('') : '<div class="wk-lv-cap">' + S.noEx + '</div>')
        + '<div class="wk-chips wk-row-acts"><button class="wk-chip" onclick="WorkoutLive.editEx(-1)">' + S.addEx + '</button>' + (p.days.length > 1 ? '<button class="wk-chip wk-ghost" onclick="WorkoutLive.removeDay()">' + S.removeDay + '</button>' : '') + '</div>');
  }
  function exerciseHtml() {
    var e = ui.ex, sc = e.scheme, u = e.unit === 'plates' ? T.unit.plates : T.unit.kg, hasW = !!e.unit;
    var uk = e.unit || 'none';
    return group('<label class="wk-lv-cap" for="wkExName">' + S.exName + '</label><input class="rfi" id="wkExName" value="' + h(e.label) + '" placeholder="' + S.newEx + '" oninput="WorkoutLive.exSet(\'label\',this.value)" enterkeyhint="done">'
        + (ui.err ? '<div class="wk-lv-warn">' + ui.err + '</div>' : ''))
      + group(chips(MUSCLES, e.muscle || 'other', function (k) { return 'WorkoutLive.exSet(\'muscle\',\'' + k + '\')'; }, T.muscle), S.muscleT)
      + group(chips(EQUIP_ORDER, e.equip, function (k) { return 'WorkoutLive.exSet(\'equip\',\'' + k + '\')'; }, T.equip)
        + '<div class="wk-lv-cap">' + S.unitT + '</div>' + chips(['kg', 'plates', 'none'], uk, function (k) { return 'WorkoutLive.exSet(\'unit\',\'' + k + '\')'; }, T.unitName)
        + (hasW ? line(S.step, stepper('step', e.step, u, 'wkExStep', 1)) + line(S.startW, stepper('sw', e.startW, u, 'wkExSw', 1)) : ''), S.equipT)
      + group(chips(['desc', 'straight', 'asc', 'custom'], sc.type || 'custom', function (k) { return 'WorkoutLive.exSet(\'scheme\',\'' + k + '\')'; }, T.scheme)
        + line(S.setsN, stepper('sets', sc.sets, '', 'wkExSets', 1))
        + sc.ranges.slice(0, sc.sets).map(function (r, j) { return '<button class="wk-row wk-rgrow" onclick="WorkoutLive.rangeOpen(' + j + ')"><span class="wk-row-l">' + S.setN(j + 1) + ' · <bdi dir="ltr">' + r[0] + '-' + r[1] + '</bdi></span><span class="wk-row-s">' + S.reps + ' ›</span></button>'; }).join(''), S.schemeT)
      + group(chips(RESTS.map(String), String(e.restSec || 0), function (k) { return 'WorkoutLive.exSet(\'restSec\',' + k + ')'; }, RESTS.reduce(function (o, s) { o[s] = s ? '<bdi dir="ltr">' + s + '</bdi> ' + S.sec : S.restAuto; return o; }, {})), S.restT)
      + group('<button class="wk-row" onclick="WorkoutLive.exSet(\'warmup\',' + !e.warmup + ')" role="switch" aria-checked="' + !!e.warmup + '"><span class="wk-row-l">' + S.warmOn + '</span><span class="wk-sw' + (e.warmup ? ' on' : '') + '"></span></button>', S.warmT)
      + (ui.exIdx > -1 ? '<button class="wk-lv-link wk-danger wk-center-link" onclick="WorkoutLive.removeEx()">' + S.removeEx + '</button>' : '');
  }
  function readyHtml() {
    var R = ui.ready, p = programById(R.programId), d = p.days.filter(function (x) { return x.id === R.dayId; })[0] || p.days[0];
    var wi = -1; d.exercises.some(function (e, i) { if (!isBw(e)) { wi = i; return true; } return false; });
    var wex = wi > -1 ? d.exercises[wi] : null, wl = wex && lastOf(wex.label), wt = wex && W.targetsFor(wex, wl && wl.sets, [], { scale: R.mode === 'light' ? 0.9 : 1 })[0], ws = wt ? W.warmupSets(wt.w, wex.step) : [];
    var feel = function (k) { return line(S[k], '<div class="wk-chips wk-five">' + [1, 2, 3, 4, 5].map(function (n) { return '<button class="wk-chip' + (R.feel[k] === n ? ' on' : '') + '" onclick="WorkoutLive.readySet(\'' + k + '\',' + n + ')">' + n + '</button>'; }).join('') + '</div>'); };
    return '<div class="wk-ready-h"><div class="wk-lv-title">' + h(d.name) + '</div><button class="wk-pill" onclick="WorkoutLive.programPick(\'WorkoutLive.readyProgram\')">' + h(p.name) + ' ▾</button></div>'
      + (p.days.length > 1 ? '<div class="wk-chips wk-days">' + p.days.map(function (x) { return '<button class="wk-chip' + (x.id === d.id ? ' on' : '') + '" onclick="WorkoutLive.readySet(\'day\',' + js(x.id) + ')">' + h(x.name) + (x.id === R.nextId ? ' · ' + S.next : '') + '</button>'; }).join('') + '</div>' : '')
      + '<div class="wk-lv-cap wk-exlist">' + d.exercises.map(function (e) { return h(e.label); }).join(' · ') + '</div>'
      + group(line(S.lockerT, stepper('rlk', R.locker == null ? S.none : R.locker, '', 'wkLk', 1)))
      + (ws.length ? group('<button class="wk-row" onclick="WorkoutLive.readySet(\'warm\')" aria-expanded="' + R.warmOpen + '"><span class="wk-row-l">' + S.warmPreview(ws.length) + '</span><span class="wk-row-s">' + h(wex.label) + ' ' + (R.warmOpen ? '▴' : '▾') + '</span></button>'
        + (R.warmOpen ? '<div class="wk-lv-cap">' + ws.map(function (x) { return '<bdi dir="ltr">' + x.w + ' × ' + x.r + '</bdi>'; }).join(' · ') + ' ' + unitTxt(wex) + '</div>' : '')) : '')
      + group('<button class="wk-row" onclick="WorkoutLive.readySet(\'feelOpen\')" aria-expanded="' + R.feelOpen + '"><span class="wk-row-l">' + S.feel + '</span><span class="wk-row-s">' + S.modes[R.mode] + ' ' + (R.feelOpen ? '▴' : '▾') + '</span></button>'
        + (R.feelOpen ? feel('sleep') + feel('energy') + feel('pain')
          + '<div class="wk-lv-cap">' + S.modeT + '</div>' + chips(['full', 'light', 'short'], R.mode, function (k) { return 'WorkoutLive.readySet(\'mode\',\'' + k + '\')'; }, S.modes)
          + '<div class="wk-lv-cap">' + S.modeHint[R.mode] + (Object.keys(R.feel).length && !R.modeTouched ? ' · ' + S.suggested : '') + '</div>' : ''));
  }
  function liveHtml() {
    var i = ui.view, ex = state.exercises[i], l = lastOf(ex.label), t = targets(i), u = unitTxt(ex), bw = isBw(ex);
    var n = Math.max((ex.scheme && ex.scheme.sets) || 3, ex.sets.length), active = !ex.skipped && (ex.sets.length < n || ui.extra[i]);
    var rows = ex.sets.map(function (x, k) {
      if (ui.editing && ui.editing.ex === i && ui.editing.i === k) {
        return '<div class="wk-lv-set edit"><div class="wk-lv-n">' + S.setN(k + 1) + ' · ' + S.edit + '</div><div class="wk-lv-steps">' + (bw ? '' : stepper('w', ui.editing.w, u, 'wkLvW')) + stepper('r', ui.editing.r, S.reps, 'wkLvR') + '</div>'
          + '<div class="wk-chips wk-center"><button class="wk-chip on" onclick="WorkoutLive.saveEdit()">' + S.keep + '</button><button class="wk-chip" onclick="WorkoutLive.delSet()">' + S.del + '</button><button class="wk-chip" onclick="WorkoutLive.cancelEdit()">' + S.cancel + '</button></div></div>';
      }
      var stt = W.rangeStatus(x.r, t[k] && t[k].range);
      return '<button class="wk-lv-set done" onclick="WorkoutLive.editSet(' + k + ')"><span class="wk-lv-n">' + S.setN(k + 1) + '</span><span class="wk-lv-v">' + setTxt(x) + '</span><span class="wk-lv-st ' + stt + '">' + S.st[stt] + '</span></button>';
    }).join('');
    var act = '';
    if (active && !ui.editing) {
      var c = cur(), tg = t[Math.min(ex.sets.length, t.length - 1)];
      act = '<div class="wk-lv-set active"><div class="wk-lv-n">' + S.setN(ex.sets.length + 1) + ' · ' + S.target + '</div>'
        + '<div class="wk-lv-target">' + (bw ? '' : num(tg.w) + '<span class="wk-lv-u">' + u + '</span><span class="wk-lv-x2">×</span>') + num(tg.range[0] + '-' + tg.range[1]) + (bw ? '<span class="wk-lv-u">' + S.reps + '</span>' : '') + '</div>'
        + '<div class="wk-lv-steps">' + (bw ? '' : stepper('w', c.w, u, 'wkLvW')) + stepper('r', c.r, S.reps, 'wkLvR') + '</div></div>';
    }
    var next = '';
    for (var k = ex.sets.length + (active ? 1 : 0); k < n && !ex.skipped; k++) next += '<div class="wk-lv-set next"><span class="wk-lv-n">' + S.setN(k + 1) + '</span><span class="wk-lv-v">' + (bw ? '' : num(t[k].w) + ' ' + u + ' × ') + num(t[k].range[0] + '-' + t[k].range[1]) + '</span></div>';
    // warm-up: the first weighted exercise or any marked one; collapsible, skippable, never counted
    var wu = '';
    if (!bw && !ex.sets.length && (ex.warmup || i === warmIdx())) {
      var w = ui.warm[i] || { open: false, done: {} }, first = t[0] && t[0].w, ws = W.warmupSets(first, ex.step);
      if (ws.length && !w.skip) wu = '<div class="wk-lv-group wk-warm"><button class="wk-row" onclick="WorkoutLive.warm(' + i + ',\'toggle\')" aria-expanded="' + w.open + '"><span class="wk-row-l">' + S.warmT + '</span><span class="wk-row-s">' + S.setsDone(ws.length) + ' ' + (w.open ? '▴' : '▾') + '</span></button>'
        + (w.open ? ws.map(function (x, j) { return '<button class="wk-lv-set wk-wset' + (w.done[j] ? ' ok' : '') + '" onclick="WorkoutLive.warm(' + i + ',' + j + ')" aria-pressed="' + !!w.done[j] + '"><span class="wk-lv-n">' + S.warmT + ' ' + (j + 1) + '</span><span class="wk-lv-v"><bdi dir="ltr">' + x.w + '×' + x.r + '</bdi></span><span class="wk-lv-st">' + (w.done[j] ? '✓' : '') + '</span></button>'; }).join('')
          + '<button class="wk-lv-link" onclick="WorkoutLive.warm(' + i + ',\'skip\')">' + S.warmSkip + '</button>' : '') + '</div>';
    }
    var allDone = state.exercises.every(exDone);
    return (ui.memOnly ? '<div class="wk-lv-warn">' + S.memFull + '</div>' : '') + (ui.wakeHint ? '<div class="wk-lv-cap wk-lv-hint">' + S.wake + '</div>' : '')
      + '<div class="wk-lv-ex"><div class="wk-lv-title">' + h(ex.label) + (ex.unit === 'kg' && ex.equip === 'dumbbell' ? '<span class="wk-lv-cap"> · ' + S.perHand + '</span>' : '') + '</div>'
      + '<div class="wk-lv-cap">' + (l ? S.lastTime + ': ' + l.sets.map(setTxt).join(' · ') : S.first) + '</div></div>'
      + wu + '<div class="wk-lv-group wk-lv-sets">' + rows + act + next + '</div>'
      + (allDone ? '<div class="wk-lv-cap wk-lv-center">' + S.allDone + '</div>' : '')
      + '<div class="wk-chips wk-lv-more">' + (!active && !ex.skipped ? '<button class="wk-chip" onclick="WorkoutLive.addSet()">' + S.addSet + '</button>' : '')
      + (!exDone(ex) ? '<button class="wk-chip" onclick="WorkoutLive.skipEx()">' + S.skipEx + '</button>' : '')
      + '<button class="wk-chip" onclick="WorkoutLive.addPick()">' + S.addExLive + '</button>'
      + (draft.actions.length > 1 ? '<button class="wk-chip" onclick="WorkoutLive.undo()">' + S.undo + '</button>' : '') + '</div>';
  }
  function cmpLine(ex) {
    var l = W.lastTimeBefore(sessions(), ex.label, W.ymdIn(new Date(state.startedAt))), a = ex.sets[0], b = l && l.sets[0], u = unitTxt(ex), d;
    if (!b) d = S.cmpFirst;
    else if (a.w != null && b.w != null && a.w !== b.w) d = S.cmpKg(W.snap(a.w - b.w, 0), u);
    else d = a.r === b.r ? S.cmpSame : S.cmpReps(a.r - b.r);
    return '<div class="wk-lv-cmp"><span class="wk-lv-cmp-l">' + h(ex.label) + '</span><span>' + S.setN(1) + ' ← ' + setTxt(a) + '</span><span class="wk-lv-cap">' + d + '</span></div>';
  }
  function coachLine(s, prs) {
    var hist = sessions(), last = W.sortRecent(hist.filter(function (x) { return x.programId === s.programId && (x.dayId || null) === (s.dayId || null) && x.date <= s.date; }))[0] || null;
    var kind = W.coachKind(s, prs, last), vars = { n: s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0) };
    if (kind === 'pr') { var p = prs[0]; vars.ex = h(p.label); vars.val = p.kind === 'e1rm' ? '~' + num(p.value) + ' ' + T.unit.kg : num(p.r) + ' ' + S.reps; }
    if (kind === 'up') (s.exercises || []).some(function (e) {
      var lx = (last.exercises || []).filter(function (x) { return W.labelKey(x.label) === W.labelKey(e.label); })[0], a = e.sets[0], b = lx && lx.sets[0]; if (!a || !b) return false;
      if ((a.w || 0) > (b.w || 0)) { vars.ex = h(e.label); vars.delta = num('+' + W.snap(a.w - b.w, 0)) + ' ' + (e.unit === 'plates' ? T.unit.plates : T.unit.kg); return true; }
      if ((a.w || 0) === (b.w || 0) && a.r > b.r) { vars.ex = h(e.label); vars.delta = S.cmpReps(a.r - b.r); return true; }
      return false;
    });
    var prev = load(KEY_COACH, {}) || {}, pk = W.pick(T.coach[kind], s.startedAt || s.date + kind, prev.kind === kind ? prev.i : -1);
    ui.coachPick = { kind: kind, i: pk.i };
    return W.fill(pk.text, vars);
  }
  function finishHtml() {
    var s = preview(), done = state.exercises.filter(function (e) { return e.sets.length; }), n = done.reduce(function (a, e) { return a + e.sets.length; }, 0);
    var prs = W.prsFor(s, sessions());
    return '<div class="wk-lv-ex"><div class="wk-lv-title">' + S.sumT + '</div><div class="wk-lv-cap">' + S.duration + ' ' + num(clock(W.durationSec(state, Date.now()))) + ' · ' + S.setsDone(n) + '</div></div>'
      + '<div class="wk-coach">' + coachLine(s, prs) + '</div>'
      + (prs.length ? group(prs.map(function (p) { return '<div class="wk-lv-cmp"><span class="wk-pr">★</span><span>' + (p.kind === 'e1rm' ? S.prE(h(p.label), num(p.value)) : S.prR(h(p.label), p.w == null ? null : num(p.w), num(p.r), T.unit.kg)) + '</span></div>'; }).join('')
        + (prs.some(function (p) { return p.kind === 'e1rm'; }) ? '<div class="wk-lv-cap">' + S.estimate + '</div>' : ''), S.prsT) : '')
      + group(done.map(cmpLine).join(''))
      + group('<div class="wk-lv-cap">' + S.effort + '</div><div class="wk-chips wk-five wk-eff">' + [1, 2, 3, 4, 5].map(function (k) { return '<button class="wk-chip' + (ui.effort === k ? ' on' : '') + '" onclick="WorkoutLive.effort(' + k + ')">' + k + '</button>'; }).join('') + '</div>'
        + line(S.lockerT, stepper('lk', ui.locker == null ? S.none : ui.locker, '', 'wkLk', 1)))
      + (ui.exists ? '<div class="wk-lv-warn">' + S.existsQ + '</div>' : '') + (ui.err ? '<div class="wk-lv-warn">' + ui.err + '</div>' : '');
  }
  // the footer: ONE primary action per screen (+ at most one quiet link)
  function renderDock() {
    var d = $('wkLvDock'); if (!d) return;
    var big = function (label, fn, dis) { return '<button class="wk-big" onclick="' + fn + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>'; };
    var link = function (label, fn) { return '<button class="wk-lv-link" onclick="' + fn + '">' + label + '</button>'; };
    if (ui.mode === 'programs') { d.innerHTML = big(S.newProgram, 'WorkoutLive.templatesPick()'); return; }
    if (ui.mode === 'program') { d.innerHTML = big(S.save, 'WorkoutLive.saveProgram()'); return; }
    if (ui.mode === 'exercise') { d.innerHTML = big(S.saveEx, 'WorkoutLive.saveEx()'); return; }
    if (ui.mode === 'ready') { var R = ui.ready, p = programById(R.programId), dd = p && p.days.filter(function (x) { return x.id === R.dayId; })[0]; d.innerHTML = big(S.start, 'WorkoutLive.begin()', !dd || !dd.exercises.length); return; }
    if (ui.mode === 'finish') { d.innerHTML = ui.exists ? big(S.replace, 'WorkoutLive.saveWorkout(\'replace\')') + link(S.both, 'WorkoutLive.saveWorkout(\'both\')') : big(S.saveW, 'WorkoutLive.saveWorkout()') + link(S.backLive, 'WorkoutLive.backToLive()'); return; }
    var ex = state.exercises[ui.view], resting = state.rest && state.rest.endsAt > Date.now(), allDone = state.exercises.every(exDone);
    var active = ex && !ex.skipped && (ex.sets.length < Math.max((ex.scheme && ex.scheme.sets) || 3, ex.sets.length) || ui.extra[ui.view]) && !ui.editing;
    var main = resting
      ? '<div class="wk-rest"><button class="wk-rest-b" onclick="WorkoutLive.restAdj(-15)">−15</button><div class="wk-ring"><svg class="focus-ring-svg" viewBox="0 0 200 200"><circle class="focus-ring-bg" cx="100" cy="100" r="88"/><circle class="focus-ring-progress" id="wkRing" cx="100" cy="100" r="88"/></svg><div class="wk-ring-t"><bdi dir="ltr" id="wkRestT"></bdi><span>' + S.rest + '</span></div></div><button class="wk-rest-b" onclick="WorkoutLive.restAdj(15)">+15</button></div><div class="wk-dock-links">' + link(S.skipRest, 'WorkoutLive.restSkip()') + link(S.finish, 'WorkoutLive.finishOpen()') + '</div>'
      : active ? '<button class="wk-done" onclick="WorkoutLive.logSet()" aria-label="' + S.doneLbl + '">' + S.done + '</button>' + link(S.finish, 'WorkoutLive.finishOpen()')
      : allDone ? big(S.finish, 'WorkoutLive.finishOpen()') : link(S.finish, 'WorkoutLive.finishOpen()');
    d.innerHTML = main;
  }
  function backToLive() { go('live'); }

  // ── timers: ONE 1-second interval while visible; only text nodes change ──
  function tick() {
    if (!state || !$('wkLive') || (ui.mode !== 'live' && ui.mode !== 'finish')) return;
    var now = Date.now(); txt('wkLvEl', clock(W.durationSec(state, now)));
    var r = state.rest, t = $('wkRestT');
    if (r && t) {
      var left = Math.max(0, (r.endsAt - now) / 1000), ring = $('wkRing');
      t.textContent = clock(Math.ceil(left));
      if (ring) ring.style.strokeDashoffset = (RING * (1 - left / Math.max(1, r.total))).toFixed(1);
      if (left <= 0 && ui.chimed !== r.endsAt) { ui.chimed = r.endsAt; sound('chime'); renderDock(); }
    }
  }
  function startTimer() { stopTimer(); if (document.visibilityState !== 'hidden') timer = setInterval(tick, 1000); tick(); }
  function stopTimer() { clearInterval(timer); timer = null; }
  document.addEventListener('visibilitychange', function () {
    if (!isOpen()) return;
    if (document.visibilityState === 'visible') { startTimer(); if (ui.mode === 'live') { renderDock(); acquireWake(); } tick(); } else stopTimer();
  });

  // ── wake lock (feature-detected) + one-time hint ──
  function acquireWake() {
    if (navigator.wakeLock && navigator.wakeLock.request) { navigator.wakeLock.request('screen').then(function (l) { wake = l; }).catch(function () { }); return; }
    try { if (!localStorage.getItem(KEY_HINT)) { ui.wakeHint = true; localStorage.setItem(KEY_HINT, '1'); } } catch (_) { }
  }
  function releaseWake() { try { if (wake) wake.release(); } catch (_) { } wake = null; ui.wakeHint = false; }

  // ── sound: resumed on the Start tap; a tick per set, a soft chime at rest end; no vibration ──
  var actx = null;
  function audio(resume) {
    try { if (!actx) actx = window.getAudioCtx ? window.getAudioCtx() : new (window.AudioContext || window.webkitAudioContext)(); if (resume && actx.state === 'suspended') actx.resume(); } catch (_) { actx = null; }
    return actx;
  }
  function sound(kind) {
    var c = audio(false); if (!c) return;
    try {
      (kind === 'tick' ? [[1320, 0, 0.05, 0.08]] : [[660, 0, 0.18, 0.16], [880, 0.16, 0.34, 0.14]]).forEach(function (n) {
        var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + n[1];
        o.type = 'sine'; o.frequency.value = n[0]; o.connect(g); g.connect(c.destination);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n[3], t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + n[2] + 0.12);
        o.start(t); o.stop(c.currentTime + n[2] + 0.15);
      });
    } catch (_) { }
  }

  // ── resume banner (app open) and the sheet line ──
  function resumeLine(where) {
    var r = enabled() && readDraft(); if (!r) return '';
    return '<div class="wk-resume-in"><span>🏋️ ' + S.open + '</span><span class="wk-chips">'
      + (isStale(r) ? '<button class="wk-chip on" onclick="WorkoutLive.saveOld()">' + S.saveOld + '</button><button class="wk-chip" onclick="WorkoutLive.delOld()">' + S.delOld + '</button>'
        : '<button class="wk-chip on" onclick="Workout.start()">' + S.resume + '</button>' + (where === 'banner' ? '<button class="wk-chip" onclick="WorkoutLive.hideBanner()" aria-label="' + S.close + '">✕</button>' : '')) + '</span></div>';
  }
  function banner() {
    hideBanner();
    var html = resumeLine('banner'); if (!html || !document.body) return;
    var b = document.createElement('div'); b.id = 'wkResume'; b.className = 'wk-resume'; b.dir = 'rtl'; b.innerHTML = html; document.body.appendChild(b);
  }
  function hideBanner() { var b = $('wkResume'); if (b) b.remove(); }
  function saveOld() { var r = readDraft(); if (!r) return; draft = r.d; state = r.s; ui.effort = null; ui.locker = state.locker; ui.exists = false; ui.err = ''; hideBanner(); ui.stack = []; ui.mode = 'finish'; show(); }
  function delOld() { if (!confirm(S.delConfirm)) return; drop(KEY_D); hideBanner(); var s = $('wkSheet'); if (s && s.classList.contains('on') && window.Workout) window.Workout.open(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
  // the audio context is created (suspended) in idle time, so a tap only resumes it (creating it costs ~50 ms)
  (window.requestIdleCallback || function (f) { return setTimeout(f, 1500); })(function () { if (enabled()) audio(false); });

  // ── WorkoutHome: the HOME card of a workout routine (null = the regular card renders, byte-identical) ──
  var C = T.card;
  function programFor(r) { return programById(r && r.programId || null); }
  function card(inst, r) {
    if (!enabled() || !r || r.kind !== 'workout' || !inst || !inst.datetime) return null;
    var now = Date.now(), dft = readDraft(), mine = dft && String(dft.s.routineId) === String(r.id) && dft.s.dateStr === inst.dateStr;
    var st = W.cardState({ now: now, dt: inst.datetime, completed: inst.completed, inProgress: mine, unlockMin: r.wkUnlockMin });
    if (!st) return null;
    var p = programFor(r), all = sessions(), d = p ? W.nextDay(p, all) : null, dt = new Date(inst.datetime);
    var time = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: W.TZ });
    var dayName = mine ? dft.s.dayName || dft.s.program.name : d ? d.name : r.name || '';
    var done = st === 'done' ? W.sortRecent(all.filter(function (s) { return String(s.routineId) === String(r.id) && s.dateStr === inst.dateStr; }))[0] : null;
    var vars = { day: h(dayName), time: num(time), days: num(W.daysBetween(W.ymdIn(new Date(now)), W.ymdIn(dt))) };
    if (st === 'progress') { var sets = dft.s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0); vars.elapsed = '<bdi dir="ltr" data-wk-el="' + dft.s.startedAt + '">' + elMin(now - dft.s.startedAt) + '</bdi> ' + S.minutes('').trim(); vars.n = num(sets + 1); }
    if (done) { vars.duration = num(mins(done.durationSec)); vars.n = num(done.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0)); }
    else if (st === 'done') { vars.duration = ''; vars.n = ''; }
    var seed = r.id + '|' + inst.dateStr + '|' + st, head = W.fill(W.pick(C[st], seed).text, vars);
    if (st === 'done' && !done) head = h(r.name || dayName) + ' · ✓';
    // ONE data line from history
    var data = '';
    if (st === 'done' && done) { var prs = W.prsFor(done, all.filter(function (s) { return s.id !== done.id && s.date <= done.date; })); if (prs[0]) data = C.pr(prs[0].kind === 'e1rm' ? h(prs[0].label) + ' ~' + num(prs[0].value) + ' ' + T.unit.kg : h(prs[0].label) + ' ' + num(prs[0].r) + ' ' + S.reps); }
    else if (st !== 'done' && st !== 'progress' && st !== 'far') {
      var ex = d && d.exercises.filter(function (e) { var l = lastOf(e.label); return l && l.sets.length; })[0], l = ex && lastOf(ex.label);
      data = l ? W.fill(W.pick(C.last, seed).text, { ex: h(ex.label), set: setTxt(l.sets[0]) }) : W.fill(W.pick(C.first, seed).text, { day: h(dayName) });
    }
    var arg = js({ routineId: String(r.id), dateStr: inst.dateStr, programId: p ? p.id : null }), go = 'event.stopPropagation();Workout.start(' + arg + ')';
    var cd = st === 'locked' ? '<div class="wk-card-cd">🔒 ' + C.unlocks + ' <bdi dir="ltr" data-wk-cd="' + (dt.getTime() - (r.wkUnlockMin == null ? 30 : r.wkUnlockMin) * 60000) + '">' + hms((dt.getTime() - (r.wkUnlockMin == null ? 30 : r.wkUnlockMin) * 60000 - now) / 1000) + '</bdi>'
      + '<button class="wk-card-link" onclick="' + go + '">' + C.openNow + '</button></div>' : '';
    var btn = st === 'tomorrow' ? '<button class="wk-card-btn ghost" onclick="' + go + '">' + C.prepare + '</button>'
      : st === 'open' ? '<button class="wk-card-btn primary" onclick="' + go + '">' + C.start + '</button>'
      : st === 'progress' ? '<button class="wk-card-btn primary" onclick="' + go + '">' + C.resume + '</button>' : '';
    var sec = st !== 'done' && st !== 'progress' ? '<div class="wk-card-sec"><button class="wk-card-link" onclick="event.stopPropagation();openPostpone(\'routine\',' + js(String(r.id)) + ',' + js(inst.dateStr) + ')">' + C.postpone + '</button>'
      + '<button class="wk-card-link" onclick="event.stopPropagation();skipRoutineInstance(' + js(String(r.id)) + ',' + js(inst.dateStr) + ')">' + C.skip + '</button></div>' : '';
    setTimeout(ensureTicker, 0);
    return '<div class="wk-card wk-st-' + st + '" data-wk-state="' + st + '" onclick="Workout.start(' + arg + ')">'
      + '<div class="wk-card-top"><span class="wk-card-tag">🏋️ ' + h(r.name || '') + '</span><span class="wk-card-time">' + num(time) + '</span></div>'
      + '<div class="wk-card-h">' + head + '</div>' + (data ? '<div class="wk-card-d">' + data + '</div>' : '') + cd + btn + sec + '</div>';
  }
  // the countdown / elapsed text nodes; a state change (unlock) re-renders HOME once
  var homeTimer = null, rerendered = 0;
  function ensureTicker() { if (!homeTimer && document.querySelector('[data-wk-cd],[data-wk-el]')) homeTimer = setInterval(homeTick, 1000); }
  function homeTick() {
    var cds = document.querySelectorAll('[data-wk-cd]'), els = document.querySelectorAll('[data-wk-el]');
    if (!cds.length && !els.length) { clearInterval(homeTimer); homeTimer = null; return; }
    if (document.visibilityState === 'hidden') return;
    var now = Date.now(), due = false;
    cds.forEach(function (n) { var left = (+n.getAttribute('data-wk-cd') - now) / 1000; if (left <= 0) due = true; else n.textContent = hms(left); });
    els.forEach(function (n) { n.textContent = elMin(now - +n.getAttribute('data-wk-el')); });
    if (due && now - rerendered > 5000) { rerendered = now; try { window.render(); } catch (_) { } }
  }
  // one extra line in the greeting area on a workout day
  function greeting(subEl) {
    var old = $('wkGreet'); if (old) old.remove();
    if (!enabled() || !subEl) return;
    var t = todayWorkoutInstance(); if (!t) return;
    var r = routineOf(t.routineId), st = W.cardState({ now: Date.now(), dt: t.dateStr, unlockMin: r && r.wkUnlockMin });
    var time = new Date(t.dateStr).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: W.TZ });
    var el = document.createElement('div'); el.id = 'wkGreet'; el.className = 'greeting-sub wk-greet';
    el.innerHTML = '🏋️ ' + (st === 'open' ? C.greetOpen : C.greetToday(num(time)));
    subEl.parentNode.insertBefore(el, subEl.nextSibling);
  }
  // the assistant: "התחל אימון" / "מה האימון הבא" (code-first; nothing goes to the model)
  function assistant(text) {
    var t = String(text || '').trim();
    var isStart = /^(?:אלפרד[,\s]*)?(?:בוא\s+)?(?:ת?תחיל|התחל|נתחיל|פתח|תפתח)\s+(?:את\s+ה|ה)?אימון/.test(t), isNext = /^(?:אלפרד[,\s]*)?מה\s+(?:ה)?אימון\s+(?:ה)?(?:בא|הבא)\??$/.test(t);
    if (!isStart && !isNext) return null;
    if (!enabled()) return { say: S.asstOff };
    var st = store();
    if (isStart) return { say: st.programs.length ? S.asstStart : S.asstNone, go: function () { var i = todayWorkoutInstance(); start(i || {}); } };
    if (!st.programs.length) return { say: S.asstNone, go: function () { openPrograms(); } };
    var i = todayWorkoutInstance(), r = i && routineOf(i.routineId), p = programById(r && r.programId || null), d = W.nextDay(p, sessions());
    var when = i ? S.asstWhen(new Date(i.dateStr).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: W.TZ })) : '';
    return { say: S.asstNext(d ? d.name : '', p.name, when) };
  }

  // ── WorkoutForm: the routine edit — "סוג: [רגיל] [אימון]" and, for a workout, the program pill ──
  var form = { kind: 'regular', programId: null };
  function formFill(prefill) {
    form.kind = prefill && prefill.kind === 'workout' ? 'workout' : 'regular'; form.programId = prefill && prefill.programId || null;
    var host = $('rText') && $('rText').closest('.rfield'); if (!host || !enabled()) { var o = $('wkKindField'); if (o) o.remove(); return; }
    var f = $('wkKindField');
    if (!f) { f = document.createElement('div'); f.className = 'rfield'; f.id = 'wkKindField'; host.parentNode.insertBefore(f, host.nextSibling); }
    formRender();
  }
  function formRender() {
    var f = $('wkKindField'); if (!f) return;
    var p = form.kind === 'workout' ? programById(form.programId) : null;
    f.innerHTML = '<div class="rform-lbl">' + S.kindT + '</div><div class="rwindow-grid">' + ['regular', 'workout'].map(function (k) { return '<button type="button" class="wk-chip wk-kind' + (form.kind === k ? ' on' : '') + '" onclick="WorkoutForm.kind(\'' + k + '\')">' + S.kinds[k] + '</button>'; }).join('') + '</div>'
      + (form.kind === 'workout' ? '<div class="wk-form-pill"><button type="button" class="wk-pill" onclick="WorkoutForm.pick()">' + (p ? h(p.name) : S.chooseTemplate) + ' ▾</button></div>' : '');
  }
  function formKind(k) { form.kind = k; if (k === 'workout' && !form.programId) { var st = store(); form.programId = st.activeId; } formRender(); }
  function formPick() {
    var st = store();
    if (!st.programs.length) { ui.after = 'form'; openPrograms('form'); return; }
    pickOpen(S.programs, st.programs.map(function (p) { return row(h(p.name), 'WorkoutForm.choose(' + js(p.id) + ')', p.id === form.programId ? 'on' : '', S.daysN(p.days.length) + ' · ' + T.goal[p.goal]); }).join('')
      + row(S.programs + ' ›', 'WorkoutLive.pickClose();WorkoutLive.programs(\'form\')', 'wk-link'), '');
  }
  function formChoose(id) { form.programId = id; pickClose(); formRender(); }
  function formApply(routine, existing) {                                // called by saveRoutine: optional fields only; absent = regular
    if (!$('wkKindField')) { if (existing) ['kind', 'programId', 'wkUnlockMin'].forEach(function (k) { if (existing[k] != null) routine[k] = existing[k]; }); return; }
    if (form.kind === 'workout') { routine.kind = 'workout'; routine.programId = form.programId || store().activeId || null; }
    if (existing && existing.wkUnlockMin != null) routine.wkUnlockMin = existing.wkUnlockMin;
  }

  window.WorkoutLive = { enabled: enabled, hasDraft: hasDraft, resumeLine: resumeLine, start: start, close: close, programs: openPrograms,
    templatesPick: templatesPick, useTemplate: useTemplate, programMenu: programMenu, setActive: setActive, dupProgram: dupProgram, delProgram: delProgram,
    editProgram: editProgram, setProgName: setProgName, setGoal: setGoal, selDay: selDay, addDay: addDay, setDayName: setDayName, removeDay: removeDay, moveEx: moveEx, saveProgram: saveProgram,
    editEx: editEx, exSet: exSet, saveEx: saveEx, removeEx: removeEx, rangeOpen: rangeOpen, rangePreset: rangePreset, rangeOk: rangeOk,
    readySet: readySet, readyProgram: function (id) { readySet('program', id); }, programPick: programPick, begin: begin,
    view: view, logSet: logSet, undo: undo, addSet: addSet, skipEx: skipEx, editSet: editSet, saveEdit: saveEdit, delSet: delSet, cancelEdit: cancelEdit,
    restAdj: restAdj, restSkip: restSkip, warm: warm, addPick: addPick, addEx: addEx, finishOpen: finishOpen, effort: effort, saveWorkout: saveWorkout, backToLive: backToLive,
    saveOld: saveOld, delOld: delOld, hideBanner: hideBanner, pickClose: pickClose, completeRoutine: completeRoutine, suggestMode: suggestMode,
    state: function () { return state ? copy(state) : null; }, mode: function () { return isOpen() ? ui.mode : null; } };
  window.WorkoutHome = { card: card, greeting: greeting, assistant: assistant, tick: homeTick };
  window.WorkoutForm = { fill: formFill, apply: formApply, kind: formKind, pick: formPick, choose: formChoose };
})();
