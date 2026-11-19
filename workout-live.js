// WorkoutLive: every full-screen workout view (programs, program / exercise editors, ready, live, summary) in ONE shell (#wkLive:
// fixed header, a scroll area only inside the content, a fixed footer with the ONE primary action), the bottom picker (#wkPick),
// the HOME card of workout routines (WorkoutHome) and the routine-form hooks (WorkoutForm). Pure logic + every string: workout-core.js.
// State of a workout = an action log replayed by WCore.replay; vt_wk_draft is saved after EVERY action, so a killed app resumes.
// Storage (all OPTIONAL keys): vt_wk_programs, vt_wk_draft, vt_wk_coach; a finished workout is appended to vt_wk_sessions.
// Kill switch: vt_wk_off = '1'. Routines: only the optional kind / programId fields, and a silent completion when the owner taps it.
(function () {
  'use strict';
  var W = window.WCore, T = W.TEXT, S = T.ui;
  var KEY_P = 'vt_wk_programs', KEY_D = 'vt_wk_draft', KEY_S = 'vt_wk_sessions', KEY_OFF = 'vt_wk_off', KEY_HINT = 'vt_wk_wakehint', KEY_COACH = 'vt_wk_coach', KEY_C = 'vt_wk_catalog', KEY_PREFS = 'vt_wk_prefs';
  var STALE_MS = 6 * 3600e3, RING = 552.92;
  var MUSCLE_ICON = { chest: '◆', back: '▲', shoulders: '●', biceps: '◗', triceps: '◖', legs: '▼', core: '■', other: '○' };   // restrained glyphs, tinted by CSS
  var EQUIP_ORDER = ['dumbbell', 'barbell', 'machine', 'cable', 'bodyweight'], MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'other'];
  var START_W = { dumbbell: 10, barbell: 20, machine: 4, cable: 15, bodyweight: null }, STEPS = [0.5, 1, 1.25, 2, 2.5, 5], RESTS = [0, 60, 90, 120, 150, 180];
  var $ = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n) { return '<bdi dir="ltr">' + h(n) + '</bdi>'; };
  var setTxt = function (x) { return '<bdi dir="ltr">' + h(W.setText(x)) + '</bdi>'; };          // "28×6", combined "28×6+5"
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

  // ── writes: READ-MODIFY-WRITE only (WCore.updateJSON re-reads the stored value; an in-memory copy is never saved).
  // During a TEST run the catalog / program edits are queued instead (applied only if the owner confirms at the end).
  var testQ = null;                                                     // [{key, fn}] while a test workout runs
  function patch(key, def, fn) {
    if (testQ && (key === KEY_C || key === KEY_P)) { testQ.push({ key: key, fn: fn }); return true; }
    return W.updateJSON(localStorage, key, def, fn) != null;
  }
  function normCat(c) { c = c && typeof c === 'object' ? c : {}; c.aliases = c.aliases || {}; c.variants = c.variants || {}; c.notes = c.notes || {}; return c; }
  function patchCat(fn) { return patch(KEY_C, {}, function (c) { c = normCat(c); fn(c); return c; }); }
  function patchStore(fn) { return patch(KEY_P, {}, function (raw) { var st = W.readPrograms(raw); fn(st); return { v: 2, activeId: st.activeId, programs: st.programs }; }); }
  function queued(key, v) { (testQ || []).forEach(function (q) { if (q.key === key) v = q.fn(v) || v; }); return v; }

  // ── prefs (vt_wk_prefs, optional): coach mode, sound, tactile tick, test mode — the owner's choices ──
  function prefs() { return W.readPrefs(load(KEY_PREFS, null)); }
  function setPref(k, v) { W.updateJSON(localStorage, KEY_PREFS, {}, function (p) { p[k] = v; return p; }); }
  var CO = window.WkCoach, CP = window.WkCopy;                            // the two copy tables (wk-coach.js, wk-copy.js)
  function curMode() { var m = draft && draft.prefs && draft.prefs.coachMode; return W.COACH_MODES.indexOf(m) > -1 ? m : prefs().coachMode; }

  // ── the catalog (vt_wk_catalog): per exercise {muscle, unit, step}; per group variants[] and ONE note. Read fresh, written on the owner's edit only ──
  function cat() { var c = normCat(load(KEY_C, null)); return testQ ? normCat(queued(KEY_C, c)) : c; }
  function es(ex) { return W.effStep(ex, cat()); }                        // the step in use: the owner's choice, else the program's
  var muscleName = function (m) { return T.muscle[m] || T.muscle.other; };

  // ── programs ──
  function store() { var raw = load(KEY_P, null); return W.readPrograms(testQ ? queued(KEY_P, raw) : raw); }
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
  function hasDraft() { var r = enabled() && readDraft(); return !!r && !r.s.test; }   // a TEST draft is never offered as a real workout
  function hasTestDraft() { var r = enabled() && readDraft(); return !!r && !!r.s.test; }
  function isStale(d) { return Date.now() - Math.max(d.s.startedAt || 0, d.s.lastAt || 0) > STALE_MS; }
  function dispatch(a) {
    a.at = a.at || Date.now();
    if (a.type === 'UNDO') { if (draft.actions.length > 1) draft.actions.pop(); }
    else draft.actions.push(a);
    state = W.replay(draft.actions);
    saveDraft();
  }
  // read-modify-write on vt_wk_draft: never overwrite a DIFFERENT workout's draft (another tab / window started one)
  function saveDraft() {
    var mine = draft, clash = false;
    var ok = W.updateJSON(localStorage, KEY_D, {}, function (cur) {
      if (cur && Array.isArray(cur.actions) && cur.startedAt && cur.startedAt !== mine.startedAt) { clash = true; return cur; }
      return mine;
    });
    ui.memOnly = !ok || clash;                                           // keep working in memory; the warning line says so
  }

  // ── UI state (not persisted) ──
  var ui = { noteEdits: {}, peek: {}, mode: 'live', stack: [], view: 0, pend: {}, extra: {}, editing: null, memOnly: false, effort: null, locker: null, exists: false, err: '',
    chimed: 0, wakeHint: false, lastTap: 0, warm: {}, prog: null, dirty: false, dayIdx: 0, ex: null, exIdx: -1, ctx: null, ready: null, pick: null, after: null,
    coachAt: -1e9, coachLast: {}, coachSeen: {}, coachLine: null, restTouched: 0, fired: {}, soundOk: false };
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
    // ONLY while the keyboard is up: iOS standalone reports a visual viewport that stops at the safe area, so following it
    // always left a 34 px strip under the screen (HOME's bottom nav peeked through) + a doubled bottom gap
    var kb = window.innerHeight - vv.height > 120;
    if (kb) { el.style.setProperty('--wk-vh', Math.round(vv.height) + 'px'); el.style.setProperty('--wk-top', Math.round(vv.offsetTop) + 'px'); }
    else { el.style.removeProperty('--wk-vh'); el.style.removeProperty('--wk-top'); }
    var pk = $('wkPick');                                                 // the picker (keypad, notes) rides above the keyboard
    if (pk) { pk.style.setProperty('--wk-kb', Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) + 'px'); pk.style.setProperty('--wk-pk-vh', Math.round(vv.height) + 'px'); }
  }
  function ensure() {
    if ($('wkLive')) return;
    var el = document.createElement('div');
    el.id = 'wkLive'; el.className = 'wk-live'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.dir = 'rtl';
    el.innerHTML = '<div class="wk-lv-head"><button class="wk-lv-x" id="wkLvX" onclick="WorkoutLive.close()" aria-label="' + S.close + '">✕</button><div class="wk-lv-name" id="wkLvName"></div>'
      + '<div class="wk-lv-hr"><div class="wk-lv-el" id="wkLvEl" dir="ltr"></div></div></div>'
      // the coach slot: ALWAYS reserved in the live screen (a line appearing moves nothing), non-blocking, tap to dismiss
      // ONE scrolling column (coach slot + progress + content); the bar below is the only fixed part
      + '<div class="wk-lv-scroll" id="wkLvScroll"><div class="wk-coach-slot" id="wkCoachSlot" aria-live="polite"><div class="wk-mascot" id="wkMascot"></div><button class="wk-coach-line" id="wkCoachLine" onclick="WorkoutLive.coachHide()" tabindex="-1"></button></div>'
      + '<div class="wk-lv-prog" id="wkLvProg"></div><div class="wk-lv-main" id="wkLvMain"></div></div><div class="wk-lv-dock" id="wkLvDock"></div>'
      + '<label class="wk-hap" id="wkHapL" aria-hidden="true"><input type="checkbox" switch id="wkHap" tabindex="-1"></label>';
    document.body.appendChild(el);
    var pk = document.createElement('div');
    pk.id = 'wkPick'; pk.className = 'wk-pick'; pk.dir = 'rtl';
    pk.innerHTML = '<div class="wk-pick-bg" onclick="WorkoutLive.pickClose()"></div><div class="wk-pick-card" role="dialog" aria-modal="true"><div class="wk-pick-h"><span id="wkPickT"></span><button class="wk-lv-x" onclick="WorkoutLive.pickClose()" aria-label="' + S.close + '">✕</button></div><div class="wk-pick-b" id="wkPickB"></div><div class="wk-pick-f" id="wkPickF"></div></div>';
    document.body.appendChild(pk);
    [el, pk].forEach(function (x) { x.addEventListener('pointerdown', onPress); x.addEventListener('pointerdown', touched, true); });
    el.addEventListener('pointerdown', mascotLook, true); afterPaint(mascotMount);   // never inside the tap that opens the screen
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
  function go(mode) { ui.mode = mode; var m = $('wkLvScroll'); render(); if (m) m.scrollTop = 0; }
  function push(mode) { ui.stack.push(ui.mode); go(mode); }
  function back() { var m = ui.stack.pop(); if (m) go(m); else { hide(); refreshAll(); } }
  function refreshAll() { var s = $('wkSheet'); if (s && s.classList.contains('on') && window.Workout) window.Workout.open(); try { if (window.render) window.render(); } catch (_) { } banner(); }

  // ── THE single entry: HOME card, sheet button, assistant ──
  function start(o) {
    o = o || {};
    if (!enabled()) return;
    audio(true);
    var r = readDraft();
    // a real draft always resumes (never lose a real workout); a TEST draft resumes only from the test button, a real start drops it
    if (r && r.s.test && !o.test) { drop(KEY_D); r = null; }
    // a TEST start never silently resumes a REAL open workout: the owner chooses
    if (r && !r.s.test && o.test) { openConflict(r); return; }
    if (r) { draft = r.d; state = r.s; testQ = state.test ? [] : null; ui.view = state.exIdx; ui.pend = {}; ui.extra = {}; ui.editing = null; ui.stack = []; ui.mode = 'live'; ui.coachSeen = { start: true }; acquireWake(); hideBanner(); show(); return; }
    // completed = locked: a done instance (or one with a saved live session) refuses a new start; a TEST run is never blocked
    if (!o.test) {
      var lock = lockFor(o);
      if (lock.blocked) { say(lock.line); return; }
      if (lock.inst) o = Object.assign({}, o, lock.inst);
    }
    ui.ctx = { routineId: o.test || o.routineId == null ? null : String(o.routineId), dateStr: o.test ? null : o.dateStr || null, programId: o.programId || null, test: !!o.test, warm: !!o.warm };
    if (!store().programs.length) { ui.after = 'ready'; ui.stack = []; ui.mode = 'programs'; show(); return; }
    openReady();
  }
  // {blocked, line} for an explicit instance; without one (sheet / assistant): today's workout instances — all done -> blocked,
  // otherwise the first open one is used (so the session links to it); no workout routine today -> a free session
  function lockFor(o) {
    var all = sessions();
    if (o.routineId != null && o.dateStr) return W.startBlock({ routine: routineOf(o.routineId), dateStr: o.dateStr, sessions: all }) ? { blocked: true, line: S.locked } : {};
    var today = todayInstances(); if (!today.length) return {};
    var open = today.filter(function (i) { return !W.startBlock({ routine: routineOf(i.routineId), dateStr: i.dateStr, sessions: all }); })[0];
    return open ? { inst: open } : { blocked: true, line: S.lockedSheet };
  }
  function say(line) { try { if (typeof toast === 'function') toast(line); } catch (_) { } }
  function routineOf(id) { try { return allRoutines().filter(function (r) { return String(r.id) === String(id); })[0] || null; } catch (_) { return null; } }
  function openReady() {
    var c = ui.ctx || {}, r = c.routineId ? routineOf(c.routineId) : null;
    var p = programById(c.programId || (r && r.programId) || null); if (!p) { ui.mode = 'programs'; show(); return; }
    var d = W.nextDay(p, sessions()), prev = W.sortRecent(sessions()).filter(function (s) { return s.programId === p.id && s.locker != null; })[0];
    ui.ready = { programId: p.id, dayId: d ? d.id : null, nextId: d ? d.id : null, locker: prev ? prev.locker : null, warmOpen: !!c.warm, feelOpen: false, feel: {}, mode: 'full', modeTouched: false, coachMode: prefs().coachMode };
    ui.stack = []; ui.mode = 'ready'; show();
    if (c.warm) setTimeout(readyWarm, 0);   // A10: the card's "או התחל בחימום" opens ready focused on the warm-up — the same path as the notification warm action
  }
  function begin() {
    var R = ui.ready, p = programById(R.programId), d = p && p.days.filter(function (x) { return x.id === R.dayId; })[0];
    if (!d || !d.exercises.length) return;
    var c = ui.ctx || {};
    // v2 (combined sets); readDraft replays any version. The coach mode travels in the draft so a resume keeps it.
    draft = { v: W.DRAFT_V, startedAt: Date.now(), actions: [], prefs: { coachMode: R.coachMode || prefs().coachMode }, test: !!c.test };
    testQ = c.test ? [] : null;
    dispatch({ type: 'START', at: draft.startedAt, locker: R.locker, program: { id: p.id, name: p.days.length > 1 ? p.name + ' · ' + d.name : p.name, exercises: copy(d.exercises) },
      dayId: d.id, dayName: d.name, routineId: c.routineId, dateStr: c.dateStr, goal: p.goal, mode: R.mode, test: c.test ? true : null, coachMode: draft.prefs.coachMode });
    ui.view = 0; ui.pend = {}; ui.extra = {}; ui.editing = null; ui.effort = null; ui.exists = false; ui.err = ''; ui.chimed = 0; ui.warm = {}; ui.stack = [];
    ui.coachSeen = {}; ui.coachLast = {}; ui.coachAt = -1e9; ui.coachLine = null; ui.fired = {}; ui.restTouched = 0;
    acquireWake(); hideBanner(); go('live');
    coachStart();
  }
  // ── the live coach: ONE line in the reserved slot; mode "off" = no lines (the set-row marks stay) ──
  // the slot is NEVER empty during a workout: the latest coach line stays until the next event or the next set's arrival;
  // without one (no line yet, dismissed, mode off, a filler held back) it shows the next target
  function coachShow(text, kind) {
    var b = $('wkCoachLine'); if (!b || !text) return;
    ui.coachLine = { text: text, kind: kind }; b.textContent = text; b.className = 'wk-coach-line on k-' + kind;
  }
  function coachFallback() {
    var b = $('wkCoachLine'); if (!b) return;
    var t = state && !state.finished && ui.mode === 'live' ? nextTargetText() : '';
    if (!t) { b.className = 'wk-coach-line'; b.textContent = ''; return; }
    b.textContent = S.nextSet(nextTargetIso()); b.className = 'wk-coach-line on fb';
  }
  function coachHide() { ui.coachLine = null; coachFallback(); }          // tap = dismiss -> the next-target line
  function coachSlot() { if (ui.coachLine) coachShow(ui.coachLine.text, ui.coachLine.kind); else coachFallback(); }
  function coachSay(m) {
    if (!m || curMode() === 'off' || !CO) { coachSlot(); return; }
    var now = performance.now();
    if (!W.coachAllowed(m.kind, now, ui.coachAt)) { coachSlot(); return; }   // a filler held back: the slot keeps what it shows
    var r;
    if (m.kind === 'comebackGap' || m.kind === 'comebackPostponed') {          // from the copy table (mode-independent)
      var all = (CP && CP.COPY.coach[m.kind]) || [], ok = W.fillable(all, m.vars); if (!ok.length) { coachSlot(); return; }
      var p = CP.pick(ok, ok.indexOf(all[ui.coachLast[m.kind]])); r = { text: CP.fill(p.text, m.vars), index: all.indexOf(p.text) };
    } else r = CO.line(curMode(), m.kind, m.vars, ui.coachLast[m.kind] == null ? -1 : ui.coachLast[m.kind]);
    if (!r.text || r.text === (ui.coachLine && ui.coachLine.text)) { coachSlot(); return; }   // no fillable line: keep the slot as is
    ui.coachLast[m.kind] = r.index; if (m.kind === 'halfway') ui.coachSeen.halfway = true;
    if (!W.EVENT_KINDS[m.kind]) ui.coachAt = now;                           // only fillers count against the 20 s budget
    coachShow(r.text, m.kind); mascotReact(m.kind, r.text);
  }
  // ── the mascot (wk-mascot.js): Alfred beside the coach line. A gesture on a NEW line only (never on a re-render);
  // the text always stays in the slot (its own bubble is hidden: the slot is never emptied by a timer) ──
  var mascot = null, pvM = null, pvSeq = 0, pvAfter = null, mPending = null;
  // the mascot is built AFTER the frame that shows the tap's result (next frame + a short task), so it never delays that paint;
  // its box (52 / 56 px) is reserved by CSS, so a late mount moves nothing
  function afterPaint(fn) { var go = function () { setTimeout(fn, 34); }; if (window.requestAnimationFrame) requestAnimationFrame(go); else go(); }
  var MOOD = { start: 'start', exceed: 'exceed', met: 'met', under: 'under', pr: 'pr', rest: 'wake', halfway: 'nudge', lastSet: 'nudge', comebackGap: 'wake', comebackPostponed: 'wake' };
  function mascotMode(k) { k = k || curMode(); return k === 'off' ? 'calm' : k; }
  function mascotMount() {
    var el = $('wkMascot'); if (!el || mascot || !window.WkMascot) return;
    try { mascot = window.WkMascot.mount(el, { mode: mascotMode(), onTap: function () { coachSlot(); } }); } catch (_) { mascot = null; }
    if (state && ui.mode === 'live') mascotSync();
    if (mPending) { var q = mPending; mPending = null; mascotReact(q.kind, q.text); }   // the line that arrived before he did (the start line)
  }
  function mascotReact(kind, text) { if (!mascot) { mPending = { kind: kind, text: text }; return; } try { mascot.say(text, { mood: MOOD[kind] || 'idle', ms: 1 }); } catch (_) { } }
  function mascotLook(ev) {
    var m = $('wkMascot'); if (!mascot || !m || ui.mode !== 'live' || m.contains(ev.target)) return;
    var r = m.getBoundingClientRect(); try { mascot.look((ev.clientX - r.left - r.width / 2) / 180, (ev.clientY - r.top - r.height / 2) / 320, 1400); } catch (_) { }
  }
  function mascotSync() {
    var s = $('wkCoachSlot'); if (s) s.classList.toggle('wk-m-off', curMode() === 'off');
    if (!mascot || !state) return;
    if (mascot.cur !== mascotMode()) { mascot.cur = mascotMode(); try { mascot.mode(mascot.cur); } catch (_) { } }   // a resume keeps the draft's mode
    var pl = 0, dn = 0; state.exercises.forEach(function (e) { var n = (e.scheme && e.scheme.sets) || 3; pl += e.skipped ? e.sets.length || 1 : Math.max(n, e.sets.length); dn += e.skipped ? e.sets.length || 1 : e.sets.length; });
    try { mascot.progress(pl ? dn / pl : 0); } catch (_) { }
  }
  // the mascot during a rest, every motion = information: he breathes WITH the ring (a slow 4 s in / 4 s out guide), looks at the
  // next target as the rest starts, and beats once on each of the last 3 seconds; back to his normal breath when the rest ends
  function mascotRest(r, now) {
    if (!mascot || ui.mode !== 'live') return;
    var resting = !!(r && r.endsAt > now), left = resting ? Math.ceil((r.endsAt - now) / 1000) : 0;
    if (resting !== !!ui.mBreath) { ui.mBreath = resting; try { mascot.breathe(resting); } catch (_) { } }
    if (resting && ui.mRestFor !== r.endsAt) { ui.mRestFor = r.endsAt; ui.mCount = 0; setTimeout(function () { try { if (mascot && state && state.rest && state.rest.endsAt === r.endsAt) mascot.look(0, 1, 2600); } catch (_) { } }, 1300); }
    if (resting && left >= 1 && left <= 3 && ui.mCount !== left) { ui.mCount = left; try { mascot.set('count'); } catch (_) { } }
  }
  // the REST character: 96 px in its fixed reserved slot (CLS 0); lazy, breathes with the ring; one instance reused
  var restM = null;
  function restMount() {
    var el = $('wkRestChar'); if (!el) { restKill(); return; }
    if (el.firstChild) { try { if (restM) restM.breathe(true); } catch (_) { } return; }
    afterPaint(function () { var e = $('wkRestChar'); if (!e || e.firstChild || !window.WkMascot) return; try { restM = window.WkMascot.mount(e, { mode: mascotMode() }); restM.breathe(true); } catch (_) { restM = null; } });
  }
  function restKill() { if (restM) { try { restM.destroy(); } catch (_) { } restM = null; } }
  // the summary stage: 120 px beside the hero; ONE gesture per workout (a record -> pr, else finish), lazy (after the paint)
  var sumM = null;
  function sumMount() {
    if (sumM) { try { sumM.destroy(); } catch (_) { } sumM = null; }
    var started = state && state.startedAt;
    afterPaint(function () {
      var el = $('wkMascotSum'); if (!el || el.firstChild || ui.mode !== 'finish' || !state || state.startedAt !== started || !window.WkMascot) return;
      try { sumM = window.WkMascot.mount(el, { mode: mascotMode() }); } catch (_) { sumM = null; return; }
      if (ui.sumPlayed !== started) { ui.sumPlayed = started; var pr = W.prsFor(preview(), sessions()).length; try { sumM.set(pr ? 'pr' : 'finish'); } catch (_) { } }
    });
  }
  function sumKill() { if (sumM) { try { sumM.destroy(); } catch (_) { } sumM = null; } }
  // a mode sample: the first line of that mode the user's data needs nothing for
  function modeSample(k) { var L = CO && CO.MODES[k] && CO.MODES[k].met; return (L || []).filter(function (t) { return t.indexOf('{') < 0; })[0] || modeHint(k); }
  // the ready screen's preview: the mascot in the chosen mode + its sample line (re-mounted on each render; none when "off")
  function pvMount() {
    pvKill(); var seq = pvSeq;
    afterPaint(function () {
      var el = $('wkMascotPv'), R = ui.ready; if (seq !== pvSeq || ui.mode !== 'ready' || !el || el.firstChild || !window.WkMascot || !R || R.coachMode === 'off') return;   // a newer render won
      try { pvM = window.WkMascot.mount(el, { mode: R.coachMode }); } catch (_) { pvM = null; }
      if (pvM && pvAfter) { var k = pvAfter; pvAfter = null; try { pvM.say(modeSample(k), { mood: k === 'fire' ? 'exceed' : 'met', ms: 1 }); } catch (_) { } }
    });
  }
  function pvKill() { pvSeq++; if (pvM) try { pvM.destroy(); } catch (_) { } pvM = null; }
  // a mode change previews itself: the gesture in the new feel + that mode's own rest-end chime
  function modePreview(k) {
    if (k === 'off') return;
    var m = ui.mode === 'ready' ? pvM : mascot;
    if (!m && ui.mode === 'ready') pvAfter = k;                             // he is mounting right after this render: play it then
    if (m) try { m.mode(k); m.say(modeSample(k), { mood: k === 'fire' ? 'exceed' : 'met', ms: 1 }); } catch (_) { }
    sound('rest', true, k);
  }
  // ARRIVAL at the next set (the rest ended or was skipped): the event line yields to lastSet / halfway / the rest line, or the fallback
  function coachArrive(withRest) {
    if (!state) return;
    var m = W.pickMoment([W.arrivalMoment(state, ui.coachSeen), withRest ? { kind: 'rest', vars: nextTargetText() ? { target: nextTargetIso() } : {} } : null]);
    ui.coachLine = null;
    if (m) coachSay(m); else coachFallback();
  }
  function coachStart() {
    if (!state) return;
    var last = W.sortRecent(sessions().filter(function (s) { return s.programId === state.program.id; }))[0];
    var gap = last && W.daysBetween(last.date, W.ymdIn(new Date())) > 10;   // back after more than 10 days
    ui.coachSeen.start = false;
    var t0 = targets(0)[0], m = gap ? { kind: 'comebackGap', vars: {} } : W.coachMoment(state, { atStart: true, firstTarget: t0 ? { w: t0.w, r: t0.aim } : null, seen: ui.coachSeen });
    coachSay(m); ui.coachSeen.start = true;
  }
  var loggedSets = function (s) { return s ? s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0) : 0; };
  function openConflict(r) {
    ensure(); ui.pick = { kind: 'conflict' };
    pickOpen(S.openReal, '<div class="wk-lv-cap">' + S.openRealSub(h(r.s.program.name), num(loggedSets(r.s))) + '</div>'
      + row(S.openResume, 'WorkoutLive.conflict(\'resume\')') + row(S.openFinish, 'WorkoutLive.conflict(\'finish\')')
      + row(S.openDelete, 'WorkoutLive.conflict(\'delete\')', 'wk-danger') + row(S.cancel, 'WorkoutLive.conflict(\'cancel\')'), '', true);
  }
  function conflict(k) {
    var r = readDraft(); pickClose(); if (!r || k === 'cancel') return;
    if (k === 'resume') { start({}); return; }
    if (k === 'finish') { draft = r.d; state = r.s; testQ = null; ui.locker = state.locker; ui.effort = null; ui.exists = false; ui.err = ''; hideBanner(); ui.stack = []; ui.mode = 'finish'; show(); return; }
    if (k === 'delete' && confirm(S.cancelWorkoutQ(loggedSets(r.s)))) { drop(KEY_D); draft = null; state = null; hideBanner(); start({ test: true }); }
  }
  // "בטל אימון (ללא שמירה)": the open workout is deleted; the confirm says exactly what is lost
  function cancelWorkout() {
    if (!state) return;
    if (!confirm(S.cancelWorkoutQ(loggedSets(state)))) return;
    pickClose(); drop(KEY_D); draft = null; state = null; testQ = null; hide(); refreshAll();
  }
  function touched() { if (state && state.rest && Date.now() >= state.rest.endsAt) ui.restTouched = state.rest.endsAt; }   // a tap after the rest ends stops the alerts
  function close() {
    if (ui.pick) { pickClose(); return; }
    if (ui.mode === 'program' && ui.dirty && !confirm(S.discard)) return;
    if (ui.mode === 'finish') { go('live'); return; }
    if (ui.mode === 'live') {
      var logged = state && state.exercises.some(function (e) { return e.sets.length; });
      if (state && state.test) { if (logged && !confirm(S.leave)) return; if (!logged) { drop(KEY_D); draft = null; state = null; testQ = null; } hide(); refreshAll(); return; }
      if (logged) { if (!confirm(S.leave)) return; }
      else { drop(KEY_D); draft = null; state = null; }
      restPushCancel(); hide(); refreshAll(); return;   // B6: leaving/discarding the workout cancels the rest-end push
    }
    if (ui.mode === 'programs' && ui.after === 'ready') { ui.after = null; hide(); refreshAll(); return; }
    back();
  }

  // ── programs screen ──
  function openPrograms(after) { ui.after = after || null; ui.stack = []; ui.mode = 'programs'; show(); }
  function useTemplate(kind) {
    var p = template(kind); patchStore(function (st) { st.programs.push(p); st.activeId = p.id; }); pickClose();
    if (ui.after === 'form') { ui.after = null; form.programId = p.id; hide(); formRender(); return; }
    if (ui.after === 'ready') { ui.after = null; ui.ctx = ui.ctx || {}; ui.ctx.programId = p.id; openReady(); return; }
    editProgram(p.id);
  }
  function programMenu(id) {
    var st = store(), p = st.programs.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    pickOpen(h(p.name), [st.activeId !== id ? row(S.makeActive, 'WorkoutLive.setActive(' + js(id) + ')') : '', row(S.duplicate, 'WorkoutLive.dupProgram(' + js(id) + ')'), row(S.del, 'WorkoutLive.delProgram(' + js(id) + ')', 'wk-danger')].join(''), '');
  }
  function setActive(id) { patchStore(function (st) { st.activeId = id; }); pickClose(); render(); }
  function dupProgram(id) {
    patchStore(function (st) { var src = st.programs.filter(function (x) { return x.id === id; })[0]; if (!src) return; var p = copy(src); p.id = uid('p'); p.name = S.copyOf(p.name); p.lastDay = null; p.days.forEach(function (d) { d.id = uid('d'); d.exercises.forEach(function (e) { e.id = uid('e'); }); }); st.programs.push(p); });
    pickClose(); render();
  }
  function delProgram(id) { if (!confirm(S.delProgram)) return; patchStore(function (st) { st.programs = st.programs.filter(function (x) { return x.id !== id; }); if (st.activeId === id) st.activeId = st.programs[0] ? st.programs[0].id : null; }); pickClose(); render(); }
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
    patchStore(function (st) {                                            // only THIS program is replaced; the rest is re-read
      var i = st.programs.map(function (x) { return x.id; }).indexOf(p.id), keep = i > -1 ? st.programs[i].lastDay : null;
      var np = copy(p); if (i > -1) { np.lastDay = keep || np.lastDay; st.programs[i] = np; } else st.programs.push(np);
      if (!st.activeId) st.activeId = p.id;
    });
    ui.dirty = false; back();
  }

  // ── exercise editor ──
  function editEx(i) { var d = pDay(); ui.exIdx = i; ui.noteEdits = {}; ui.ex = i < 0 ? mkEx('', 'dumbbell', null, ui.prog.goal) : copy(d.exercises[i]); if (!ui.ex.scheme) ui.ex.scheme = W.goalScheme(ui.prog.goal); ui.err = ''; push('exercise'); }
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
    var ks = Object.keys(ui.noteEdits);                                   // group notes are catalog data: saved with the exercise
    if (ks.length) { var edits = copy(ui.noteEdits); patchCat(function (cc) { Object.keys(edits).forEach(function (m) { var v = String(edits[m] || '').trim(); if (v) cc.notes[m] = v; else delete cc.notes[m]; }); }); }
    ui.dirty = true; back();
  }
  function exNote(v) { ui.noteEdits[W.muscleKey(ui.ex, cat())] = v; }
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
    else if (k === 'exOpen') R.exOpen = !R.exOpen;
    else if (k === 'checksOpen') R.checksOpen = !R.checksOpen;
    else if (k === 'mode') { R.mode = v; R.modeTouched = true; }
    else if (k === 'coach') { R.coachMode = v; setPref('coachMode', v); }
    else if (k === 'sleep' || k === 'energy' || k === 'pain') { R.feel[k] = v; if (!R.modeTouched) R.mode = suggestMode(R.feel); }
    render(); if (k === 'coach') modePreview(v);
  }
  // labels: the coach modes from wk-coach.js (+ "כבוי"); the day modes full / lighter from wk-copy.js; "short" stays ours (2 sets, not 20 min)
  function modeLabels() { var o = {}; W.COACH_MODES.forEach(function (k) { o[k] = k === 'off' ? S.coachOff : (CO && CO.MODES[k] ? CO.MODES[k].label : k); }); return o; }
  function modeHint(k) { return k === 'off' ? S.coachOffHint : CO && CO.MODES[k] ? CO.MODES[k].hint : ''; }
  function dayModes() { return { full: CP ? CP.COPY.label.readinessFull : S.modes.full, light: CP ? CP.COPY.label.readinessLight : S.modes.light, short: S.modes.short }; }
  function soundTest() { audio(true); sound('rest', true); setPref('soundTested', true); ui.soundOk = true; var e = $('wkSoundHint'); if (e) e.textContent = S.soundOk + ' · ' + S.soundHint; }
  // the live header menu: coach mode, sound, the tactile tick (the draft keeps the mode for a resume)
  function menuOpen() {
    var p = prefs(), m = curMode(), ex = state && state.exercises[ui.view];
    ui.pick = { kind: 'menu' };
    var act = function (icon, label, fn, cls) { return '<button class="wk-row wk-act' + (cls ? ' ' + cls : '') + '" onclick="' + fn + '"><span class="wk-act-i" aria-hidden="true">' + icon + '</span><span class="wk-row-l">' + label + '</span></button>'; };
    pickOpen(h(state ? state.program.name : S.options), (state ? '<div class="wk-lv-cap wk-menu-sub">' + S.options + (state.locker != null ? ' · ' + h(S.lockerN(state.locker)) : '') + '</div>' : '') + (ex ? (!ex.sets.length && !ex.skipped ? act('⇄', S.swapEx, 'WorkoutLive.swapOpen()') : '') + act('✎', S.noteEdit, 'WorkoutLive.noteOpen()')
        + (!exDone(ex) ? act('⤼', S.skipEx, 'WorkoutLive.pickClose();WorkoutLive.skipEx()') : '') + act('＋', S.addExMenu, 'WorkoutLive.addPick()')
        + act('⚑', S.finishHere, 'WorkoutLive.finishAsk()') + act('✕', S.cancelWorkout, 'WorkoutLive.cancelWorkout()', 'wk-danger') : '')
      + '<div class="wk-grp-t">' + S.menuT + '</div><div class="wk-lv-cap">' + S.coachModeT + '</div>' + chips(W.COACH_MODES, m, function (k) { return 'WorkoutLive.setMode(\'' + k + '\')'; }, modeLabels())
      + '<div class="wk-lv-cap">' + h(modeHint(m)) + '</div>'
      + '<button class="wk-row" onclick="WorkoutLive.togglePref(\'sound\')" role="switch" aria-checked="' + p.sound + '"><span class="wk-row-l">' + S.soundT + '</span><span class="wk-sw' + (p.sound ? ' on' : '') + '"></span></button>'
      + '<button class="wk-row" onclick="WorkoutLive.togglePref(\'haptic\')" role="switch" aria-checked="' + p.haptic + '"><span class="wk-row-l">' + S.hapticT + '</span><span class="wk-sw' + (p.haptic ? ' on' : '') + '"></span></button>'
      + checksHtml() + silentRow(p), '', true);
  }
  // the two checks (sound + touch), each with an honest hint: the phone decides, not the app
  function checksHtml() {
    return '<div class="wk-sound-row"><button class="wk-chip" onclick="WorkoutLive.soundTest()">🔊 ' + S.soundTest + '</button><button class="wk-chip" onclick="WorkoutLive.hapticTest()">📳 ' + S.hapticTest + '</button></div>'
      + '<div class="wk-lv-cap" id="wkSoundHint">' + (ui.soundOk ? S.soundOk + ' · ' : '') + S.soundHint + '</div><div class="wk-lv-cap" id="wkHapHint" hidden>' + S.hapticHint + '</div>';
  }
  // the silent-switch EXPERIMENT (navigator.audioSession, Safari 16.4+): only where the API exists, opt-in, off by default
  function silentRow(p) {
    if (!navigator.audioSession) return '';
    return '<button class="wk-row" onclick="WorkoutLive.togglePref(\'silent\')" role="switch" aria-checked="' + p.silent + '"><span class="wk-row-l">' + S.silentT + '</span><span class="wk-sw' + (p.silent ? ' on' : '') + '"></span></button><div class="wk-lv-cap">' + S.silentHint + '</div>';
  }
  function hapticTest() {
    try { var l = $('wkHapL'); if (l) l.click(); } catch (_) { }
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) { }
    var e = $('wkHapHint'); if (e) e.hidden = false;
  }
  // "סיים אימון כאן": says exactly how much was done; a partial run is saved as partial, or dropped without saving
  function finishAsk() {
    ui.pick = { kind: 'finish' };
    var p = W.exProgress(state), link = function (l, fn, cls) { return '<button class="wk-lv-link wk-center-link' + (cls ? ' ' + cls : '') + '" onclick="' + fn + '">' + l + '</button>'; };
    var body = '<div class="wk-lv-cap wk-ask">' + S.exDoneOf(num(p.done), num(p.total)) + ' · ' + S.setsLogged(p.sets) + '</div>';
    var foot = !p.sets ? link(S.discardW, 'WorkoutLive.cancelWorkout()', 'wk-danger') + link(S.keepGoing, 'WorkoutLive.pickClose()')
      : p.partial ? '<button class="wk-big" onclick="WorkoutLive.pickClose();WorkoutLive.finishOpen()">' + S.savePartial + '</button>' + link(S.discardW, 'WorkoutLive.cancelWorkout()', 'wk-danger') + link(S.keepGoing, 'WorkoutLive.pickClose()')
      : '<button class="wk-big" onclick="WorkoutLive.pickClose();WorkoutLive.finishOpen()">' + S.finish + '</button>' + link(S.keepGoing, 'WorkoutLive.pickClose()');
    pickOpen(S.finishHere, body, foot, true);
  }
  function setMode(k) { setPref('coachMode', k); if (draft) { draft.prefs = Object.assign({}, draft.prefs, { coachMode: k }); saveDraft(); } if (k === 'off') coachHide(); menuOpen(); mascotSync(); modePreview(k); }
  function togglePref(k) { setPref(k, !prefs()[k]); menuOpen(); }
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
    if (k === 'w' || k === 'r') {                                          // the active set / its current part (or the set being edited)
      var c = ui.editing || cur(), ex = state.exercises[c.ex];
      if (k === 'w') c.w = W.addStep(c.w, es(ex), d); else c.r = clamp((c.r || 0) + d, 0, 99);   // +- the step, no snapping
      txt('wkLvW', c.w); txt('wkLvR', c.r); if (!ui.editing) { txt('wkHeroW', c.w); txt('wkHeroR', c.r); } if (c.parts && c.parts.length) txt('wkParts', partsTxt(c)); return;
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
  function targets(i) { var ex = state.exercises[i], l = lastOf(ex.label); return W.targetsFor(Object.assign({}, ex, { step: es(ex) }), l && l.sets, ex.sets, { scale: state.mode === 'light' ? 0.9 : 1 }); }
  // a combined set in progress: c.parts = the parts already done ({w, r}), c.w / c.r = the current part
  var partsTxt = function (c) { return c.parts.concat([{ w: c.w, r: c.r }]).map(function (p, i) { return (i && p.w !== c.parts[0].w && p.w != null ? p.w + '×' : '') + p.r; }).join(' + '); };
  function cur() {
    var i = ui.view, ex = state.exercises[i], slot = ex.sets.length, key = i + ':' + slot;
    if (!ui.pend[key]) { var t = targets(i), tg = t[Math.min(slot, t.length - 1)], prevSet = ex.sets[slot - 1]; ui.pend[key] = { ex: i, w: tg.w != null ? tg.w : (prevSet && prevSet.w) || null, r: tg.aim }; }
    return ui.pend[key];
  }

  // ── live actions ──
  function logSet(then) {
    var now = performance.now(); if (ui.lastTap && now - ui.lastTap < 300) return; ui.lastTap = now;   // double tap guard (monotonic clock)
    var c = cur(), ex = state.exercises[c.ex], bw = isBw(ex), slot = ex.sets.length, ts = targets(c.ex), tg = ts[Math.min(slot, ts.length - 1)];
    if (c.parts && c.parts.length) {                                      // "6+5": the set weight = the first part's; a lighter later part = a drop set
      var all = c.parts.concat([{ w: c.w, r: c.r }]), w0 = bw ? null : all[0].w;
      dispatch({ type: 'LOG_SET', ex: c.ex, w: w0, r: all[0].r, parts: all.map(function (p, i) { return i && !bw && p.w !== w0 ? { r: p.r, w: p.w } : { r: p.r }; }) });
    } else dispatch({ type: 'LOG_SET', ex: c.ex, w: bw ? null : c.w, r: c.r });
    var done = state.exercises[c.ex].sets[slot];
    ui.fresh = { ex: c.ex, k: slot, at: performance.now() };
    delete ui.extra[c.ex]; ui.view = state.exIdx; ui.chimed = 0; ui.fired = {}; ui.restTouched = 0;
    sound('tick'); haptic(); render(); reveal(); undoToast(slot + 1);
    if (then === 'finish') { finishOpen(); return; }                       // the final set of the final exercise: straight to the summary
    if (state.rest && state.rest.endsAt > Date.now()) restPushSchedule();   // B6: schedule the lock-screen rest-end push

    // the coach reacts to THIS set: judged against the target it had (done = the total reps of a combined set); no target -> no judgement
    var pr = W.isPR(done, ex, sessions());
    var m = W.coachMoment(state, { set: done, target: tg && tg.aim != null ? { w: tg.w, r: tg.aim } : null, pr: pr, judge: CO && CO.judge, seen: ui.coachSeen });
    if (m) coachSay(m); else { ui.coachLine = null; coachFallback(); }     // no target -> no judgement, the slot shows the next target
    if (pr) { var pi = W.prInfo(done, ex, sessions()); if (pi) showPR(pi, ex.label); }   // the gold PR MOMENT
  }
  // ── the PR MOMENT: a warm gold full-bleed moment; the character, the record, the delta; closes on tap or after 3 s ──
  var prM = null, prTimer = 0;
  function prEl() {
    var e = $('wkPr'); if (e) return e;
    e = document.createElement('div'); e.id = 'wkPr'; e.className = 'wk-prm'; e.dir = 'rtl'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-live', 'assertive');
    e.innerHTML = '<div class="wk-prm-m" id="wkPrM" aria-hidden="true"></div><div class="wk-prm-t">' + S.prMomentT + '</div><div class="wk-prm-ex" id="wkPrEx"></div><div class="wk-prm-n"><bdi dir="ltr" id="wkPrN"></bdi></div><div class="wk-prm-d" id="wkPrD"></div><div class="wk-prm-sub" id="wkPrSub"></div><div class="wk-prm-hint">' + S.prHint + '</div>';
    e.addEventListener('click', hidePR); document.body.appendChild(e); return e;
  }
  function showPR(info, label) {
    var e = prEl();
    $('wkPrEx').textContent = label;
    $('wkPrN').textContent = info.set.replace(/[⁦-⁩]/g, '');
    var d = $('wkPrD'); d.innerHTML = info.kind === 'e1rm' && info.prev > 0 ? S.prDeltaKg(num(info.deltaKg)) : info.kind === 'reps' && info.deltaReps > 0 && info.prev > 0 ? S.prDeltaReps(num(info.deltaReps)) : '';
    d.hidden = !d.innerHTML;
    var sub = $('wkPrSub'); sub.textContent = info.streak >= 2 ? S.prStreak(info.streak) : '';   // only when the streak is real
    sub.hidden = !sub.textContent;
    e.classList.add('on'); haptic();
    try { if (!prM && window.WkMascot) prM = window.WkMascot.mount($('wkPrM'), { mode: 'fire' }); if (prM) prM.set('pr'); } catch (_) { }
    clearTimeout(prTimer); prTimer = setTimeout(hidePR, 3000);            // closes on tap OR after 3 s (both themes)
  }
  function hidePR() { var e = $('wkPr'); if (e) e.classList.remove('on'); clearTimeout(prTimer); }
  // best effort: a hidden iOS switch toggled by its label gives a light tick on supporting phones; behind a pref, no promise in the UI
  function haptic() { if (!prefs().haptic) return; try { var l = $('wkHapL'); if (l) l.click(); } catch (_) { } try { if (navigator.vibrate) navigator.vibrate(20); } catch (_) { } }
  // "= כמו הסט הקודם": the previous set of this exercise prefills the active one (a combined set keeps its parts)
  function sameAsLast() {
    var c = cur(), ex = state.exercises[c.ex], p = ex.sets[ex.sets.length - 1]; if (!p) return;
    if (p.parts && p.parts.length > 1) { var ps = p.parts.map(function (x, i) { return { w: x.w != null ? x.w : p.w, r: x.r }; }); var last = ps.pop(); c.parts = ps; c.w = last.w; c.r = last.r; }
    else { c.parts = null; c.w = p.w; c.r = p.r; }
    render(); reveal();
  }
  function peek() { ui.peek[ui.view] = !ui.peek[ui.view]; render(); }
  // after a set: a 5 s toast "נרשם סט N · ↶ בטל" over the dock (absolute: moves nothing); undo removes that set (and any rest action after it)
  function undoToast(n) {
    var d = $('wkLvDock'); if (!d) return;
    var t = $('wkUndoT'); if (!t) { t = document.createElement('div'); t.id = 'wkUndoT'; t.className = 'wk-undo-t'; $('wkLive').appendChild(t); }
    t.innerHTML = '<span>' + S.undoToast(num(n)) + '</span><button class="wk-chip" onclick="WorkoutLive.undoSet()">' + S.undoBtn + '</button>';
    t.style.bottom = d.offsetHeight + 'px';                                  // a snackbar resting ON the bar's top edge
    t.classList.add('on'); clearTimeout(ui.undoT); ui.undoT = setTimeout(function () { t.classList.remove('on'); }, 5000);
  }
  function undoSet() {
    var t = $('wkUndoT'); if (t) t.classList.remove('on'); clearTimeout(ui.undoT);
    if (!draft) return; var i = -1; draft.actions.forEach(function (a, k) { if (a.type === 'LOG_SET') i = k; }); if (i < 1) return;
    draft.actions.splice(i); state = W.replay(draft.actions); saveDraft(); ui.pend = {}; ui.view = state.exIdx; ui.coachLine = null; render(); reveal();
  }
  function addPart() { var c = cur(); c.parts = (c.parts || []).concat([{ w: c.w, r: c.r }]); render(); reveal(); }
  function removePart() { var c = cur(); if (!c.parts || !c.parts.length) return; var p = c.parts.pop(); c.w = p.w; c.r = p.r; render(); reveal(); }
  // a short screen: the note, warm-up and parts lines may push the active steppers below the fold -> bring them into view
  // the active set card scrolls to just under the sticky coach line (the card owns the screen; the line stays in view)
  function reveal() { var a = document.querySelector('#wkLvMain .wk-lv-sets'), sc = $('wkLvScroll'); if (!a || !sc || !document.querySelector('#wkLvMain .wk-lv-set.active')) return; sc.scrollTop += a.getBoundingClientRect().top - sc.getBoundingClientRect().top - ($('wkCoachSlot') ? $('wkCoachSlot').offsetHeight + 8 : 8); }
  // the weight keypad: any value (0.25, 0.5, odd numbers); the step chips are remembered per exercise in the catalog
  function typeW() {
    var c = ui.editing || cur(), ex = state.exercises[c.ex], st = es(ex);
    ui.pick = { kind: 'weight' };
    pickOpen(h(ex.label) + ' · ' + unitTxt(ex), '<input class="rfi wk-num-in" id="wkWIn" type="text" inputmode="decimal" dir="ltr" autocomplete="off" value="' + h(c.w == null ? '' : c.w) + '" aria-label="' + S.typeW + '" enterkeyhint="done" onkeydown="if(event.key===\'Enter\')WorkoutLive.typeWOk()">'
      + '<div class="wk-lv-warn" id="wkWErr" hidden>' + S.badW + '</div>'
      + '<div class="wk-lv-cap">' + S.stepT + '</div><div class="wk-chips">' + W.STEP_CHIPS.map(function (s) { return '<button class="wk-chip' + (s === st ? ' on' : '') + '" onclick="WorkoutLive.setStep(' + s + ')"><bdi dir="ltr">' + s + '</bdi></button>'; }).join('') + '</div>',
      '<button class="wk-big" onclick="WorkoutLive.typeWOk()">' + S.ok + '</button>', true);
    setTimeout(function () { var i = $('wkWIn'); if (i) { i.focus(); i.select(); } }, 60);
  }
  function typeWOk() {
    var v = W.parseWeight(($('wkWIn') || {}).value), c = ui.editing || cur();
    if (v == null) { var e = $('wkWErr'); if (e) e.hidden = false; return; }
    c.w = v; pickClose(); render();
  }
  function setStep(s) {
    var c = ui.editing || cur(), ex = state.exercises[c.ex], k = W.labelKey(ex.label);
    patchCat(function (cc) { cc.aliases[k] = Object.assign({}, cc.aliases[k], { step: s }); });
    document.querySelectorAll('#wkPickB .wk-chip').forEach(function (b) { b.classList.toggle('on', +b.textContent === s); });
  }
  // swap: variants of the SAME muscle group; this session only, or remembered in the program (the owner's own edit)
  function swapOpen() {
    var ex = state.exercises[ui.view], m = W.muscleKey(ex, cat());
    ui.pick = { kind: 'swap', remember: !!(ui.pick && ui.pick.remember) };
    var list = W.variantsFor(m, { programs: store().programs, catalog: cat(), exclude: ex.label });
    ui.swapList = list;
    pickOpen(S.swapT(muscleName(m)), '<button class="wk-row" onclick="WorkoutLive.swapRemember()" role="switch" aria-checked="' + ui.pick.remember + '"><span class="wk-row-l">' + S.remember + '</span><span class="wk-sw' + (ui.pick.remember ? ' on' : '') + '"></span></button>'
      + list.map(function (l, i) { return row(h(l), 'WorkoutLive.swapTo(' + i + ')'); }).join('')
      + '<div class="wk-add-row"><input class="rfi" id="wkVarIn" type="text" placeholder="' + S.variantName + '" enterkeyhint="done"><button class="wk-chip" onclick="WorkoutLive.swapAdd()">' + S.addVariant + '</button></div>', '', true);
  }
  function swapRemember() { ui.pick.remember = !ui.pick.remember; var b = document.querySelector('#wkPickB .wk-sw'); if (b) b.classList.toggle('on', ui.pick.remember); }
  function swapAdd() {
    var v = String(($('wkVarIn') || {}).value || '').trim(); if (!v) { var i = $('wkVarIn'); if (i) i.focus(); return; }
    var ex = state.exercises[ui.view], m = W.muscleKey(ex, cat());
    patchCat(function (cc) { cc.variants[m] = [v].concat((cc.variants[m] || []).filter(function (x) { return W.labelKey(x) !== W.labelKey(v); })); });
    swapApply(v);
  }
  function swapTo(i) { var l = (ui.swapList || [])[i]; if (l) swapApply(l); }
  function swapApply(label) {
    var i = ui.view, ex = state.exercises[i], m = W.muscleKey(ex, cat()), remember = ui.pick && ui.pick.remember;
    dispatch({ type: 'SWAP_EXERCISE', ex: i, exercise: { label: label, muscle: m, equip: ex.equip, unit: ex.unit, step: ex.step } });
    if (remember && state.program.id && ex.pid) {                         // the owner chose it: the program's exercise takes the new name
      var pid = state.program.id, eid = ex.pid;
      patchStore(function (st) { st.programs.forEach(function (p) { if (p.id !== pid) return; p.days.forEach(function (d) { d.exercises.forEach(function (e) { if (e.id === eid) { e.label = label; e.muscle = e.muscle || m; } }); }); }); });
    }
    ui.pend = {}; pickClose(); render();
  }
  // ONE note per muscle group (catalog), editable here and in the exercise editor
  function noteOpen(m) {
    m = m || W.muscleKey(state.exercises[ui.view], cat());
    ui.pick = { kind: 'note', m: m };
    pickOpen(S.noteT(muscleName(m)), '<textarea class="rfi wk-note-in" id="wkNoteIn" rows="3" placeholder="' + S.noteHint + '">' + h(cat().notes[m] || '') + '</textarea>', '<button class="wk-big" onclick="WorkoutLive.noteSave()">' + S.save + '</button>', true);
  }
  function noteSave() { var m = ui.pick && ui.pick.m; if (!m) return; var v = String(($('wkNoteIn') || {}).value || '').trim(); patchCat(function (cc) { if (v) cc.notes[m] = v; else delete cc.notes[m]; }); pickClose(); render(); }
  function undo() { if (!draft || draft.actions.length < 2) return; dispatch({ type: 'UNDO' }); ui.pend = {}; ui.view = Math.min(ui.view, state.exercises.length - 1); render(); }
  function view(i) { ui.view = i; ui.editing = null; render(); reveal(); }
  function addSet() { ui.extra[ui.view] = 1; render(); }
  function skipEx() { dispatch({ type: 'SKIP_EXERCISE', ex: ui.view }); ui.view = state.exIdx; render(); }
  function editSet(i) { var x = state.exercises[ui.view].sets[i]; ui.editing = { ex: ui.view, i: i, w: x.w, r: x.r }; render(); }
  function saveEdit() { var e = ui.editing; dispatch({ type: 'EDIT_SET', ex: e.ex, i: e.i, w: e.w, r: e.r }); ui.editing = null; ui.pend = {}; render(); }
  function delSet() { var e = ui.editing; dispatch({ type: 'DELETE_SET', ex: e.ex, i: e.i }); ui.editing = null; ui.pend = {}; render(); }
  function cancelEdit() { ui.editing = null; render(); }
  function restAdj(d) { dispatch({ type: 'REST_ADJUST', delta: d }); renderDock(); tick(); }
  function restSkip() { restPushCancel(); dispatch({ type: 'REST_SKIP' }); render(); reveal(); coachArrive(false); }   // B6: skipping rest cancels the scheduled push
  // the warm-up rows of exercise i: [] when it gets none (setting / auto rule), skipped, or no first target; edits apply to this session only
  function warmRows(i) {
    var ex = state.exercises[i], w = ui.warm[i] || {}; if (w.skip || W.warmupIdx(state.exercises, cat()).indexOf(i) < 0) return [];
    var t = targets(i)[0], ws = isBw(ex) ? W.warmupBw(t && t.aim) : W.warmupSets(t && t.w, es(ex));
    return ws.map(function (x, j) { return (w.ed && w.ed[j]) || x; });
  }
  function warm(i, k) { var w = ui.warm[i] = ui.warm[i] || { done: {} }; if (k === 'toggle') w.open = !w.open; else if (k === 'skip') w.skip = true; else w.done[k] = !w.done[k]; render(); }
  function warmEdit(i, j) {
    var x = warmRows(i)[j]; if (!x) return; ui.pick = { kind: 'warm', i: i, j: j };
    pickOpen(S.warmT + ' ' + (j + 1), (x.w == null ? '' : '<label class="rform-lbl" for="wkWuW">' + S.weightT + '</label><input class="rfi" id="wkWuW" inputmode="decimal" dir="ltr" value="' + h(x.w) + '">')
      + '<label class="rform-lbl" for="wkWuR">' + S.reps + '</label><input class="rfi" id="wkWuR" inputmode="numeric" dir="ltr" value="' + h(x.r) + '"><div class="wk-lv-cap">' + S.warmEditHint + '</div>',
      '<button class="wk-big" onclick="WorkoutLive.warmSave()">' + S.keep + '</button>', true);
  }
  function warmSave() {
    var P = ui.pick; if (!P || P.kind !== 'warm') return;
    var x = warmRows(P.i)[P.j], we = $('wkWuW'), r = parseInt(($('wkWuR') || {}).value, 10), wv = we ? W.parseWeight(we.value) : null;
    if (!x || !(r > 0) || (we && wv == null)) return;
    var w = ui.warm[P.i] = ui.warm[P.i] || { done: {} }; w.ed = w.ed || {}; w.ed[P.j] = { w: we ? wv : null, r: Math.min(99, r) };
    pickClose(); render();
  }
  // + exercise during the workout: a picker of known exercises (no typing inside the live screen)
  function addPick() {
    var seen = {}, list = [];
    store().programs.forEach(function (p) { p.days.forEach(function (d) { d.exercises.forEach(function (e) { var k = W.labelKey(e.label); if (!seen[k]) { seen[k] = 1; list.push(e); } }); }); });
    state.exercises.forEach(function (e) { seen[W.labelKey(e.label)] = 2; });
    pickOpen(S.pickEx, list.filter(function (e) { return seen[W.labelKey(e.label)] === 1; }).map(function (e, i) { ui['_add' + i] = e; return row(h(e.label), 'WorkoutLive.addEx(' + i + ')', '', T.equip[e.equip] || ''); }).join('') || '<div class="wk-lv-cap">' + S.noEx + '</div>', '');
  }
  function addEx(i) { var e = ui['_add' + i]; if (!e) return; dispatch({ type: 'ADD_EXERCISE', exercise: copy(e) }); pickClose(); ui.view = state.exIdx; render(); }
  function finishOpen() {
    restPushCancel();   // B6: ending the workout cancels any pending rest-end push
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
    if (state.test) { closeTest(); return; }                              // a TEST run never writes a session (only "סגור")
    var s = preview(), same = sessions().filter(function (x) { return x.date === s.date && x.type === s.type; });
    if (same.length && !how) { ui.exists = true; render(); return; }
    var now = new Date().toISOString(), rec = Object.assign({ id: uid('w'), createdAt: now, updatedAt: now, instanceId: null }, s);
    if (W.exProgress(state).partial) rec.partial = true;                   // optional: absent = a complete workout (older readers ignore it)
    var ok = patch(KEY_S, [], function (all) {                            // read-modify-write on the CURRENT list
      all = Array.isArray(all) ? all : [];
      var hit = how === 'replace' ? all.filter(function (x) { return x.date === s.date && x.type === s.type; })[0] : null;
      if (hit) { rec.id = hit.id; rec.createdAt = hit.createdAt || now; all[all.indexOf(hit)] = rec; } else all.push(rec);
      return all;
    });
    if (!ok) { ui.err = S.saveErr; render(); return; }
    // lastDay only on a program already stored in the days shape (an M1a-shaped store is never rewritten by a workout)
    var raw = load(KEY_P, null), rp = raw && (Array.isArray(raw) ? raw : raw.programs) || [], stored = rp.filter(function (x) { return x && x.id === s.programId; })[0];
    if (stored && Array.isArray(stored.days) && s.dayId) patchStore(function (st) { st.programs.forEach(function (x) { if (x.id === s.programId) x.lastDay = s.dayId; }); });
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
  function todayInstances() {                                             // today's workout instances (not skipped), done or not
    var today = W.ymdIn(new Date()), out = [];
    allRoutines().filter(function (r) { return r.enabled !== false && r.kind === 'workout'; }).forEach(function (r) {
      (window.listRoutineInstances ? window.listRoutineInstances(r) : []).forEach(function (i) { if (!i.skipped && W.ymdIn(new Date(i.dt)) === today) out.push({ routineId: String(r.id), dateStr: i.dt }); });
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
      if (!linked) patch(KEY_S, [], function (all) { (Array.isArray(all) ? all : []).forEach(function (y) { if (y.id === rec.id) { y.routineId = rid; y.dateStr = ds; } }); return all; });
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
      renderDock(); if (ui.mode === 'ready') pvMount(); else pvKill(); return;
    }
    // the header names WHERE you are: the exercise (live) / the program (summary); never truncated. The program + locker live in the ⋯ sheet
    var hx = ui.mode === 'live' && state.exercises[ui.view];
    name.innerHTML = '<span class="wk-lv-nm">' + h(hx ? hx.label : state.program.name) + '</span>' + (state.test ? '<span class="wk-lv-lk wk-test-ban">' + S.testBanner + '</span>' : '');
    // progress, grouped by muscle group: icon + label + a restrained bar; a tap jumps to the group's next unfinished exercise
    var cc0 = cat(), groups = [];
    state.exercises.forEach(function (e, i) { var m = W.muscleKey(e, cc0), g = groups.filter(function (x) { return x.m === m; })[0]; if (!g) groups.push(g = { m: m, idx: [] }); g.idx.push(i); });
    prog.innerHTML = groups.map(function (g) {
      var planned = 0, done = 0; g.idx.forEach(function (i) { var e = state.exercises[i], n = (e.scheme && e.scheme.sets) || 3; planned += e.skipped ? e.sets.length || 1 : Math.max(n, e.sets.length); done += e.skipped ? e.sets.length || 1 : e.sets.length; });
      var jump = g.idx.filter(function (i) { return !exDone(state.exercises[i]); })[0]; if (jump == null) jump = g.idx[0];
      return '<button class="wk-seg wk-seg-' + g.m + (g.idx.indexOf(ui.view) > -1 ? ' on' : '') + '" onclick="WorkoutLive.view(' + jump + ')" aria-label="' + muscleName(g.m) + '"><span class="wk-seg-l">' + MUSCLE_ICON[g.m] + ' ' + muscleName(g.m) + '</span><i style="--f:' + (planned ? Math.min(1, done / planned) : 0).toFixed(3) + '"></i></button>';
    }).join('');
    main.innerHTML = ui.mode === 'finish' ? finishHtml() : liveHtml();
    pvKill(); renderDock(); tick(); if (ui.mode === 'live') { coachSlot(); mascotSync(); if ($('wkRestChar')) restMount(); else restKill(); }   // the slot is never left empty on a re-render
    if (ui.mode === 'finish' && ui.counted !== state.startedAt) { ui.counted = state.startedAt; countUp(); var ex = main.querySelector('.wk-lv-ex'); if (ex) ex.classList.add('wk-sum-in'); }   // A13: the summary builds up once (CSS stagger; reduced-motion = no animation); not re-run on later re-renders
    if (ui.mode === 'finish') sumMount(); else sumKill();
  }
  // the summary's numbers count up once, staggered (480 ms each, 80 ms apart; text nodes only; reduced motion = no animation)
  function countUp() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    [].forEach.call(document.querySelectorAll('#wkLvMain [data-wk-count]'), function (el, i) {
      var to = +el.getAttribute('data-wk-count'), t0 = null, delay = i * 80; if (!(to > 0)) return;
      el.textContent = '0';
      var step = function (ts) { if (t0 == null) t0 = ts + delay; var p = Math.min(1, Math.max(0, (ts - t0) / 480)); el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function chips(list, sel, fn, labels) { return '<div class="wk-chips">' + list.map(function (k) { return '<button class="wk-chip' + (sel === k ? ' on' : '') + '" onclick="' + fn(k) + '">' + labels[k] + '</button>'; }).join('') + '</div>'; }
  // tap: the value itself is a button (the weight -> the keypad)
  function stepper(k, val, unit, id, small, tap) {
    var v = '<bdi dir="ltr" id="' + id + '">' + h(val) + '</bdi>' + (unit ? '<span class="wk-stp-u">' + unit + '</span>' : '');
    return '<div class="wk-stp' + (small ? ' sm' : '') + '"><button class="wk-stp-b" data-k="' + k + '" data-d="-1" aria-label="−">−</button>'
      + (tap ? '<button class="wk-stp-v wk-tap" onclick="' + tap + '" aria-label="' + S.typeW + '">' + v + '</button>' : '<div class="wk-stp-v">' + v + '</div>')
      + '<button class="wk-stp-b" data-k="' + k + '" data-d="1" aria-label="+">+</button></div>';
  }
  var wUnit = function (ex) { return unitTxt(ex) + ' · ±<bdi dir="ltr">' + es(ex) + '</bdi>'; };
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
      // warm-up: auto / always / never (stored as false / true / 'off', so older data keeps its meaning)
      + group(chips(['auto', 'on', 'off'], W.warmupMode(e), function (k) { return 'WorkoutLive.exSet(\'warmup\',' + (k === 'on' ? 'true' : k === 'off' ? '\'off\'' : 'false') + ')'; }, S.warmModes)
        + '<div class="wk-lv-cap">' + S.warmModeHint[W.warmupMode(e)] + '</div>', S.warmT)
      + (function () { var m = W.muscleKey(e, cat()), v = m in ui.noteEdits ? ui.noteEdits[m] : cat().notes[m] || ''; return group('<textarea class="rfi wk-note-in" id="wkExNote" rows="2" placeholder="' + S.noteHint + '" oninput="WorkoutLive.exNote(this.value)">' + h(v) + '</textarea>', S.noteGroup + ' · ' + muscleName(m)); })()
      + (ui.exIdx > -1 ? '<button class="wk-lv-link wk-danger wk-center-link" onclick="WorkoutLive.removeEx()">' + S.removeEx + '</button>' : '');
  }
  function readyHtml() {
    var R = ui.ready, p = programById(R.programId), d = p.days.filter(function (x) { return x.id === R.dayId; })[0] || p.days[0];
    var wi = -1; d.exercises.some(function (e, i) { if (!isBw(e)) { wi = i; return true; } return false; });
    var wex = wi > -1 ? d.exercises[wi] : null, wl = wex && lastOf(wex.label), wt = wex && W.targetsFor(wex, wl && wl.sets, [], { scale: R.mode === 'light' ? 0.9 : 1 })[0], ws = wt ? W.warmupSets(wt.w, wex.step) : [];
    var feel = function (k) { return line(S[k], '<div class="wk-chips wk-five">' + [1, 2, 3, 4, 5].map(function (n) { return '<button class="wk-chip' + (R.feel[k] === n ? ' on' : '') + '" onclick="WorkoutLive.readySet(\'' + k + '\',' + n + ')">' + n + '</button>'; }).join('') + '</div>'); };
    // the KEY NUMBER (gold): the first weighted exercise's first-set target, or the first exercise's reps
    var keyT = wt ? (wex ? num(wt.w) + ' ' + unitTxt(wex) + ' × ' + num(wt.aim) : '') : (d.exercises[0] ? num((W.targetsFor(d.exercises[0], lastOf(d.exercises[0].label) && lastOf(d.exercises[0].label).sets, [])[0] || {}).aim || '') + ' ' + S.reps : '');
    // the exercise list card: 3 rows + "ועוד N תרגילים" expanding in place
    var exRow = function (e) { var l = lastOf(e.label); return '<div class="wk-ex-row"><span class="wk-ex-name">' + h(e.label) + '</span><span class="wk-ex-last">' + (l && l.sets.length ? setTxt(l.sets[0]) : S.first) + '</span></div>'; };
    var exShown = R.exOpen ? d.exercises : d.exercises.slice(0, 3), exMore = d.exercises.length - 3;
    return (ui.ctx && ui.ctx.test ? '<div class="wk-test-strip">' + S.testBanner + '</div>' : '')
      + '<div class="wk-card-cap wk-ready-cap">' + C.todayCap + '</div>'
      + '<div class="wk-ready-h"><div class="wk-lv-title wk-ready-name">' + h(d.name) + '</div><button class="wk-pill wk-switch" onclick="WorkoutLive.programPick(\'WorkoutLive.readyProgram\')">⇄ ' + S.readySwitch + '</button></div>'
      + (p.days.length > 1 ? '<div class="wk-chips wk-days">' + p.days.map(function (x) { return '<button class="wk-chip' + (x.id === d.id ? ' on' : '') + '" onclick="WorkoutLive.readySet(\'day\',' + js(x.id) + ')">' + h(x.name) + (x.id === R.nextId ? ' · ' + S.next : '') + '</button>'; }).join('') + '</div>' : '')
      // ONE coach card: the 140px stage + a coach line + the key number in gold + the coach-mode chips
      + '<div class="wk-ready-coach wk-lv-group">'
        + (R.coachMode !== 'off' && window.WkMascot ? '<div class="wk-m-pv"><div class="wk-m-pv-c" id="wkMascotPv"></div><div class="wk-m-pv-t">' + h(modeSample(R.coachMode)) + '</div></div>' : '')
        + (keyT ? '<div class="wk-ready-key">' + S.readyKey('<b class="wk-gold-n">' + keyT + '</b>') + '</div>' : '')
        + '<div class="wk-lv-cap">' + S.coachModeT + '</div>' + chips(W.COACH_MODES, R.coachMode, function (k) { return 'WorkoutLive.readySet(\'coach\',\'' + k + '\')'; }, modeLabels())
        + '<div class="wk-lv-cap">' + h(modeHint(R.coachMode)) + '</div></div>'
      // the exercise list card
      + '<div class="wk-ready-ex wk-lv-group">' + exShown.map(exRow).join('')
        + (exMore > 0 ? '<button class="wk-row wk-ex-more" onclick="WorkoutLive.readySet(\'exOpen\')" aria-expanded="' + !!R.exOpen + '">' + (R.exOpen ? S.less : S.exMore(num(exMore))) + ' ' + (R.exOpen ? '▴' : '▾') + '</button>' : '') + '</div>'
      + W.notesFor(d.exercises, cat()).map(function (n) { return '<div class="wk-note-line wk-note-ro"><span class="wk-note-g">📝 ' + muscleName(n.muscle) + '</span><span>' + h(n.text) + '</span></div>'; }).join('')
      + group(line(S.lockerT, stepper('rlk', R.locker == null ? S.none : R.locker, '', 'wkLk', 1)))
      + (ws.length ? group('<button class="wk-row" onclick="WorkoutLive.readySet(\'warm\')" aria-expanded="' + R.warmOpen + '"><span class="wk-row-l">' + S.warmPreview(ws.length) + '</span><span class="wk-row-s">' + h(wex.label) + ' ' + (R.warmOpen ? '▴' : '▾') + '</span></button>'
        + (R.warmOpen ? '<div class="wk-lv-cap">' + ws.map(function (x) { return num(x.w) + ' ' + unitTxt(wex) + ' × ' + num(x.r); }).join(' · ') + '</div>' : '')) : '')
      + group('<button class="wk-row" onclick="WorkoutLive.readySet(\'feelOpen\')" aria-expanded="' + R.feelOpen + '"><span class="wk-row-l">' + S.feel + '</span><span class="wk-row-s">' + dayModes()[R.mode] + ' ' + (R.feelOpen ? '▴' : '▾') + '</span></button>'
        + (R.feelOpen ? feel('sleep') + feel('energy') + feel('pain')
          + '<div class="wk-lv-cap">' + S.modeT + '</div>' + chips(['full', 'light', 'short'], R.mode, function (k) { return 'WorkoutLive.readySet(\'mode\',\'' + k + '\')'; }, dayModes())
          + '<div class="wk-lv-cap">' + S.modeHint[R.mode] + (Object.keys(R.feel).length && !R.modeTouched ? ' · ' + S.suggested : '') + '</div>' : ''))
      // the בדיקות checks, collapsed behind the bottom link
      + (R.checksOpen ? '<div class="wk-ready-checks">' + checksHtml() + '</div>' : '')
      // bottom row: חימום · בדיקות · ערוך תוכנית
      + '<div class="wk-ready-links">'
        + '<button class="wk-lv-link" onclick="WorkoutLive.readyWarm()">' + S.readyWarm + '</button><span class="wk-sep">·</span>'
        + '<button class="wk-lv-link" onclick="WorkoutLive.readySet(\'checksOpen\')">' + S.readyChecks + '</button><span class="wk-sep">·</span>'
        + '<button class="wk-lv-link" onclick="WorkoutLive.readyEdit()">' + S.readyEdit + '</button></div>';
  }
  function readyWarm() { var R = ui.ready; if (!R.warmOpen) { R.warmOpen = true; render(); } ui.warmFocus = true; var sc = $('wkLvScroll'), w = document.querySelector('#wkLvMain .wk-warm, #wkLvMain .wk-row'); if (w && sc) sc.scrollTop = w.offsetTop - 60; }
  function readyEdit() { var R = ui.ready; if (R.programId) editProgram(R.programId); }
  function liveHtml() {
    var i = ui.view, ex = state.exercises[i], l = lastOf(ex.label), t = targets(i), u = unitTxt(ex), bw = isBw(ex);
    var n = Math.max((ex.scheme && ex.scheme.sets) || 3, ex.sets.length), active = !ex.skipped && (ex.sets.length < n || ui.extra[i]);
    var rows = ex.sets.map(function (x, k) {
      if (ui.editing && ui.editing.ex === i && ui.editing.i === k) {
        return '<div class="wk-lv-set edit"><div class="wk-lv-n">' + S.setN(k + 1) + ' · ' + S.edit + '</div><div class="wk-lv-steps">' + (bw ? '' : stepper('w', ui.editing.w, wUnit(ex), 'wkLvW', 0, 'WorkoutLive.typeW()')) + stepper('r', ui.editing.r, S.reps, 'wkLvR') + '</div>'
          + '<div class="wk-chips wk-center"><button class="wk-chip on" onclick="WorkoutLive.saveEdit()">' + S.keep + '</button><button class="wk-chip" onclick="WorkoutLive.delSet()">' + S.del + '</button><button class="wk-chip" onclick="WorkoutLive.cancelEdit()">' + S.cancel + '</button></div></div>';
      }
      var stt = W.rangeStatus(W.firstR(x), t[k] && t[k].range), rx = reaction(ex, x, t[k]);
      var fresh = ui.fresh && ui.fresh.ex === i && ui.fresh.k === k && performance.now() - ui.fresh.at < 1500;   // only the set just logged animates
      return '<button class="wk-lv-set done' + (rx ? ' wk-r-' + rx : '') + (fresh ? ' wk-fresh' : '') + '" onclick="WorkoutLive.editSet(' + k + ')"><svg class="wk-chk" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg><span class="wk-lv-n">' + S.setN(k + 1) + '</span><span class="wk-lv-v">' + setTxt(x) + '</span><span class="wk-lv-st ' + (rx ? 'rx-' + rx : stt) + '">' + (rx ? S.rx[rx] : S.st[stt]) + '</span></button>';
    }).join('');
    var act = '', resting = state.rest && state.rest.endsAt > Date.now(), ended = !resting && state.rest && ui.restTouched !== state.rest.endsAt && Date.now() - state.rest.endsAt < 5 * 60e3;
    if (active && !ui.editing && resting) {
      // REST SCREEN: the finished set in the header; a big gold ring + countdown "מתוך 01:30"; labeled ±15; the last set with undo;
      // a next-set card (the upcoming target + a last-set coach line). The dock holds "אני מוכן, דלג על המנוחה".
      var nIdx = ex.sets.length, nt = t[Math.min(nIdx, t.length - 1)], last = ex.sets[nIdx - 1];
      var total = Math.max(1, Math.round((state.rest.total || 0))), isLastNext = nIdx + 1 >= n;
      var tgt = function (o, big) { return '<div class="' + (big ? 'wk-rest-nt' : 'wk-lv-cap') + '">' + (bw ? num(o.aim == null ? o.r : o.aim) + ' ' + S.reps : num(o.w) + ' ' + u + ' × ' + num(o.aim == null ? o.r : o.aim)) + '</div>'; };
      act = '<div class="wk-lv-set active wk-rest-card">'
        + '<div class="wk-rest-char" id="wkRestChar" aria-hidden="true"></div>'   // the 96px rest character (fixed reserved slot -> CLS 0)
        + '<div class="wk-rest-h">' + S.restFinished(h(ex.label), num(nIdx)) + '</div>'
        + '<div class="wk-rest"><div class="wk-ring wk-ring-xl"><svg class="focus-ring-svg" viewBox="0 0 200 200"><circle class="focus-ring-bg" cx="100" cy="100" r="88"/><circle class="focus-ring-progress" id="wkRing" cx="100" cy="100" r="88"/></svg><div class="wk-ring-t"><bdi dir="ltr" id="wkRestT"></bdi><span class="wk-ring-of">' + S.restOf(W.iso(clock(total))) + '</span></div></div></div>'
        + '<div class="wk-rest-adj"><button class="wk-rest-b" onclick="WorkoutLive.restAdj(-15)">' + S.restMinus + '</button><button class="wk-rest-b" onclick="WorkoutLive.restAdj(15)">' + S.restPlus + '</button></div>'
        + (last ? '<div class="wk-rest-last"><span class="wk-lv-cap">' + S.restLastSet + ' ' + setTxt(last) + '</span><button class="wk-chip wk-rest-undo" onclick="WorkoutLive.undoSet()">' + S.undo + '</button></div>' : '')
        + '<div class="wk-rest-next"><div class="wk-rest-next-h">' + S.nextSetOf(num(nIdx + 1), num(n)) + '</div>' + tgt(nt, true)
        + (isLastNext ? '<div class="wk-lv-cap wk-rest-coach">' + S.restLastCoach + '</div>' : '') + '</div></div>';
    } else if (active && !ui.editing) {
      var c = cur(), tg = t[Math.min(ex.sets.length, t.length - 1)];
      // the HERO is the set you are about to log (weight × reps, live with the steppers); the target is one muted line
      act = '<div class="wk-lv-set active' + (ended ? ' wk-rest-over' : '') + '"><div class="wk-lv-n">' + (ended ? S.restDone(num(ex.sets.length + 1)) : S.setN(ex.sets.length + 1)) + '</div>'
        + '<div class="wk-lv-target wk-hero">' + (bw ? '' : '<bdi dir="ltr" id="wkHeroW">' + h(c.w == null ? '–' : c.w) + '</bdi><span class="wk-lv-u">' + u + '</span><span class="wk-lv-x2">×</span>') + '<bdi dir="ltr" id="wkHeroR">' + h(c.r == null ? '–' : c.r) + '</bdi>' + (bw ? '<span class="wk-lv-u">' + S.reps + '</span>' : '') + '</div>'
        + '<div class="wk-lv-cap wk-hero-t">' + S.target + ': ' + (bw ? '' : num(tg.w) + ' ' + u + ' × ') + num(tg.range[0] + '-' + tg.range[1]) + (bw ? ' ' + S.reps : '') + '</div>'
        + (c.parts && c.parts.length ? '<div class="wk-parts"><span class="wk-lv-cap">' + S.partN(c.parts.length + 1) + '</span><bdi dir="ltr" id="wkParts" class="wk-parts-v">' + h(partsTxt(c)) + '</bdi></div>' : '')
        + '<div class="wk-lv-steps">' + (bw ? '' : stepper('w', c.w, wUnit(ex), 'wkLvW', 0, 'WorkoutLive.typeW()')) + stepper('r', c.r, S.reps, 'wkLvR') + '</div>'
        + '<div class="wk-chips wk-center">' + (ex.sets.length ? '<button class="wk-chip" onclick="WorkoutLive.sameAsLast()">' + S.sameAsLast + '</button>' : '')
        + '<button class="wk-chip" onclick="WorkoutLive.addPart()">' + S.addPart + '</button>' + (c.parts && c.parts.length ? '<button class="wk-chip" onclick="WorkoutLive.removePart()">' + S.removePart + '</button>' : '') + '</div></div>';
    }
    var next = '';
    for (var k = ex.sets.length + (active ? 1 : 0); k < n && !ex.skipped; k++) next += '<div class="wk-lv-set next"><span class="wk-lv-n">' + S.setN(k + 1) + '</span><span class="wk-lv-v">' + (bw ? '' : num(t[k].w) + ' ' + u + ' × ') + num(t[k].range[0] + '-' + t[k].range[1]) + '</span></div>';
    // warm-up (WCore.warmupIdx: auto = the first weighted exercise of each muscle group; on / off per exercise): shown ONCE,
    // before the first set, never during rest; every step tickable + editable for this session; skip-all in one tap; never counted
    var wu = '', ws = !ex.sets.length && !resting ? warmRows(i) : [];
    if (ws.length) {
      var w = ui.warm[i] || { done: {} };
      wu = '<div class="wk-lv-group wk-warm"><div class="wk-warm-h"><span class="wk-row-l">' + S.warmT + '</span><button class="wk-lv-link wk-warm-skip" onclick="WorkoutLive.warm(' + i + ',\'skip\')">' + S.warmSkip + '</button></div>'
        + ws.map(function (x, j) {
          var v = x.w == null ? num(x.r) + ' ' + S.reps : num(x.w) + ' ' + u + ' × ' + num(x.r);
          return '<div class="wk-wrow' + (w.done[j] ? ' ok' : '') + '"><button class="wk-lv-set wk-wset" onclick="WorkoutLive.warm(' + i + ',' + j + ')" aria-pressed="' + !!w.done[j] + '"><span class="wk-wtick" aria-hidden="true">' + (w.done[j] ? '✓' : '') + '</span>'
            + '<span class="wk-lv-n">' + S.warmT + ' ' + (j + 1) + '</span><span class="wk-lv-v">' + v + '</span></button>'
            + '<button class="wk-wedit" onclick="WorkoutLive.warmEdit(' + i + ',' + j + ')" aria-label="' + S.edit + ' · ' + S.warmT + ' ' + (j + 1) + '">✎</button></div>';
        }).join('') + '</div>';
    }
    // bodyweight on 'auto': no ramp, said in one muted line where the warm-up would be (first of its muscle group, before the first set)
    if (!wu && bw && !ex.sets.length && !resting && !ex.skipped && W.warmupMode(ex) === 'auto' && W.firstOfGroup(state.exercises, i, cat())) wu = '<div class="wk-lv-cap wk-warm-none">' + S.noWarmBw + '</div>';
    var allDone = state.exercises.every(exDone), cc = cat(), m = W.muscleKey(ex, cc), note = W.firstOfGroup(state.exercises, i, cc) ? String(cc.notes[m] || '').trim() : '';
    return (ui.memOnly ? '<div class="wk-lv-warn">' + S.memFull + '</div>' : '') + (ui.wakeHint ? '<div class="wk-lv-cap wk-lv-hint">' + S.wake + '</div>' : '')
      // the exercise name is in the header; here only its quiet facts (per hand, swapped from)
      + '<div class="wk-lv-ex">' + (ex.unit === 'kg' && ex.equip === 'dumbbell' || ex.swapOf ? '<div class="wk-lv-cap">' + [ex.unit === 'kg' && ex.equip === 'dumbbell' ? S.perHand : '', ex.swapOf ? h(S.swappedFrom(ex.swapOf)) : ''].filter(Boolean).join(' · ') + '</div>' : '')
      // "בפעם שעברה" opens a peek at the last 3 sessions of this exercise
      + (l ? '<button class="wk-peek-b" onclick="WorkoutLive.peek()" aria-expanded="' + !!ui.peek[i] + '">' + S.lastTime + ': ' + l.sets.map(setTxt).join(' · ') + ' ' + (ui.peek[i] ? '▴' : '▾') + '</button>'
        + (ui.peek[i] ? '<div class="wk-peek">' + W.lastNBefore(sessions(), ex.label, tomorrow(), 3).map(function (p) { var d = p.date.split('-'); return '<div class="wk-peek-r"><span class="wk-lv-n">' + num(+d[2] + '.' + +d[1]) + '</span><span class="wk-lv-v">' + p.sets.map(setTxt).join(' · ') + '</span></div>'; }).join('') + '</div>' : '')
        : '<div class="wk-lv-cap">' + S.first + '</div>') + '</div>'
      // the group note, or ONE quiet line to add it (an empty card would only take space)
      + (note ? '<button class="wk-note-line" onclick="WorkoutLive.noteOpen(\'' + m + '\')"><span class="wk-note-g">📝 ' + muscleName(m) + '</span><span>' + h(note) + '</span></button>'
        : W.firstOfGroup(state.exercises, i, cc) ? '<button class="wk-note-add" onclick="WorkoutLive.noteOpen()">📝 ' + S.addNote + ' · ' + muscleName(m) + '</button>' : '')
      + wu + '<div class="wk-lv-group wk-lv-sets">' + rows + act + next + '</div>'
      + (allDone ? '<div class="wk-lv-cap wk-lv-center">' + S.allDone + '</div>' : '')
      // quick, mid-set only: + סט (the exercise is complete) / undo; swap, note, skip, add, finish, cancel live in "⋯ אפשרויות"
      + (!active && !ex.skipped || draft.actions.length > 1 ? '<div class="wk-chips wk-lv-more">' + (!active && !ex.skipped ? '<button class="wk-chip" onclick="WorkoutLive.addSet()">' + S.addSet + '</button>' : '')
        + (draft.actions.length > 1 ? '<button class="wk-chip wk-undo-c" onclick="WorkoutLive.undo()">' + S.undo + '</button>' : '') + '</div>' : '');
  }
  // the primary bar's ONE action for the current position (the label says exactly what happens)
  function primaryAction() {
    var i = ui.view, ex = state.exercises[i], resting = state.rest && state.rest.endsAt > Date.now();
    var active = ex && !ex.skipped && (ex.sets.length < Math.max((ex.scheme && ex.scheme.sets) || 3, ex.sets.length) || ui.extra[i]) && !ui.editing;
    var others = state.exercises.filter(function (e, k) { return k !== i && !exDone(e); }).length;
    if (resting && active) return { label: S.restReady, fn: 'WorkoutLive.restSkip()', cls: 'wk-skip' };
    if (active) {
      var lastOfEx = ex.sets.length + 1 >= Math.max((ex.scheme && ex.scheme.sets) || 3, ex.sets.length + (ui.extra[i] ? 1 : 0)) && !ui.extra[i];
      if (lastOfEx && !others) return { label: S.finish, fn: 'WorkoutLive.logSet(\'finish\')', cls: 'wk-done' };
      if (lastOfEx) return { label: S.nextExBtn, fn: 'WorkoutLive.logSet()', cls: 'wk-done' };
      return { label: S.doneSetN(ex.sets.length + 1), fn: 'WorkoutLive.logSet()', cls: 'wk-done' };
    }
    if (others) return { label: S.nextExBtn, fn: 'WorkoutLive.nextEx()', cls: '' };
    return { label: S.finish, fn: 'WorkoutLive.finishOpen()', cls: '' };
  }
  function nextEx() { var k = state.exercises.map(function (e, j) { return j; }).filter(function (j) { return j !== ui.view && !exDone(state.exercises[j]); })[0]; if (k != null) view(k); }
  function topFact(done, tl, n, cnt) {
    var day = W.ymdIn(new Date(state.startedAt)), best = null;
    var top = function (ss) { return ss.reduce(function (m, x) { return x.w != null && x.w > m ? x.w : m; }, -1); };
    done.forEach(function (ex) {
      var l = W.lastTimeBefore(sessions(), ex.label, day); if (!l || !l.sets.length || isBw(ex)) return;
      var was = top(l.sets), now = top(ex.sets), d = W.snap(now - was, 0);
      if (was >= 0 && d > 0 && (!best || d > best.d)) best = { d: d, label: ex.label, u: unitTxt(ex) };
    });
    if (best) return { html: S.factUp(h(best.label), num(best.d), best.u) };
    if (tl.of) return { html: S.tally(cnt(tl.ok), cnt(tl.of)), tally: true };
    return { html: S.factSets(cnt(n), num(Math.max(1, Math.round(W.durationSec(state, Date.now()) / 60)))) };
  }
  function cmpLine(ex) {
    var l = W.lastTimeBefore(sessions(), ex.label, W.ymdIn(new Date(state.startedAt))), a = ex.sets[0], b = l && l.sets[0];
    // A6: the "+X ק״ג" delta is NOT duplicated here (it leads in the top coach line); the row just shows then -> now
    return '<div class="wk-lv-cmp"><span class="wk-lv-cmp-l">' + h(ex.label) + '</span><span>' + (b ? S.cmpWas(setTxt(b), setTxt(a)) : S.cmpNow(setTxt(a))) + '</span></div>';
  }
  // the end of a TEST run: nothing is saved; edits made during it (notes, steps, variants, a remembered swap) only if the owner confirms
  function closeTest() {
    var q = testQ || []; testQ = null;
    if (q.length && confirm(S.testKeep)) q.forEach(function (x) { W.updateJSON(localStorage, x.key, {}, x.fn); });   // read-modify-write, in order
    drop(KEY_D); draft = null; state = null;
    hide(); refreshAll();
  }
  // the summary's coach line: a postponed instance that still got done -> comebackPostponed (copy table); else the mode's finish line
  function finishLine() {
    if (curMode() === 'off' || !CO) return '';
    if (ui.finText != null && ui.finFor === state.startedAt) return ui.finText;          // stable while the summary is open
    var r = state.routineId && routineOf(state.routineId), inst = r && Object.values(r.scheduledWeeks || {}).reduce(function (a, l) { return a.concat(l || []); }, []).filter(function (i) { return i && typeof i === 'object' && i.dt === state.dateStr; })[0];
    var t = '';
    if (inst && inst.wasRescheduled === true && CP) { var p = CP.pick(W.fillable(CP.COPY.coach.comebackPostponed, {}), -1); t = p.text; }
    if (!t) t = CO.line(curMode(), 'finish', {}, ui.coachLast.finish == null ? -1 : ui.coachLast.finish).text;
    ui.finText = t; ui.finFor = state.startedAt; return t;
  }
  // "ביעד: X מתוך Y סטים": every logged set against the target it had (sets without a target are not counted)
  function tallyNow() {
    var pairs = [];
    state.exercises.forEach(function (e, i) { var t = targets(i); e.sets.forEach(function (x, k) { var tg = t[k]; pairs.push({ set: x, target: tg && tg.aim != null ? { w: tg.w, r: tg.aim } : null }); }); });
    return CO ? W.tally(pairs, CO.judge) : { ok: 0, of: 0 };
  }
  // the weekly volume change vs last week (this week incl. the just-finished session); null when there is no prior week
  function weekPct(s) {
    var tz = W.TZ, wk = W.weekRange(new Date(state.startedAt), tz), prev = W.weekRange(W.addDaysYmd(wk.start, -7), tz);
    var vol = function (range) { return (sessions() || []).filter(function (x) { return x && x.source === 'live'; }).reduce(function (a, x) { var ms = new Date(x.dateStr || x.date).getTime(); return ms >= range.startMs && ms < range.endMs ? a + W.volume(x) : a; }, 0); };
    var thisW = vol(wk) + W.volume(s), lastW = vol(prev);
    return lastW > 0 ? Math.round((thisW - lastW) / lastW * 100) : null;
  }
  // "לפעם הבאה": the next target for the top exercise + the next planned reminder (if a future instance exists)
  function nextTimeCard(done) {
    var ex = done.filter(function (e) { return !isBw(e); })[0] || done[0]; if (!ex) return '';
    var t = W.targetsFor(ex, ex.sets, [])[0], tgt = t ? (isBw(ex) ? num(t.aim) + ' ' + S.reps : num(t.w) + ' ' + unitTxt(ex) + ' × ' + num(t.aim)) : '';
    var when = '';
    try { var b = homeBrief(); if (b && b.instance && b.notifications && b.notifications[0]) { var nx = b.notifications.filter(function (nn) { return nn.instance; })[0]; if (nx) when = num(new Date(nx.instance.dt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: W.TZ })); } } catch (_) { }
    // B5: the "לפעם הבאה" story line is driven by a plateau / near-PR insight when one exists
    var story = '';
    try { var r = window.WkInsights && WkInsights.compute(sessions(), Date.now(), { tz: W.TZ, catalog: cat() }); var si = r && r.insights && r.insights.filter(function (i) { return i.type === 'plateau' || i.type === 'nearPR'; })[0]; if (si) story = '<div class="wk-next-story">' + h(si.headline) + ' · ' + h(si.detail) + '</div>'; } catch (_) { }
    return '<div class="wk-sum-next">' + group('<div class="wk-lv-cap">' + S.nextTimeT + '</div><div class="wk-next-t">' + S.nextTargetL(h(ex.label), tgt) + '</div>' + story + (when ? '<div class="wk-lv-cap">' + S.plannedAt(when) + '</div>' : '')) + '</div>';
  }
  // B5: weekly hard sets per muscle vs the 10-20 band, including this just-finished session
  function muscleBars(cur) {
    var LO = 10, HI = 20, all = sessions(), wr = W.weekRange(new Date(Date.now())), by = {};
    var add = function (s) { if (!s || s.test || s.source === 'test') return; var d = s.dateStr || s.date; if (d < wr.start || d > wr.end) return; (s.exercises || []).forEach(function (e) { var m = W.muscleKey(e, cat()); by[m] = (by[m] || 0) + (e.sets ? e.sets.length : 0); }); };
    all.forEach(add);
    if (cur && cur.exercises && !cur.test && !(state && state.test)) cur.exercises.forEach(function (e) { var m = W.muscleKey(e, cat()); by[m] = (by[m] || 0) + (e.sets ? e.sets.length : 0); });   // this session isn't saved yet at the summary (a test run never counts)
    var keys = Object.keys(by).filter(function (m) { return by[m] > 0; }).sort(function (a, b) { return by[b] - by[a]; });
    if (!keys.length) return '';
    var bars = keys.map(function (m) {
      var n = by[m], state = n < LO ? 'under' : n > HI ? 'over' : 'in', pct = Math.min(100, Math.round(n / HI * 100));
      return '<div class="wk-mb-row"><div class="wk-mb-l">' + h(muscleName(m)) + '</div>'
        + '<div class="wk-mb-track"><span class="wk-mb-band" aria-hidden="true"></span><span class="wk-mb-fill wk-mb-' + state + '" style="width:' + pct + '%"></span></div>'
        + '<div class="wk-mb-n"><bdi dir="ltr">' + n + '</bdi></div></div>';
    }).join('');
    return '<div class="wk-sum-muscles">' + group('<div class="wk-lv-cap">' + S.sumMuscleT + '</div>' + bars) + '</div>';
  }
  function finishHtml() {
    var s = preview(), done = state.exercises.filter(function (e) { return e.sets.length; }), n = done.reduce(function (a, e) { return a + e.sets.length; }, 0);
    var prs = W.prsFor(s, sessions()), fin = finishLine(), tl = tallyNow();
    var cnt = function (v) { return '<bdi dir="ltr" data-wk-count="' + v + '">' + v + '</bdi>'; };   // counted up once (staggered)
    var ft = topFact(done, tl, n, cnt);
    var vol = Math.round(W.volume(s)), pct = weekPct(s), pr0 = prs[0];
    var prTxt = pr0 ? (pr0.kind === 'e1rm' ? h(pr0.label) + ' ~' + num(pr0.value) + ' ' + T.unit.kg : h(pr0.label) + ' ' + num(pr0.w == null ? pr0.r : pr0.w + '×' + pr0.r)) : '';
    var tile = function (val, label, gold) { return '<div class="wk-stat' + (gold ? ' wk-stat-gold' : '') + '"><b>' + val + '</b><span>' + label + '</span></div>'; };
    // A6 hero PR block: the 84px character + (a new record headline if any, else the sets); volume LEADS the 3 stat tiles
    return '<div class="wk-lv-ex"><div class="wk-lv-cap">' + S.sumT + '</div><div class="wk-sum-hero">' + (window.WkMascot && curMode() !== 'off' ? '<div class="wk-sum-m" id="wkMascotSum" aria-hidden="true"></div>' : '')
      + '<div class="wk-sum-lead">' + (pr0 ? '<div class="wk-sum-pr">' + S.sumPrHero('<b class="wk-gold-n">' + prTxt + '</b>') + '</div>' : '<div class="wk-sum-k"><b>' + cnt(n) + '</b> ' + S.setsW(n) + '</div>') + '</div></div>'
      + (W.exProgress(state).partial ? '<div class="wk-lv-cap wk-partial">' + S.partialT(num(W.exProgress(state).done), num(W.exProgress(state).total)) + '</div>' : '')
      + '<div class="wk-sum-tiles">' + tile('<bdi dir="ltr" data-wk-count="' + vol + '">' + num(vol) + '</bdi>', S.sumVolume, true)
        + tile('<bdi dir="ltr">' + num(clock(W.durationSec(state, Date.now()))) + '</bdi>', S.sumTime)
        + tile(pct == null ? '—' : '<bdi dir="ltr">' + (pct >= 0 ? '+' : '') + pct + '%</bdi>', S.sumVsWeek) + '</div></div>'
      // the coach's line (the +X number lives here, NOT duplicated in the table below)
      + '<div class="wk-coach"><b class="wk-fact">' + ft.html + '</b>' + (fin ? ' ' + h(fin) : '') + '</div>'
      + nextTimeCard(done)
      + muscleBars(s)
      + (tl.of && !ft.tally ? '<div class="wk-tally">' + S.tally(cnt(tl.ok), cnt(tl.of)) + '</div>' : '')
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
    if (ui.mode === 'finish' && state.test) { d.innerHTML = big(S.testClose, 'WorkoutLive.saveWorkout()') + link(S.backLive, 'WorkoutLive.backToLive()'); return; }   // TEST: nothing is saved
    if (ui.mode === 'finish') { d.innerHTML = ui.exists ? big(S.replace, 'WorkoutLive.saveWorkout(\'replace\')') + link(S.both, 'WorkoutLive.saveWorkout(\'both\')') : big(S.saveW, 'WorkoutLive.saveWorkout()') + link(S.backLive, 'WorkoutLive.backToLive()'); return; }
    // LIVE: a compact sticky bar with ONE primary action; once the rest ends (until a tap) it flashes + pulses
    var a = primaryAction(), ended = state.rest && state.rest.endsAt <= Date.now() && ui.restTouched !== state.rest.endsAt && Date.now() - state.rest.endsAt < 5 * 60e3 && a.cls === 'wk-done';
    // the bar: ONE primary + the labeled secondary "⋯ אפשרויות" (it left the header)
    d.innerHTML = '<div class="wk-dock-row"><button class="wk-sec" id="wkLvMenu" onclick="WorkoutLive.menuOpen()"><span aria-hidden="true">⋯</span> ' + S.options + '</button>'
      + '<button class="wk-big wk-primary ' + a.cls + (ended ? ' wk-pulse wk-flash' : '') + '" onclick="' + a.fn + '">' + a.label + '</button></div>';
  }
  function backToLive() { go('live'); }
  // the set row's reaction class (Part 3 animates them): pr (gold) > exceed / met / under against the target it had; none without a target
  function reaction(ex, set, tg) {
    if (W.isPR(set, ex, sessions())) return 'pr';
    return tg && tg.aim != null && CO ? CO.judge({ w: tg.w, r: tg.aim }, { w: set.w, r: set.r }) : '';
  }
  // the next target for the coach line: numerals isolated, a bodyweight target carries "חזרות" OUTSIDE the isolate (never a bare tail)
  function nextTargetIso() { var t = nextTargetText(), ex = state.exercises[ui.view]; return t ? W.coachNum(t, isBw(ex) ? null : 1) : ''; }
  function nextTargetText() { var i = ui.view, ex = state.exercises[i], t = targets(i), tg = t[Math.min(ex.sets.length, t.length - 1)]; return tg && tg.aim != null ? W.targetText({ w: isBw(ex) ? null : tg.w, r: tg.aim }) : ''; }

  // ── timers: ONE 1-second interval while visible; only text nodes change ──
  function tick() {
    if (!state || !$('wkLive') || (ui.mode !== 'live' && ui.mode !== 'finish')) return;
    var now = Date.now(); txt('wkLvEl', clock(W.durationSec(state, now)));
    var r = state.rest, t = $('wkRestT');
    if (r && t) {
      var left = Math.max(0, (r.endsAt - now) / 1000), ring = $('wkRing');
      t.textContent = clock(Math.ceil(left));
      if (ring) ring.style.strokeDashoffset = (RING * (1 - left / Math.max(1, r.total))).toFixed(1);
    }
    mascotRest(r, now);
    // the rest-end alert: at the end, +10 s, +30 s until a tap (computed from timestamps: a rest that ended in the background alerts on return)
    if (r && ui.mode === 'live') {
      var a = W.dueAlert(W.restAlertSchedule(r.endsAt, now, ui.restTouched === r.endsAt), now, ui.fired);
      if (a) {
        W.restAlertSchedule(r.endsAt, now, false).forEach(function (x) { if (x.atMs <= now) ui.fired[x.atMs] = 1; });
        sound('rest'); var first = a.kind === 'end' && ui.chimed !== r.endsAt;
        if (a.kind === 'end') { acquireWake(); if (first) { ui.chimed = r.endsAt; haptic(); restPushCancel(); } }   // A12b: haptic paired to the rest-end; B6: foreground = suppress the push (the in-app alert handled it)
        if (first) render(); else renderDock();                             // the rest card turns back into the set (once)
        if (first) coachArrive(true);
      }
    }
  }
  function startTimer() { stopTimer(); if (document.visibilityState !== 'hidden') timer = setInterval(tick, 1000); tick(); }
  function stopTimer() { clearInterval(timer); timer = null; }
  document.addEventListener('visibilitychange', function () {
    if (!isOpen()) return;
    if (document.visibilityState === 'visible') { clearTimeout(ui.hiddenAlert); if (ui.mode === 'live') { render(); acquireWake(); } startTimer(); }
    else { stopTimer(); hiddenRestAlert(); }
  });
  // hidden mid-rest: ONE notification at the rest end ("המנוחה נגמרה · סט N מחכה") where the page still runs (desktop, some Android).
  // iOS freezes a hidden / locked PWA's JS, so there it cannot fire: the in-app alert plays once on return (dueAlert). No server push.
  function hiddenRestAlert() {
    clearTimeout(ui.hiddenAlert);
    var r = state && state.rest, ex = state && state.exercises[ui.view];
    if (!r || !ex || ui.mode !== 'live') return;
    var wait = r.endsAt - Date.now(); if (wait < 0 || wait > 10 * 60e3) return;
    var title = S.restDoneNotif(ex.sets.length + 1);
    ui.hiddenAlert = setTimeout(function () {
      if (document.visibilityState !== 'hidden' || !window.Notification || Notification.permission !== 'granted') return;
      var plain = function () { try { new Notification(title, { tag: 'wk-rest' }); } catch (_) { } };
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          var done = false, t = setTimeout(function () { if (!done) { done = true; plain(); } }, 400);
          navigator.serviceWorker.ready.then(function (reg) { if (done) return; done = true; clearTimeout(t); reg.showNotification(title, { tag: 'wk-rest' }); }).catch(function () { if (!done) { done = true; plain(); } });
        } else plain();
      } catch (_) { plain(); }
    }, wait);
  }

  // ── B6: a lock-screen push at rest END via the server scheduler (reaches iOS where JS is frozen while locked) ──
  // The scheduler is injectable (window.__wkRestSched) so it can be mocked in tests. The live /schedule worker is a 1-minute
  // cron with only a bulk /cleanup (no per-id cancel, no seconds-scale fire) — insufficient for a short rest, so the worker
  // needs a change (alfred-archive/session3-worker-checklist.md); NOT deployed. The in-app alert stays the guaranteed path.
  var restSchedDefault = {
    schedule: function (n) { try { if (!(window.Notification && Notification.permission === 'granted')) return; if (typeof window.wkSchedulePush === 'function') window.wkSchedulePush(n); } catch (_) { } },
    cancel: function (id) { try { if (typeof window.wkCancelPush === 'function') window.wkCancelPush(id); } catch (_) { } }
  };
  function restSched() { return window.__wkRestSched || restSchedDefault; }
  function restPushId() { var c = ui.ctx || {}; return 'wk_restend_' + (c.routineId || 'free') + '_' + (state ? state.startedAt : 0); }
  function restPushSchedule() {
    if (!state || !state.rest || ui.mode !== 'live' || state.test) return;   // never a real push for a test run
    var ex = state.exercises[ui.view]; if (!ex) return;
    var ts = targets(ui.view), tg = ts[Math.min(ex.sets.length, ts.length - 1)];
    var plain = function (s) { return String(s).replace(/<[^>]+>/g, '').replace(/[⁦-⁩]/g, ''); };   // a push body is plain text, not in-app HTML
    var tgt = tg ? (isBw(ex) ? tg.aim + ' ' + S.reps : tg.w + ' ' + unitTxt(ex) + ' × ' + tg.aim) : '';
    var c = ui.ctx || {};
    try { restSched().schedule({ id: restPushId(), fireAt: new Date(state.rest.endsAt).toISOString(), title: S.restEndT, body: plain(S.restEndBody(ex.label, ex.sets.length + 1, tgt)),
      payload: { type: 'workout', id: (c.routineId || '') + '__' + (c.dateStr || ''), stage: 'restEnd' } }); } catch (_) { }   // B6b: never surfaces an error
  }
  function restPushCancel() { try { restSched().cancel(restPushId()); } catch (_) { } }
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
  // 'tick' per set (quiet); 'rest' = the rest-end chime: three rising notes, clearly louder than any UI sound
  // the rest-end chime has the coach mode's character: calm = two soft low notes, coach = three rising, fire = four quick bright ones
  var CHIME = { calm: [[523, 0, 0.3, 0.34], [659, 0.3, 0.75, 0.34]], coach: [[784, 0, 0.16, 0.42], [988, 0.17, 0.33, 0.42], [1175, 0.34, 0.62, 0.45]],
    fire: [[880, 0, 0.09, 0.45], [1109, 0.1, 0.19, 0.45], [1319, 0.2, 0.29, 0.47], [1760, 0.3, 0.55, 0.45]] };
  var sessT = 0;
  // the silent-switch experiment: 'playback' lets Web Audio sound with the switch on (it may pause music), back to 'auto' right after
  function audioSession() {
    var a = navigator.audioSession; if (!a || !prefs().silent) return;
    try { a.type = 'playback'; clearTimeout(sessT); sessT = setTimeout(function () { try { a.type = 'auto'; } catch (_) { } }, 1500); } catch (_) { }
  }
  function sound(kind, force, mode) {
    if (!force && !prefs().sound) return;                                 // the check button always plays
    var c = audio(false); if (!c) return;
    audioSession();
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      (kind === 'tick' ? [[1320, 0, 0.05, 0.08]] : kind === 'rest' ? CHIME[mascotMode(mode)] : [[660, 0, 0.18, 0.16], [880, 0.16, 0.34, 0.14]]).forEach(function (n) {
        var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + n[1];
        o.type = 'sine'; o.frequency.value = n[0]; o.connect(g); g.connect(c.destination);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n[3], t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + n[2] + 0.12);
        o.start(t); o.stop(c.currentTime + n[2] + 0.15);
      });
    } catch (_) { }
  }

  // ── resume banner (app open) and the sheet line ──
  function resumeLine(where) {
    var r = enabled() && readDraft(); if (!r || r.s.test) return '';          // a TEST draft never shows as a real workout
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
  function saveOld() { var r = readDraft(); if (!r) return; draft = r.d; state = r.s; testQ = state.test ? [] : null; ui.effort = null; ui.locker = state.locker; ui.exists = false; ui.err = ''; hideBanner(); ui.stack = []; ui.mode = 'finish'; show(); }
  function delOld() { if (!confirm(S.delConfirm)) return; drop(KEY_D); hideBanner(); var s = $('wkSheet'); if (s && s.classList.contains('on') && window.Workout) window.Workout.open(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
  // A5: the mic/coach FAB must never cover card content — it auto-docks (tucks away) while scrolling, returns when idle.
  // Structural + global: a wk- class on the existing FAB, no card-by-card fix, no restructure. Reduced motion = instant.
  (function fabTuck() {
    var t = 0, on = false, el = function () { return document.getElementById('asstFab'); };
    var move = function () { var f = el(); if (!f) return; if (!on) { on = true; f.classList.add('wk-fab-tuck'); } clearTimeout(t); t = setTimeout(function () { on = false; var g = el(); if (g) g.classList.remove('wk-fab-tuck'); }, 650); };
    // an always-present bottom gutter in the scroll container (sibling after #list, survives render()) so no card ever
    // sits in the FAB's rest position — the structural guarantee; the tuck above is only an extra while scrolling
    var gutter = function () { var app = document.getElementById('app'); if (!app || document.getElementById('wkFabGutter')) return; var g = document.createElement('div'); g.id = 'wkFabGutter'; g.className = 'wk-fab-gutter'; g.setAttribute('aria-hidden', 'true'); app.appendChild(g); };
    var attach = function () { gutter(); window.addEventListener('scroll', move, { passive: true }); var app = document.getElementById('app'); if (app) app.addEventListener('scroll', move, { passive: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach); else attach();
  })();
  // the audio context is created (suspended) in idle time, so a tap only resumes it (creating it costs ~50 ms)
  (window.requestIdleCallback || function (f) { return setTimeout(f, 1500); })(function () { if (enabled()) audio(false); });

  // ── WorkoutHome: the HOME card of a workout routine (null = the regular card renders, byte-identical) ──
  var C = T.card;
  function programFor(r) { return programById(r && r.programId || null); }
  // ONE brief per render (cached ~1.5 s): the home hero + the notification journey read the same numbers
  var briefCache = null, briefAt = 0;
  function homeBrief() {
    var now = Date.now(); if (briefCache && now - briefAt < 1500) return briefCache;
    var insts = [];
    try {
      allRoutines().filter(function (r) { return r.enabled !== false && r.kind === 'workout'; }).forEach(function (r) {
        (window.listRoutineInstances ? window.listRoutineInstances(r) : []).forEach(function (i) { insts.push({ routineId: String(r.id), dt: i.dt, completed: i.completed, skipped: i.skipped }); });
      });
    } catch (_) { }
    var dft = readDraft();
    try {
      var nc = readNotif();   // A14/B3/B4: the configurable times feed the schedule (not hard-coded in the brief)
      briefCache = window.WkBrief ? window.WkBrief.compute({ enabled: enabled(), routines: allRoutines(), programs: load(KEY_P, null), sessions: sessions(), catalog: cat(), draft: dft ? Object.assign({}, dft.s, { test: dft.s.test }) : null, prefs: prefs(), instances: insts, tz: W.TZ, notif: { evening: nc.evening, morning: nc.morning, review: nc.review, backup: nc.backup } }, now) : null;
    } catch (_) { briefCache = null; }
    briefAt = now; return briefCache;
  }
  // the hero's muted meta line "52 דק׳ · 6 תרגילים · 18 סטים" (from the plan; each part only if known)
  function heroMeta(b) {
    var w = b && b.workout; if (!w) return '';
    var parts = [w.mins ? num(w.mins) + ' ' + S.minutes('').trim() : '', w.exercises ? W.plural(num(w.exercises) + ' תרגילים') : '', w.sets ? W.plural(num(w.sets) + ' סטים') : ''].filter(Boolean);
    return parts.length ? '<div class="wk-card-meta">' + parts.join(' · ') + '</div>' : '';
  }
  // under the hero: weekly dots + the streak, and the last personal record — small, muted, facts only
  function heroSub(b) {
    if (!b || !b.facts) return '';
    var f = b.facts, wk = '';
    if (f.weekPlanned > 0) {
      var dots = '', tdy = Math.min(f.weekDone, Math.min(7, f.weekPlanned) - 1);   // A10: the first not-yet-done dot is today's session (clamped); marked distinctly
      for (var i = 0; i < Math.min(7, f.weekPlanned); i++) dots += '<i class="wk-dot' + (i < f.weekDone ? ' on' : '') + (i === tdy && f.weekDone < f.weekPlanned ? ' today' : '') + '"></i>';
      wk = '<div class="wk-sub"><div class="wk-sub-dots">' + dots + '</div><div class="wk-sub-t">' + (f.streakWeeks > 1 ? W.plural(num(f.streakWeeks) + ' שבועות ברצף') : S.weekProg(num(f.weekDone), num(f.weekPlanned))) + '</div></div>';
    }
    var pr = '';
    if (b.targets && b.targets.exercise && (f.prCount || f.nearPR)) {
      pr = '<button class="wk-sub wk-sub-tap" onclick="event.stopPropagation();WorkoutHome.openInsights()" aria-label="' + h(S.insOpen) + '"><div class="wk-sub-k">' + (f.nearPR ? '◎' : '★') + '</div><div class="wk-sub-t">' + h(f.nearPR ? S.nearPRL(h(b.targets.exercise)) : S.lastPRL) + '</div></button>';
    }
    return wk || pr ? '<div class="wk-hero-extra">' + wk + pr + '</div>' : '';
  }
  function card(inst, r) {
    if (!enabled() || !r || r.kind !== 'workout' || !inst || !inst.datetime) return null;
    var now = Date.now(), dft = readDraft(), mine = dft && String(dft.s.routineId) === String(r.id) && dft.s.dateStr === inst.dateStr;
    var all = sessions(), saved = all.some(function (s) { return s && s.source === 'live' && String(s.routineId) === String(r.id) && s.dateStr === inst.dateStr; });
    var st = W.cardState({ now: now, dt: inst.datetime, completed: inst.completed, hasSession: saved, inProgress: mine, unlockMin: r.wkUnlockMin });
    if (!st) return null;
    var p = programFor(r), d = p ? W.nextDay(p, all) : null, dt = new Date(inst.datetime);
    var time = dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: W.TZ });
    var dayName = mine ? dft.s.dayName || dft.s.program.name : d ? d.name : r.name || '';
    var done = st === 'done' ? W.sortRecent(all.filter(function (s) { return String(s.routineId) === String(r.id) && s.dateStr === inst.dateStr; }))[0] : null;
    var vars = { day: h(dayName), time: num(time), days: num(W.daysBetween(W.ymdIn(new Date(now)), W.ymdIn(dt))) };
    if (st === 'progress') { var sets = dft.s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0); vars.elapsed = '<bdi dir="ltr" data-wk-el="' + dft.s.startedAt + '">' + elMin(now - dft.s.startedAt) + '</bdi> ' + S.minutes('').trim(); vars.n = num(sets + 1); }
    if (done) { vars.duration = num(mins(done.durationSec)); vars.n = num(done.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0)); }
    else if (st === 'done') { vars.duration = ''; vars.n = ''; }
    var seed = r.id + '|' + inst.dateStr + '|' + st, head = W.fill(W.pick(C[st], seed).text, vars);
    if (st === 'done' && !done) head = h(r.name || dayName) + ' · ✓';
    // ONE data line from history (the fallback when the copy table cannot be filled)
    var data = '', prs = done ? W.prsFor(done, all.filter(function (s) { return s.id !== done.id && s.date <= done.date; })) : [];
    if (st === 'done' && done) { if (prs[0]) data = C.pr(prs[0].kind === 'e1rm' ? h(prs[0].label) + ' ~' + num(prs[0].value) + ' ' + T.unit.kg : h(prs[0].label) + ' ' + num(prs[0].r) + ' ' + S.reps); }
    else if (st !== 'done' && st !== 'progress' && st !== 'far') {
      var ex = d && d.exercises.filter(function (e) { var l = lastOf(e.label); return l && l.sets.length; })[0], l = ex && lastOf(ex.label);
      data = l ? W.fill(W.pick(C.last, seed).text, { ex: h(ex.label), set: setTxt(l.sets[0]) }) : W.fill(W.pick(C.first, seed).text, { day: h(dayName) });
    }
    // the copy table (wk-copy.js): headline / line / cta per state, filled ONLY from the owner's own data; no fillable variant -> the fallback
    var unlockAt = dt.getTime() - (r.wkUnlockMin == null ? 30 : r.wkUnlockMin) * 60000, cdSpan = '<bdi dir="ltr" data-wk-cd="' + unlockAt + '">' + hms((unlockAt - now) / 1000) + '</bdi>';
    var key = st === 'progress' ? 'inProgress' : st, K = CP && CP.COPY.card[key], cv = copyVars(st, r, inst, dt, dayName, d, dft, done, prs, now, cdSpan, unlockAt);
    if (K) {
      var ch = copyLine(seed + '|h', K.headline, cv); if (ch && !(st === 'done' && !done)) head = ch;
      var cl = copyLine(seed + '|l', st === 'done' && prs.length && K.linePR ? K.linePR : K.line, cv); if (cl) data = cl;
    }
    var cta = function (fb) { return K && K.cta ? h(K.cta) : fb; }, cdInHead = head.indexOf('data-wk-cd') > -1;
    var argO = { routineId: String(r.id), dateStr: inst.dateStr, programId: p ? p.id : null }, arg = js(argO), go = 'event.stopPropagation();Workout.start(' + arg + ')';
    var goWarm = 'event.stopPropagation();Workout.start(' + js(Object.assign({ warm: true }, argO)) + ')';   // A10: warm-up focus path, identical to the notification warm action
    var cd = st === 'locked' ? '<div class="wk-card-cd">🔒 ' + (cdInHead ? '' : C.unlocks + ' ' + cdSpan)
      + '<button class="wk-card-link" onclick="' + go + '">' + cta(C.openNow) + '</button></div>' : '';
    setTimeout(ensureTicker, 0);
    // the hero (computed early so the states below can use it): the brief's today/next instance in a focus state
    var b = homeBrief(), isHero = b && b.instance && String(b.instance.routineId) === String(r.id) && b.instance.dt === inst.dateStr && (st === 'open' || st === 'locked' || st === 'progress' || st === 'done');
    // in-progress: the NEXT exercise still to do (from the draft)
    var nextExName = '';
    if (isHero && st === 'progress' && dft) { var xs = dft.s.exercises, from = dft.s.exIdx == null ? 0 : dft.s.exIdx; for (var qi = 1; qi <= xs.length; qi++) { var jj = (from + qi) % xs.length, ee = xs[jj]; if (!ee.skipped && ee.sets.length < ((ee.scheme && ee.scheme.sets) || 3)) { nextExName = ee.label; break; } } }
    var btn = st === 'tomorrow' || st === 'far' ? '<button class="wk-card-btn ghost wk-prep" onclick="' + go + '">' + cta(C.prepare) + '</button>'
      : st === 'open' ? '<button class="wk-card-btn primary" onclick="' + go + '">' + cta(C.start) + '</button>'
      : st === 'progress' ? '<button class="wk-card-btn primary" onclick="' + go + '">' + cta(C.resume) + '</button>' : '';
    // A9: דחייה / דלג are never a loud row — a quiet "⋯" options control in every non-done state holds them
    var opts = st !== 'done' ? '<details class="wk-card-opts" onclick="event.stopPropagation()"><summary aria-label="' + S.cardOpts + '">⋯</summary>'
      + '<div class="wk-card-menu"><button class="wk-card-link" onclick="event.stopPropagation();this.closest(\'details\').open=false;openPostpone(\'routine\',' + js(String(r.id)) + ',' + js(inst.dateStr) + ')">' + C.postpone + '</button>'
      + '<button class="wk-card-link" onclick="event.stopPropagation();this.closest(\'details\').open=false;skipRoutineInstance(' + js(String(r.id)) + ',' + js(inst.dateStr) + ')">' + C.skip + '</button></div></details>' : '';
    var sec = '';
    // A8: upcoming (tomorrow / far) cards speak the hero language — dark + gold hairline, facts-first title, time once, "הכן אותי" pill
    var isUp = st === 'tomorrow' || st === 'far', cc0 = cat();
    if (isUp) {
      var mus = d && d.exercises[0] ? muscleName(W.muscleKey(d.exercises[0], cc0)) : '';
      head = st === 'tomorrow' ? h(S.upTomorrow(mus)) : h(S.upInDays(num(W.daysBetween(W.ymdIn(new Date(now)), W.ymdIn(dt))), mus));
      var ue = d && d.exercises.filter(function (e) { var ll = lastOf(e.label); return ll && ll.sets.length; })[0], ul = ue && lastOf(ue.label);
      if (ul) data = S.upStart(h(ue.label) + ' ' + setTxt(ul.sets[0]));
    }
    // A10: the locked caption is a plain label (no time) — the time/countdown lives once in the headline + the 🔒 row, so no clock time is repeated
    var cap = isHero ? '<div class="wk-card-cap">' + h(st === 'done' ? S.sumT : C.todayCap) + '</div>' : '';
    var meta = isHero && (st === 'open' || st === 'locked') ? heroMeta(b) : '';
    if (isHero && st === 'progress' && b.workout) { var dn = dft ? dft.s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0) : 0, tot = Math.max(b.workout.sets, dn); meta = '<div class="wk-prog-row"><div class="wk-ring-badge" style="--f:' + (tot ? (dn / tot).toFixed(3) : 0) + '"><span><bdi dir="ltr">' + dn + '/' + tot + '</bdi></span></div>' + (nextExName ? '<div class="wk-card-next">' + C.nextExLabel(h(nextExName)) + '</div>' : '') + '</div>'; }
    // done: lead with the real volume + "מה הלאה"
    if (isHero && st === 'done' && done) { meta = '<div class="wk-card-vol"><b>' + num(Math.round(W.volume(done))) + '</b> ' + T.unit.kg + ' · ' + C.volumeWord + '</div>' + (d ? '<div class="wk-card-next">' + C.whatsNext(h(d.name)) + '</div>' : ''); }
    var warm = isHero && st === 'open' ? '<button class="wk-card-link wk-card-warm" onclick="' + goWarm + '">' + C.warmupLink + '</button>' : '';
    var sub = isHero ? heroSub(b) + '<div class="wk-hero-pad" aria-hidden="true"></div>' : '';
    // DONE = locked: no start action on the card (Workout.start refuses it too)
    return '<div class="wk-card wk-st-' + st + (isHero ? ' wk-hero' : '') + (isUp ? ' wk-up' : '') + '" data-wk-state="' + st + '"' + (st === 'done' ? '' : ' onclick="Workout.start(' + arg + ')"') + '>'
      + '<div class="wk-card-top"><span class="wk-card-tag">🏋️ ' + h(r.name || '') + '</span><span class="wk-card-top-r">' + (isHero && st === 'locked' ? '' : '<span class="wk-card-time">' + num(time) + '</span>') + opts + '</span></div>'
      + cap + '<div class="wk-card-h">' + head + '</div>' + (data ? '<div class="wk-card-d">' + data + '</div>' : '') + meta + cd + btn + warm + sec + '</div>' + sub;
  }
  // the card's copy variables: HTML-safe, numerals in <bdi dir=ltr>; only what the owner's own data has (missing = left out)
  function copyVars(st, r, inst, dt, dayName, d, dft, done, prs, now, cdSpan, unlockAt) {
    var tz = { timeZone: W.TZ }, hm = function (t) { return num(new Date(t).toLocaleTimeString('he-IL', Object.assign({ hour: '2-digit', minute: '2-digit', hour12: false }, tz))); };
    var v = { name: h(dayName), time: hm(dt.getTime()), unlock: hm(unlockAt), countdown: cdSpan, day: h(dt.toLocaleDateString('he-IL', Object.assign({ weekday: 'long' }, tz)).replace(/^יום\s+/, '')), n: num(W.daysBetween(W.ymdIn(new Date(now)), W.ymdIn(dt))) };
    var lastTxt = function (ex, sets) { return h(ex) + ' <bdi dir="ltr">' + h(sets.slice(0, 2).map(function (x) { return W.setText(x); }).join(', ')) + '</bdi>'; };
    if (st === 'done' && done) {
      v.duration = num(Math.max(1, Math.round((done.durationSec || 0) / 60))); v.sets = num(done.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0));
      if (prs[0]) v.pr = h(prs[0].label) + ' <bdi dir="ltr">' + (prs[0].kind === 'e1rm' ? '~' + h(prs[0].value) : h(prs[0].w == null ? prs[0].r : prs[0].w + '×' + prs[0].r)) + '</bdi>';
      var e0 = done.exercises[0]; if (e0 && e0.sets.length) v.last = lastTxt(e0.label, e0.sets);
    } else if (st === 'progress' && dft) {
      var s = dft.s, n = s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0), cx = s.exercises[s.exIdx] || s.exercises[0];
      v.elapsed = '<bdi dir="ltr" data-wk-el="' + s.startedAt + '">' + elMin(now - s.startedAt) + '</bdi> ' + S.minutes('').trim();
      v.sets = num(n); v.setN = num((cx ? cx.sets.length : 0) + 1); v.exN = num(s.exIdx + 1); v.exTotal = num(s.exercises.length);
    } else if (d) {
      var ex = d.exercises.filter(function (e) { var l = lastOf(e.label); return l && l.sets.length; })[0], l = ex && lastOf(ex.label);
      if (l) v.last = lastTxt(ex.label, l.sets);
    }
    return v;
  }
  // a stable variant per card + part (re-renders keep the same sentence); only fillable variants; never throws
  var cardIdx = {};
  function copyLine(key, list, vars) {
    var ok = W.fillable(list, vars); if (!ok.length) return '';
    var t = cardIdx[key] != null && ok.indexOf(list[cardIdx[key]]) > -1 ? list[cardIdx[key]] : CP.pick(ok, -1).text;
    cardIdx[key] = list.indexOf(t);
    try { return W.plural(CP.fill(t, vars)); } catch (_) { return ''; }
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
  // ── the notification journey: WkBrief gives the fire times, wk-copy the words, settings the on/off ──
  var KEY_NOTIF = 'vt_wk_notif';
  function readNotif() {
    var raw = load(KEY_NOTIF, null), p = raw && typeof raw === 'object' ? raw : {};
    var types = p.types && typeof p.types === 'object' ? p.types : {};
    var T6 = ['eveningBefore', 'morning', 'warmup', 'unlock', 'rescue', 'fridayTeaser', 'weeklyReview', 'backup'], t = {};
    T6.forEach(function (k) { t[k] = types[k] !== false; });
    var hm = function (s, d) { return /^\d\d:\d\d$/.test(s) ? s : d; };
    return { on: p.on !== false, evening: hm(p.evening, '20:00'), morning: hm(p.morning, '09:00'), review: hm(p.review, '20:00'), backup: hm(p.backup, '10:00'), types: t, muteDay: p.muteDay || null };
  }
  function setNotif(fn) { W.updateJSON(localStorage, KEY_NOTIF, {}, function (p) { p = p && typeof p === 'object' ? p : {}; fn(p); return p; }); }
  // ── B1b: insight suggestions added to the brief — reversible (undo toast) + removable anytime; NEVER auto-applied to any target ──
  var KEY_BRIEF = 'vt_wk_brief', lastBriefAdd = null;
  function briefAdds() { var a = load(KEY_BRIEF, []); return Array.isArray(a) ? a : []; }
  function briefKey(ac) { return ac.exercise + '|' + (ac.suggest ? (ac.suggest.w == null ? 'bw' : ac.suggest.w) + 'x' + ac.suggest.r : (ac.label || '')); }
  function inBrief(id) { return briefAdds().some(function (x) { return x.id === id; }); }
  function addToBrief(ac) {
    if (!ac || ac.kind !== 'addToBrief' || !ac.exercise) return;
    var id = briefKey(ac);
    W.updateJSON(localStorage, KEY_BRIEF, [], function (a) { a = Array.isArray(a) ? a : []; if (!a.some(function (x) { return x.id === id; })) a.push({ id: id, exercise: ac.exercise, suggest: ac.suggest || null, label: ac.label || '', at: Date.now() }); return a; });
    lastBriefAdd = id;
    try { if (typeof toast === 'function') toast(h(S.addedBrief) + ' · <button class="wk-toast-undo" onclick="WorkoutHome.briefUndo()">' + h(S.briefUndo) + '</button>', 5000); } catch (_) { }
    try { if (typeof refreshAll === 'function') refreshAll(); } catch (_) { }
  }
  function briefUndo() { if (lastBriefAdd) { var id = lastBriefAdd; lastBriefAdd = null; removeFromBrief(id); try { if (typeof closeToast === 'function') closeToast(); } catch (_) { } } }
  function removeFromBrief(id) { W.updateJSON(localStorage, KEY_BRIEF, [], function (a) { return (Array.isArray(a) ? a : []).filter(function (x) { return x.id !== id; }); }); try { if (typeof refreshAll === 'function') refreshAll(); } catch (_) { } }
  // ── B2: the insights screen (entry: the home "שיא" fact card + the workouts menu; nav is NOT restructured) ──
  var insActions = {};
  function insightsData() { try { return window.WkInsights ? window.WkInsights.compute(sessions(), Date.now(), { tz: W.TZ, catalog: cat() }) : null; } catch (_) { return null; } }
  function sparkSvg(spark) {
    if (!spark || spark.length < 2) return '';
    var w = 240, hg = 84, pad = 8, min = Math.min.apply(null, spark), max = Math.max.apply(null, spark), rng = max - min || 1;
    var xs = spark.map(function (v, i) { return pad + i * (w - 2 * pad) / (spark.length - 1); });
    var ys = spark.map(function (v) { return hg - pad - (v - min) / rng * (hg - 2 * pad); });
    var line = xs.map(function (x, i) { return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1); }).join(' ');
    var area = 'M' + xs[0].toFixed(1) + ' ' + (hg - pad) + ' ' + xs.map(function (x, i) { return 'L' + x.toFixed(1) + ' ' + ys[i].toFixed(1); }).join(' ') + ' L' + xs[xs.length - 1].toFixed(1) + ' ' + (hg - pad) + ' Z';
    return '<svg class="wk-spark" viewBox="0 0 ' + w + ' ' + hg + '" preserveAspectRatio="none" aria-hidden="true">'
      + '<path class="wk-spark-fill" d="' + area + '"/><path class="wk-spark-line" d="' + line + '"/>'
      + '<circle class="wk-spark-dot" cx="' + xs[xs.length - 1].toFixed(1) + '" cy="' + ys[ys.length - 1].toFixed(1) + '" r="4"/></svg>';
  }
  function insightCard(ins) {
    var label = (S.insLabel && S.insLabel[ins.type]) || ins.type, act = '';
    if (ins.action && ins.action.kind === 'addToBrief') {
      var id = briefKey(ins.action); insActions[id] = ins.action;
      act = '<div class="wk-ins-acts">' + (inBrief(id)
        ? '<button class="wk-ins-btn" onclick="WorkoutHome.removeFromBrief(' + js(id) + ');WorkoutHome.openInsights()">' + h(S.removeBrief) + '</button>'
        : '<button class="wk-ins-btn primary" onclick="WorkoutHome.addToBriefById(' + js(id) + ')">' + h(S.addBrief) + '</button>') + '</div>';
    }
    return '<div class="wk-ins-card wk-ins-' + ins.type + '"><div class="wk-ins-tag">' + h(label) + '</div>'
      + '<div class="wk-ins-h">' + h(ins.headline) + '</div><div class="wk-ins-d">' + h(ins.detail) + '</div>' + act + '</div>';
  }
  function insightsHtml() {
    insActions = {};
    var head = '<div class="wk-ins-top"><button class="wk-ins-x" aria-label="' + h(S.insClose) + '" onclick="WorkoutHome.closeInsights()">✕</button></div>';
    if (!enabled()) return head;
    var hasProg = allRoutines().some(function (r) { return r.kind === 'workout' && programById(r.programId); });
    if (!hasProg) return head + '<div class="wk-ins-cap">' + h(S.insTitle) + '</div><div class="wk-ins-title">' + h(S.insNeutral) + '</div><div class="wk-ins-empty">' + h(S.insNoProg) + '</div>';
    var r = insightsData(); if (!r || r.error) return head + '<div class="wk-ins-title">' + h(S.insNeutral) + '</div>';
    var test = prefs().testMode ? '<div class="wk-ins-note">' + h(S.insTestNote) + '</div>' : '';
    var cap = '<div class="wk-ins-cap">' + h(S.insWeek(r.week)) + '</div>';
    if (r.empty) return head + cap + '<div class="wk-ins-title">' + h(S.insNeutral) + '</div>' + test + '<div class="wk-ins-empty">' + h(S.insEmpty(r.needMore)) + '</div>';
    var top = r.insights[0], title = top ? top.headline : S.insNeutral;
    var trend = r.insights.filter(function (i) { return i.type === 'trend'; })[0];
    var trendCard = trend ? '<div class="wk-ins-trend"><div class="wk-ins-trend-h">' + h(S.insTrendT) + ' · ' + h(trend.exercise) + '</div>'
      + '<div class="wk-ins-trend-pct">' + h((trend.pct >= 0 ? '+' : '') + trend.pct + '%') + '</div>'
      + sparkSvg(trend.spark) + '<div class="wk-ins-trend-ev" aria-label="' + h(trend.evidence) + '">' + h(trend.evidence) + '</div></div>' : '';
    var cards = r.insights.filter(function (i) { return i.type !== 'trend'; }).map(insightCard).join('');
    return head + cap + '<div class="wk-ins-title">' + h(title) + '</div>' + test + trendCard + cards;
  }
  function openInsights() {
    var el = $('wkInsights'); if (!el) { el = document.createElement('div'); el.id = 'wkInsights'; el.className = 'wk-ins'; el.setAttribute('dir', 'rtl'); el.setAttribute('role', 'dialog'); document.body.appendChild(el); }
    el.innerHTML = insightsHtml(); el.classList.add('on');
  }
  function closeInsights() { var el = $('wkInsights'); if (el) el.classList.remove('on'); }
  function addToBriefById(id) { var a = insActions[id]; if (a) { addToBrief(a); openInsights(); } }
  // one notify string: the first variant whose placeholders the vars fill (the plain fallback always qualifies)
  function fillNotify(type, part, vars, seed) {
    var list = CP && CP.COPY.notify[type] && CP.COPY.notify[type][part]; if (!list) return '';
    var ok = W.fillable(list, vars); if (!ok.length) return '';
    var rich = ok.filter(function (t) { return /\{/.test(t); });          // facts-first: a fact-bearing variant wins; the plain fallback only when none fills
    var t = CP.pick(rich.length ? rich : ok, -1).text;
    try { return W.plural(CP.fill(t, vars)); } catch (_) { return ''; }
  }
  // the filled push entries for the next window: {id,title,body,fireAt(ISO),payload}. The push server never sees this data.
  function notifs(now, winMs) {
    now = now || Date.now(); var cfg = readNotif(); if (!cfg.on || !enabled()) return [];
    var b = homeBrief(); if (!b || !b.notifications.length) return [];
    var tz = W.TZ, out = [];
    b.notifications.forEach(function (n) {
      if (n.fireAt <= now || (winMs && n.fireAt > now + winMs) || cfg.types[n.type] === false) return;
      if (cfg.muteDay && W.ymdIn(new Date(n.fireAt)) === cfg.muteDay) return;   // "השתק את היום" silences the rest of that day
      var vars = notifVars(b, n, tz), ds = n.instance ? n.instance.dt : n.type, seed = n.type + '|' + ds;
      var title = fillNotify(n.type, 'title', vars, seed), body = fillNotify(n.type, 'body', vars, seed);
      if (!title && !body) return;
      var rid = n.instance ? n.instance.routineId : '', id = 'wk_' + n.type + '_' + rid + '_' + ds;
      // deep-link target: an instance -> the ready screen; weeklyReview -> insights; backup -> the export (B3/B4)
      var pid = n.instance ? rid + '__' + ds : (n.type === 'weeklyReview' ? 'insights' : n.type === 'backup' ? 'backup' : '');
      out.push({ id: id, title: title, body: body, fireAt: new Date(n.fireAt).toISOString(),
        payload: { type: 'workout', id: pid, stage: n.type, warm: n.type === 'warmup' } });
    });
    return out;
  }
  function notifVars(b, n, tz) {
    var f = b.facts, t = b.targets || {}, w = b.workout || {}, v = {};
    if (n.muscle) v.muscle = muscleName(n.muscle);
    if (f.streakWeeks > 0) v.streak = num(f.streakWeeks);
    if (w.mins) v.mins = num(w.mins);
    if (w.exercises) v.n = num(w.exercises);
    if (n.instance) v.time = num(new Date(n.instance.dt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }));
    if (t.exercise) v.exercise = h(t.exercise);
    if (t.lastKg != null) v.lastKg = num(t.lastKg);
    if (t.lastReps != null) v.lastReps = num(t.lastReps);
    if (t.targetKg != null) v.targetKg = num(t.targetKg);
    if (f.weekPlanned > 0) { v.done = num(f.weekDone); v.planned = num(f.weekPlanned); }
    // B3 weekly review: {n} workouts this week, {x} PRs this week, {insight} = the top real insight
    if (n.type === 'weeklyReview') {
      var all2 = sessions(), wr2 = W.weekRange(new Date(Date.now())), prs = 0, wdone = 0;
      all2.forEach(function (s) { if (!s || s.test || s.source === 'test') return; var d = s.dateStr || s.date; if (d >= wr2.start && d <= wr2.end) { wdone++; prs += (W.prsFor(s, all2.filter(function (p) { return p.id !== s.id && (p.dateStr || p.date) <= d; })) || []).length; } });
      v.n = num(wdone); v.x = num(prs);
      try { var ti = window.WkInsights && WkInsights.top(all2, Date.now(), { tz: tz, catalog: cat() }); if (ti && ti.headline) v.insight = h(ti.headline); } catch (_) { }
    }
    // {hint}: a near-PR beats the plain plan line; only when its own placeholders are present
    if (f.nearPR && t.exercise) v.hint = 'שיא אפשרי ב' + h(t.exercise);
    else if (w.mins && w.exercises) v.hint = W.plural(num(w.mins) + ' דק׳, ' + num(w.exercises) + ' תרגילים');
    return v;
  }
  // a notification tap: open the ready screen preloaded (never auto-start); "warm" focuses the warm-up; "mute" silences today
  function openFromNotif(routineId, dateStr, action) {
    if (action === 'mute') { setNotif(function (p) { p.muteDay = W.ymdIn(new Date()); }); return; }
    if (!routineId) return;                                               // a non-instance notice (Friday) just opens the app (the hero is there)
    try { if (window.Workout) window.Workout.start({ routineId: String(routineId), dateStr: dateStr || null, warm: action === 'warm' }); } catch (_) { }
  }
  // one extra line in the greeting area on a workout day
  // A10b: the "no program" and "rest day" hero states, in the same language. '' when today has a workout (a normal card renders).
  function heroState() {
    if (!enabled()) return '';
    var wr = allRoutines().filter(function (r) { return r.enabled !== false && r.kind === 'workout'; }); if (!wr.length) return '';
    var hasProg = wr.some(function (r) { return programById(r.programId); });
    if (!hasProg) return '<div class="wk-card wk-hero wk-state-empty" data-wk-state="noprogram"><div class="wk-card-cap">' + C.todayCap + '</div><div class="wk-card-h">' + S.noProgT + '</div><div class="wk-card-d">' + S.noProgSub + '</div><button class="wk-card-btn ghost wk-prep" onclick="event.stopPropagation();WorkoutLive.openPrograms()">' + S.noProgCta + '</button></div>';
    var b = homeBrief();
    if (b && b.phase === 'rest' && b.instance) {
      var mus = b.workout && b.workout.muscles && b.workout.muscles[0] ? muscleName(b.workout.muscles[0]) : '';
      var when = num(new Date(b.instance.dt).toLocaleDateString('he-IL', { weekday: 'long', timeZone: W.TZ }).replace(/^יום\s+/, '') + ' ' + new Date(b.instance.dt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: W.TZ }));
      return '<div class="wk-card wk-hero wk-state-rest" data-wk-state="restday"><div class="wk-card-cap">' + C.todayCap + '</div><div class="wk-card-h">' + h(S.restDayT(mus)) + '</div><div class="wk-card-d">' + S.restDaySub(when) + '</div></div>';
    }
    return '';
  }
  function greeting(subEl) {
    var old = $('wkGreet'); if (old) old.remove(); var oh = $('wkHeroState'); if (oh) oh.remove();
    if (!enabled() || !subEl) return;
    var hs = heroState(); if (hs) { var hel = document.createElement('div'); hel.id = 'wkHeroState'; hel.dir = 'rtl'; hel.innerHTML = hs; var list = document.getElementById('list'); if (list) list.parentNode.insertBefore(hel, list); }
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
    if (isStart) { if (!readDraft()) { var lk = lockFor({}); if (lk.blocked) return { say: lk.line }; } return { say: st.programs.length ? S.asstStart : S.asstNone, go: function () { start({}); } }; }
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
    typeW: typeW, typeWOk: typeWOk, setStep: setStep, addPart: addPart, removePart: removePart, swapOpen: swapOpen, swapRemember: swapRemember, swapAdd: swapAdd, swapTo: swapTo,
    noteOpen: noteOpen, noteSave: noteSave, exNote: exNote,
    restAdj: restAdj, restSkip: restSkip, warm: warm, addPick: addPick, addEx: addEx, finishOpen: finishOpen, effort: effort, saveWorkout: saveWorkout, backToLive: backToLive,
    saveOld: saveOld, delOld: delOld, hideBanner: hideBanner, pickClose: pickClose, completeRoutine: completeRoutine, suggestMode: suggestMode,
    warmEdit: warmEdit, warmSave: warmSave, readyWarm: readyWarm, readyEdit: readyEdit, openPrograms: openPrograms, notifSet: notifSet, coachHide: coachHide, menuOpen: menuOpen, setMode: setMode, togglePref: togglePref, soundTest: soundTest, hapticTest: hapticTest, hasTestDraft: hasTestDraft,
    conflict: conflict, cancelWorkout: cancelWorkout, sameAsLast: sameAsLast, peek: peek, undoSet: undoSet, finishAsk: finishAsk, nextEx: nextEx,
    testOn: function () { return enabled() && prefs().testMode; }, setTestMode: function (v) { setPref('testMode', !!v); var s = $('wkSheet'); if (s && s.classList.contains('on') && window.Workout) window.Workout.open(); },
    showPR: showPR, hidePR: hidePR, state: function () { return state ? copy(state) : null; }, mode: function () { return isOpen() ? ui.mode : null; } };
  // Settings: ONE row "מצב בדיקת אימון" in the existing settings sheet (existing settings-row + rtoggle components)
  function injectSettings() {
    if ($('wkTestRow') || !enabled()) return;
    var lm = $('lightModeToggle'), cards = lm && lm.closest('.settings-cards'); if (!cards) return;
    var sec = document.createElement('div'); sec.className = 'settings-section'; sec.textContent = S.settingsSection;
    var box = document.createElement('div'); box.className = 'settings-cards'; box.id = 'wkTestRow';
    box.innerHTML = '<div class="settings-row"><div class="settings-row-ico wk-set-ico">🧪</div><div class="settings-row-body"><div class="settings-row-title">' + S.testMode + '</div><div class="settings-row-sub">' + S.testModeSub + '</div></div>'
      + '<label class="rtoggle"><input type="checkbox" id="wkTestToggle"' + (prefs().testMode ? ' checked' : '') + ' onchange="WorkoutLive.setTestMode(this.checked)"><span class="rtoggle-sl"></span></label></div>';
    cards.parentNode.insertBefore(box, cards.nextSibling); cards.parentNode.insertBefore(sec, box);
    // "התראות אימון": a master toggle, the two main times, per-type toggles
    var nsec = document.createElement('div'); nsec.className = 'settings-section'; nsec.textContent = S.notifSection;
    var nbox = document.createElement('div'); nbox.className = 'settings-cards'; nbox.id = 'wkNotifBox';
    box.parentNode.insertBefore(nbox, box.nextSibling); box.parentNode.insertBefore(nsec, nbox);
    renderNotifBox();
  }
  var NOTIF_TYPES = ['eveningBefore', 'morning', 'warmup', 'unlock', 'rescue', 'fridayTeaser'];
  function renderNotifBox() {
    var nbox = $('wkNotifBox'); if (!nbox) return; var c = readNotif();
    var row = function (title, sub, ctrl) { return '<div class="settings-row"><div class="settings-row-body"><div class="settings-row-title">' + title + '</div>' + (sub ? '<div class="settings-row-sub">' + sub + '</div>' : '') + '</div>' + ctrl + '</div>'; };
    var toggle = function (on, fn) { return '<label class="rtoggle"><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="' + fn + '"><span class="rtoggle-sl"></span></label>'; };
    var html = '<div class="settings-row"><div class="settings-row-ico wk-set-ico">🔔</div><div class="settings-row-body"><div class="settings-row-title">' + S.notifOnT + '</div><div class="settings-row-sub">' + S.notifOnSub + '</div></div>' + toggle(c.on, 'WorkoutLive.notifSet(\'on\',this.checked)') + '</div>';
    if (c.on) {
      // the evening / morning time chip lives INSIDE its own toggle row (no duplicated rows)
      var timeFor = function (k) { return k === 'eveningBefore' ? '<input type="time" class="wk-time" value="' + c.evening + '" onchange="WorkoutLive.notifSet(\'evening\',this.value)" onclick="event.stopPropagation()">' : k === 'morning' ? '<input type="time" class="wk-time" value="' + c.morning + '" onchange="WorkoutLive.notifSet(\'morning\',this.value)" onclick="event.stopPropagation()">' : ''; };
      html += NOTIF_TYPES.map(function (k) { return row(S.notifType[k], '', timeFor(k) + toggle(c.types[k] !== false, 'WorkoutLive.notifSet(\'t:' + k + '\',this.checked)')); }).join('');
    }
    nbox.innerHTML = html;
  }
  function notifSet(key, val) {
    setNotif(function (p) {
      if (key === 'on') p.on = !!val;
      else if (key === 'evening' || key === 'morning') { if (/^\d\d:\d\d$/.test(val)) p[key] = val; }
      else if (key.slice(0, 2) === 't:') { p.types = p.types || {}; p.types[key.slice(2)] = !!val; }
    });
    renderNotifBox();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectSettings); else injectSettings();
  window.WorkoutHome = { card: card, greeting: greeting, heroState: heroState, assistant: assistant, tick: homeTick, notifs: notifs, openFromNotif: openFromNotif, readNotif: readNotif, setNotif: setNotif,
    addToBrief: addToBrief, briefUndo: briefUndo, removeFromBrief: removeFromBrief, briefAdds: briefAdds, inBrief: inBrief, briefKey: briefKey,
    openInsights: openInsights, closeInsights: closeInsights, addToBriefById: addToBriefById };
  window.WorkoutForm = { fill: formFill, apply: formApply, kind: formKind, pick: formPick, choose: formChoose };
})();
