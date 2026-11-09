// WorkoutLive: the program setup and the LIVE workout screen (#wkLive). Targets, rest and the reducer live in workout-core.js (WCore).
// State = an action log replayed by WCore.replay; the draft (vt_wk_draft) is saved after EVERY action, so a killed app resumes.
// Storage (all OPTIONAL keys): vt_wk_programs, vt_wk_draft; a finished workout is appended to vt_wk_sessions. Kill switch: vt_wk_off = '1'.
// Never touches routines, completion or the calendar.
(function () {
  'use strict';
  var W = window.WCore, KEY_P = 'vt_wk_programs', KEY_D = 'vt_wk_draft', KEY_S = 'vt_wk_sessions', KEY_OFF = 'vt_wk_off', KEY_HINT = 'vt_wk_wakehint';
  var STALE_MS = 6 * 3600e3, RING = 552.92;
  var $ = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ── every Hebrew string, in ONE table (masculine, warm, short; never guilt) ──
  var S = {
    preset: 'פול בודי · פירמידה יורדת',
    setup: 'הגדרת תוכנית', progName: 'שם התוכנית', exName: 'שם התרגיל', equipT: 'ציוד', step: 'קפיצה', startW: 'משקל התחלה לסט הראשון',
    schemeT: 'סטים וטווחים', setsN: 'סטים', setN: function (i) { return 'סט ' + i; }, remove: 'הסר', addEx: '+ תרגיל', newEx: 'תרגיל חדש',
    saveStart: 'שמור והתחל', save: 'שמור', cancel: 'ביטול', needName: 'לכל תרגיל צריך שם',
    equip: { dumbbell: 'משקולות יד', barbell: 'מוט', machine: 'מכונה', cable: 'כבל', bodyweight: 'משקל גוף' },
    unit: { kg: 'ק״ג', plates: 'פלטות' }, reps: 'חזרות', perHand: 'לכל יד',
    target: 'יעד', lastTime: 'בפעם שעברה', first: 'פעם ראשונה, מתחילים מהמשקל שהגדרת',
    st: { below: 'מתחת לטווח', 'in': 'בטווח', above: 'מעל הטווח' },
    done: '✓', doneLbl: 'סיימתי סט', rest: 'מנוחה', skipRest: 'דלג',
    addSet: '+ סט', skipEx: 'דלג על התרגיל', addExLive: '+ תרגיל', undo: '↶ בטל', finish: 'סיים אימון', allDone: 'זה הכל להיום. כל הכבוד.',
    edit: 'עריכה', del: 'מחק', keep: 'שמור', add: 'הוסף', locker: function (n) { return 'תא ' + n; }, lockerT: 'תא ציוד', noLocker: 'אין',
    wake: 'השאר את המסך דולק', memFull: 'הזיכרון מלא. האימון נשמר רק כאן עד שתסיים',
    leave: 'לצאת? האימון נשמר, ותוכל להמשיך מאיפה שעצרת.', noSets: 'עוד לא נרשם אף סט. לסגור בלי לשמור?',
    sumT: 'סיכום', duration: 'משך', setsDone: function (n) { return n === 1 ? 'סט אחד' : n + ' סטים'; }, effort: 'כמה קשה היה?',
    back: 'חזרה לאימון', saveW: 'שמור אימון', existsQ: 'כבר שמרת היום אימון כזה', replace: 'החלף את הקיים', both: 'שמור את שניהם',
    saveErr: 'לא הצלחתי לשמור, אין מקום בזיכרון. האימון עדיין כאן',
    cmpFirst: 'פעם ראשונה', cmpSame: 'כמו בפעם שעברה', cmpKg: function (d, u) { return (d > 0 ? '+' : '') + d + ' ' + u; },
    cmpReps: function (d) { return d > 0 ? '+' + (d === 1 ? 'חזרה אחת' : d + ' חזרות') : (d === -1 ? 'חזרה אחת פחות' : -d + ' חזרות פחות'); },
    open: 'יש אימון פתוח', resume: 'המשך', saveOld: 'שמור', delOld: 'מחק', delConfirm: 'למחוק את האימון הפתוח?', hide: 'סגור'
  };
  var EQUIP_ORDER = ['dumbbell', 'barbell', 'machine', 'cable', 'bodyweight'];
  var START_W = { dumbbell: 10, barbell: 20, machine: 4, cable: 15, bodyweight: null };
  var PYR = function () { return { sets: 3, ranges: [[4, 6], [6, 10], [10, 15]], drop: 0.2 }; };

  // ── storage (never throws; a full storage keeps the workout in memory) ──
  function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (_) { return def; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  function drop(k) { try { localStorage.removeItem(k); } catch (_) { } }
  function enabled() { try { return localStorage.getItem(KEY_OFF) !== '1'; } catch (_) { return true; } }

  // ── program ──
  var uid = (function () { var last = 0; return function (p) { last = Math.max(Date.now(), last + 1); return p + last.toString(36); }; })();
  function mkEx(label, equip, muscle) { var q = W.EQUIP[equip]; return { id: uid('e'), label: label, muscle: muscle || null, equip: equip, unit: q.unit, step: q.step, scheme: PYR(), startW: START_W[equip] }; }
  function preset() {
    return { id: uid('p'), name: S.preset, exercises: [mkEx('מתח', 'bodyweight', 'back'), mkEx('חזה', 'dumbbell', 'chest'), mkEx('כתפיים', 'dumbbell', 'shoulders'),
      mkEx('יד קדמית', 'dumbbell', 'biceps'), mkEx('יד אחורית', 'dumbbell', 'triceps'), mkEx('רגליים', 'machine', 'legs')] };
  }
  function program() { var p = load(KEY_P, null); return p && p.programs && p.programs.length ? p.programs.filter(function (x) { return x.id === p.activeId; })[0] || p.programs[0] : null; }

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
  var ui = { mode: 'live', view: 0, pend: {}, extra: {}, editing: null, prog: null, from: 'start', memOnly: false, effort: null, locker: null, exists: false, err: '', chimed: 0, add: null, wakeHint: false, lastTap: 0 };
  var timer = null, wake = null;

  // ── sessions / history ──
  var sessions = function () { return load(KEY_S, []); };
  var tomorrow = function () { return W.addDaysYmd(W.ymdIn(new Date()), 1); };
  function lastOf(label) { return W.lastTimeBefore(sessions(), label, tomorrow()); }
  var unitTxt = function (ex) { return ex.unit === 'plates' ? S.unit.plates : ex.unit === 'kg' ? S.unit.kg : ''; };
  var num = function (n) { return '<bdi dir="ltr">' + h(n) + '</bdi>'; };
  var setTxt = function (x) { return '<bdi dir="ltr">' + (x.w == null ? x.r : h(x.w) + '×' + x.r) + '</bdi>'; };
  var isBw = function (ex) { return ex.equip === 'bodyweight' || !ex.step; };
  var exDone = function (ex) { return ex.skipped || ex.sets.length >= ((ex.scheme && ex.scheme.sets) || 3); };
  var clock = function (sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60, hh = Math.floor(m / 60); return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

  // ── shell ──
  function ensure() {
    if ($('wkLive')) return;
    var el = document.createElement('div');
    el.id = 'wkLive'; el.className = 'wk-live'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.dir = 'rtl';
    el.innerHTML = '<div class="wk-lv-head"><button class="wk-lv-x" onclick="WorkoutLive.close()" aria-label="' + S.hide + '">✕</button><div class="wk-lv-name" id="wkLvName"></div><div class="wk-lv-el" id="wkLvEl"></div></div>'
      + '<div class="wk-lv-prog" id="wkLvProg"></div><div class="wk-lv-main" id="wkLvMain"></div><div class="wk-lv-dock" id="wkLvDock"></div>';
    document.body.appendChild(el);
    el.addEventListener('pointerdown', onPress);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { document.addEventListener(t, stopRepeat, true); });
  }
  function show() {
    ensure(); $('wkLive').classList.add('on'); document.body.classList.add('wk-lock');
    render(); startTimer();
  }
  function hide() {
    var el = $('wkLive'); if (el) el.classList.remove('on'); document.body.classList.remove('wk-lock');
    stopTimer(); releaseWake(); stopRepeat();
  }

  // ── entry points ──
  function start() {
    if (!enabled()) return;
    audio(true);
    var r = readDraft();
    if (r) { draft = r.d; state = r.s; ui.mode = 'live'; ui.view = state.exIdx; ui.pend = {}; ui.extra = {}; ui.editing = null; acquireWake(); hideBanner(); show(); return; }
    var p = program();
    if (!p) { setup('start'); return; }
    begin(p);
  }
  function begin(p) {
    var lk = null, prev = W.sortRecent(sessions()).filter(function (s) { return s.type === p.name && s.locker != null; })[0];
    if (prev) lk = prev.locker;
    draft = { v: 1, program: JSON.parse(JSON.stringify(p)), startedAt: Date.now(), actions: [] };
    dispatch({ type: 'START', program: draft.program, locker: lk, at: draft.startedAt });
    ui.mode = 'live'; ui.view = 0; ui.pend = {}; ui.extra = {}; ui.editing = null; ui.effort = null; ui.exists = false; ui.err = ''; ui.chimed = 0;
    acquireWake(); hideBanner(); show();
  }
  function setup(from) {
    if (!enabled()) return;
    ui.from = from || 'edit'; ui.prog = JSON.parse(JSON.stringify(program() || preset())); ui.mode = 'setup'; ui.err = '';
    show();
  }
  function close() {
    if (ui.mode === 'setup') { if (ui.from === 'resume') { ui.mode = 'live'; render(); return; } hide(); refreshSheet(); return; }
    if (ui.mode === 'add' || ui.mode === 'finish') { ui.mode = 'live'; render(); return; }
    var logged = state && state.exercises.some(function (e) { return e.sets.length; });
    if (logged) { if (!confirm(S.leave)) return; }
    else { drop(KEY_D); draft = null; state = null; }
    hide(); refreshSheet(); banner();
  }
  function refreshSheet() { var s = $('wkSheet'); if (s && s.classList.contains('on') && window.Workout) window.Workout.open(); }

  // ── setup editing ──
  function pEx(i) { return ui.prog.exercises[i]; }
  function setName(v) { ui.prog.name = v; }
  function setExName(i, v) { pEx(i).label = v; }
  function setEquip(i, eq) { var e = pEx(i), q = W.EQUIP[eq]; e.equip = eq; e.unit = q.unit; e.step = q.step; e.startW = START_W[eq]; render(); }
  function addProgEx() { ui.prog.exercises.push(mkEx('', 'dumbbell', null)); render(); var b = $('wkPe_' + (ui.prog.exercises.length - 1)); if (b) b.focus(); }
  function removeProgEx(i) { ui.prog.exercises.splice(i, 1); render(); }
  function toggleScheme(i) { pEx(i)._open = !pEx(i)._open; render(); }
  function saveSetup() {
    var p = ui.prog;
    if (!p.exercises.length || p.exercises.some(function (e) { return !String(e.label || '').trim(); })) { ui.err = S.needName; render(); return; }
    p.name = String(p.name || '').trim() || S.preset;
    p.exercises.forEach(function (e) { delete e._open; e.label = e.label.trim(); });
    put(KEY_P, { v: 1, activeId: p.id, programs: [p] });
    if (ui.from === 'start') { begin(p); return; }
    if (ui.from === 'resume') { ui.mode = 'live'; render(); return; }
    hide(); refreshSheet();
  }

  // ── steppers: data-k = what, data-d = direction; long-press repeats ──
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
  function bump(k, d) {
    var p = k.split(':'), what = p[0];
    if (what === 'w' || what === 'r') {                                  // the active set (or the set being edited)
      var c = ui.editing || cur(), ex = state.exercises[c.ex];
      if (what === 'w') c.w = W.snap(Math.max(ex.step, (c.w || 0) + d * ex.step), ex.step); else c.r = clamp((c.r || 0) + d, 0, 99);
      var tw = $('wkLvW'), tr = $('wkLvR'); if (tw) tw.textContent = c.w; if (tr) tr.textContent = c.r;
      return;
    }
    if (what === 'lk') { ui.locker = ui.locker == null ? 1 : clamp(ui.locker + d, 0, 999); if (ui.locker === 0) ui.locker = null; var tl = $('wkLvLk'); if (tl) tl.textContent = ui.locker == null ? S.noLocker : ui.locker; return; }
    var e = pEx(+p[1]), id = 'wkPs_' + k.replace(/:/g, '_'), v;
    if (what === 'step') { var steps = [0.5, 1, 1.25, 2, 2.5, 5]; v = steps[clamp(steps.indexOf(e.step) + d, 0, steps.length - 1)]; e.step = v; }
    else if (what === 'sw') { v = e.startW = W.snap(Math.max(e.step, (e.startW || 0) + d * e.step), e.step); }
    else if (what === 'sets') { var sc = e.scheme; sc.sets = clamp(sc.sets + d, 1, 6); while (sc.ranges.length < sc.sets) sc.ranges.push(sc.ranges[sc.ranges.length - 1].slice()); sc.ranges.length = sc.sets; stopRepeat(); render(); return; }
    else if (what === 'lo' || what === 'hi') { var rg = e.scheme.ranges[+p[2]], j = what === 'lo' ? 0 : 1; rg[j] = clamp(rg[j] + d, 1, 50); if (rg[0] > rg[1]) rg[1 - j] = rg[j]; v = rg[0] + '-' + rg[1]; id = 'wkPs_rg_' + p[1] + '_' + p[2]; }
    var t = $(id); if (t) t.textContent = v;
  }

  // ── the current (active) set of the viewed exercise ──
  function targets(i) { var ex = state.exercises[i], l = lastOf(ex.label); return W.targetsFor(ex, l && l.sets, ex.sets); }
  function cur() {
    var i = ui.view, ex = state.exercises[i], slot = ex.sets.length, key = i + ':' + slot;
    if (!ui.pend[key]) { var t = targets(i), tg = t[Math.min(slot, t.length - 1)], prevSet = ex.sets[slot - 1]; ui.pend[key] = { ex: i, w: tg.w != null ? tg.w : (prevSet && prevSet.w) || null, r: tg.aim }; }
    return ui.pend[key];
  }

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
  function addOpen() { ui.add = { label: '', equip: 'dumbbell' }; ui.mode = 'add'; render(); var b = $('wkAddName'); if (b) b.focus(); }
  function addName(v) { ui.add.label = v; }
  function addEquip(eq) { ui.add.equip = eq; render(); }
  function addSave() {
    var a = ui.add; if (!String(a.label).trim()) { var b = $('wkAddName'); if (b) b.focus(); return; }
    var q = W.EQUIP[a.equip];
    dispatch({ type: 'ADD_EXERCISE', exercise: { id: uid('e'), label: a.label.trim(), equip: a.equip, unit: q.unit, step: q.step, scheme: PYR(), startW: START_W[a.equip] } });
    ui.mode = 'live'; ui.view = state.exIdx; render();
  }
  function finishOpen() {
    var logged = state.exercises.some(function (e) { return e.sets.length; });
    if (!logged) { if (confirm(S.noSets)) { drop(KEY_D); draft = null; state = null; hide(); refreshSheet(); banner(); } return; }
    ui.mode = 'finish'; ui.locker = state.locker; ui.exists = false; ui.err = ''; render();
  }
  function effort(n) { ui.effort = n; render(); }
  function saveWorkout(how) {
    // FINISH is applied in memory only: the draft stays until the session is really stored (no data loss if the app dies here)
    var fin = W.reduce(state, { type: 'FINISH', at: Math.max(Date.now(), state.lastAt || 0), effort: ui.effort });
    var s = W.sessionFromLive(fin); s.locker = ui.locker; s.hash = W.hashOf(s);
    var all = sessions(), same = all.filter(function (x) { return x.date === s.date && x.type === s.type; });
    if (same.length && !how) { ui.exists = true; render(); return; }
    var now = new Date().toISOString(), rec = Object.assign({ id: uid('w'), createdAt: now, updatedAt: now, routineId: null, instanceId: null }, s);
    if (how === 'replace') { var idx = all.indexOf(same[0]); rec.id = same[0].id; rec.createdAt = same[0].createdAt || now; all[idx] = rec; }
    else all.push(rec);
    if (!put(KEY_S, all)) { ui.err = S.saveErr; render(); return; }
    drop(KEY_D); draft = null; state = null; ui.mode = 'live';
    hide(); banner();
    if (window.Workout) window.Workout.open();
  }
  function backToLive() { ui.mode = 'live'; render(); }

  // ── render: ONE function into a few containers ──
  function render() {
    if (!$('wkLive')) return;
    var head = $('wkLvName'), el = $('wkLvEl'), prog = $('wkLvProg'), main = $('wkLvMain');
    $('wkLive').setAttribute('data-mode', ui.mode);
    if (ui.mode === 'setup') { head.textContent = S.setup; el.textContent = ''; prog.innerHTML = ''; main.innerHTML = setupHtml(); renderDock(); return; }
    head.innerHTML = h(state.program.name) + (state.locker != null ? '<span class="wk-lv-lk">' + S.locker(state.locker) + '</span>' : '');
    prog.innerHTML = state.exercises.map(function (e, i) {
      var n = (e.scheme && e.scheme.sets) || 3, f = e.skipped ? 1 : Math.min(1, e.sets.length / n);
      return '<button class="wk-seg' + (i === ui.view ? ' on' : '') + (e.skipped ? ' skip' : '') + '" onclick="WorkoutLive.view(' + i + ')" aria-label="' + h(e.label) + '"><i style="width:' + Math.round(f * 100) + '%"></i></button>';
    }).join('');
    main.innerHTML = ui.mode === 'finish' ? finishHtml() : ui.mode === 'add' ? addHtml() : liveHtml();
    renderDock(); tick();
  }
  function chips(sel, on, fn) { return '<div class="wk-chips">' + EQUIP_ORDER.map(function (k) { return '<button class="wk-chip' + (sel === k ? ' on' : '') + '" onclick="' + fn(k) + '">' + S.equip[k] + '</button>'; }).join('') + '</div>'; }
  function stepper(k, val, unit, id, small) {
    return '<div class="wk-stp' + (small ? ' sm' : '') + '"><button class="wk-stp-b" data-k="' + k + '" data-d="-1" aria-label="−">−</button><div class="wk-stp-v"><bdi dir="ltr" id="' + id + '">' + h(val) + '</bdi>' + (unit ? '<span class="wk-stp-u">' + unit + '</span>' : '') + '</div><button class="wk-stp-b" data-k="' + k + '" data-d="1" aria-label="+">+</button></div>';
  }
  function setupHtml() {
    var p = ui.prog;
    return '<div class="wk-lv-group"><label class="wk-lv-cap">' + S.progName + '</label><input class="rfi" value="' + h(p.name) + '" oninput="WorkoutLive.setName(this.value)" enterkeyhint="done"></div>'
      + p.exercises.map(function (e, i) {
        var bw = e.equip === 'bodyweight', u = e.unit === 'plates' ? S.unit.plates : S.unit.kg;
        return '<div class="wk-lv-group">'
          + '<div class="wk-row-h"><input class="rfi" id="wkPe_' + i + '" placeholder="' + S.exName + '" value="' + h(e.label) + '" oninput="WorkoutLive.setExName(' + i + ',this.value)" enterkeyhint="done"><button class="wk-lv-link" onclick="WorkoutLive.removeProgEx(' + i + ')">' + S.remove + '</button></div>'
          + '<div class="wk-lv-cap">' + S.equipT + '</div>' + chips(e.equip, 0, function (k) { return 'WorkoutLive.setEquip(' + i + ',\'' + k + '\')'; })
          + (bw ? '' : '<div class="wk-lv-line"><span>' + S.startW + '</span>' + stepper('sw:' + i, e.startW, u, 'wkPs_sw_' + i, 1) + '</div><div class="wk-lv-line"><span>' + S.step + '</span>' + stepper('step:' + i, e.step, u, 'wkPs_step_' + i, 1) + '</div>')
          + '<button class="wk-lv-link" onclick="WorkoutLive.toggleScheme(' + i + ')">' + S.schemeT + ' · ' + e.scheme.ranges.map(function (r) { return '<bdi dir="ltr">' + r[0] + '-' + r[1] + '</bdi>'; }).join(' · ') + '</button>'
          + (e._open ? '<div class="wk-lv-line"><span>' + S.setsN + '</span>' + stepper('sets:' + i, e.scheme.sets, '', 'wkPs_sets_' + i, 1) + '</div>'
            + e.scheme.ranges.map(function (r, j) { return '<div class="wk-lv-line"><span>' + S.setN(j + 1) + ' · <bdi dir="ltr" id="wkPs_rg_' + i + '_' + j + '">' + r[0] + '-' + r[1] + '</bdi></span><span class="wk-rg">' + stepper('lo:' + i + ':' + j, r[0], '', 'wkPs_lo_' + i + '_' + j, 1) + stepper('hi:' + i + ':' + j, r[1], '', 'wkPs_hi_' + i + '_' + j, 1) + '</span></div>'; }).join('') : '')
          + '</div>';
      }).join('')
      + '<button class="wk-lv-link wk-lv-add" onclick="WorkoutLive.addProgEx()">' + S.addEx + '</button>'
      + (ui.err ? '<div class="wk-lv-warn">' + ui.err + '</div>' : '');
  }
  function liveHtml() {
    var i = ui.view, ex = state.exercises[i], l = lastOf(ex.label), t = targets(i), u = unitTxt(ex), bw = isBw(ex);
    var n = Math.max((ex.scheme && ex.scheme.sets) || 3, ex.sets.length), active = !ex.skipped && (ex.sets.length < n || ui.extra[i]);
    var rows = ex.sets.map(function (x, k) {
      if (ui.editing && ui.editing.ex === i && ui.editing.i === k) {
        return '<div class="wk-lv-set edit"><div class="wk-lv-n">' + S.setN(k + 1) + ' · ' + S.edit + '</div><div class="wk-lv-steps">' + (bw ? '' : stepper('w', ui.editing.w, u, 'wkLvW')) + stepper('r', ui.editing.r, S.reps, 'wkLvR') + '</div>'
          + '<div class="wk-chips"><button class="wk-chip on" onclick="WorkoutLive.saveEdit()">' + S.keep + '</button><button class="wk-chip" onclick="WorkoutLive.delSet()">' + S.del + '</button><button class="wk-chip" onclick="WorkoutLive.cancelEdit()">' + S.cancel + '</button></div></div>';
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
    var allDone = state.exercises.every(exDone);
    return (ui.memOnly ? '<div class="wk-lv-warn">' + S.memFull + '</div>' : '') + (ui.wakeHint ? '<div class="wk-lv-cap wk-lv-hint">' + S.wake + '</div>' : '')
      + '<div class="wk-lv-ex"><div class="wk-lv-title">' + h(ex.label) + (ex.unit === 'kg' && ex.equip === 'dumbbell' ? '<span class="wk-lv-cap"> · ' + S.perHand + '</span>' : '') + '</div>'
      + '<div class="wk-lv-cap">' + (l ? S.lastTime + ': ' + l.sets.map(setTxt).join(' · ') : S.first) + '</div></div>'
      + '<div class="wk-lv-group wk-lv-sets">' + rows + act + next + '</div>'
      + (allDone ? '<div class="wk-lv-cap wk-lv-center">' + S.allDone + '</div>' : '')
      + '<div class="wk-chips wk-lv-more">' + (!active && !ex.skipped ? '<button class="wk-chip" onclick="WorkoutLive.addSet()">' + S.addSet + '</button>' : '')
      + (!exDone(ex) ? '<button class="wk-chip" onclick="WorkoutLive.skipEx()">' + S.skipEx + '</button>' : '')
      + '<button class="wk-chip" onclick="WorkoutLive.addOpen()">' + S.addExLive + '</button>'
      + (draft.actions.length > 1 ? '<button class="wk-chip" onclick="WorkoutLive.undo()">' + S.undo + '</button>' : '') + '</div>';
  }
  function addHtml() {
    return '<div class="wk-lv-group"><label class="wk-lv-cap">' + S.exName + '</label><input class="rfi" id="wkAddName" value="' + h(ui.add.label) + '" oninput="WorkoutLive.addName(this.value)" enterkeyhint="done">'
      + '<div class="wk-lv-cap">' + S.equipT + '</div>' + chips(ui.add.equip, 0, function (k) { return 'WorkoutLive.addEquip(\'' + k + '\')'; }) + '</div>';
  }
  function cmpLine(ex) {
    var l = W.lastTimeBefore(sessions(), ex.label, W.ymdIn(new Date(state.startedAt))), a = ex.sets[0], b = l && l.sets[0], u = unitTxt(ex), d;
    if (!b) d = S.cmpFirst;
    else if (a.w != null && b.w != null && a.w !== b.w) d = S.cmpKg(W.snap(a.w - b.w, 0), u);
    else d = a.r === b.r ? S.cmpSame : S.cmpReps(a.r - b.r);
    return '<div class="wk-lv-cmp"><span class="wk-lv-cmp-l">' + h(ex.label) + '</span><span>' + S.setN(1) + ' ← ' + setTxt(a) + '</span><span class="wk-lv-cap">' + d + '</span></div>';
  }
  function finishHtml() {
    var done = state.exercises.filter(function (e) { return e.sets.length; }), n = done.reduce(function (a, e) { return a + e.sets.length; }, 0);
    return '<div class="wk-lv-ex"><div class="wk-lv-title">' + S.sumT + '</div><div class="wk-lv-cap">' + S.duration + ' ' + num(clock(W.durationSec(state, Date.now()))) + ' · ' + S.setsDone(n) + '</div></div>'
      + '<div class="wk-lv-group">' + done.map(cmpLine).join('') + '</div>'
      + '<div class="wk-lv-group"><div class="wk-lv-cap">' + S.effort + '</div><div class="wk-chips wk-eff">' + [1, 2, 3, 4, 5].map(function (k) { return '<button class="wk-chip' + (ui.effort === k ? ' on' : '') + '" onclick="WorkoutLive.effort(' + k + ')">' + k + '</button>'; }).join('') + '</div>'
      + '<div class="wk-lv-line"><span>' + S.lockerT + '</span>' + stepper('lk', ui.locker == null ? S.noLocker : ui.locker, '', 'wkLvLk', 1) + '</div></div>'
      + (ui.exists ? '<div class="wk-lv-warn">' + S.existsQ + '</div>' : '') + (ui.err ? '<div class="wk-lv-warn">' + ui.err + '</div>' : '');
  }
  function renderDock() {
    var d = $('wkLvDock'); if (!d) return;
    if (ui.mode === 'setup') { d.innerHTML = '<button class="wk-big" onclick="WorkoutLive.saveSetup()">' + (ui.from === 'start' ? S.saveStart : S.save) + '</button>'; return; }
    if (ui.mode === 'add') { d.innerHTML = '<button class="wk-big" onclick="WorkoutLive.addSave()">' + S.add + '</button><button class="wk-lv-link" onclick="WorkoutLive.close()">' + S.cancel + '</button>'; return; }
    if (ui.mode === 'finish') {
      d.innerHTML = ui.exists ? '<button class="wk-big" onclick="WorkoutLive.saveWorkout(\'replace\')">' + S.replace + '</button><button class="wk-lv-link" onclick="WorkoutLive.saveWorkout(\'both\')">' + S.both + '</button>'
        : '<button class="wk-big" onclick="WorkoutLive.saveWorkout()">' + S.saveW + '</button><button class="wk-lv-link" onclick="WorkoutLive.backToLive()">' + S.back + '</button>';
      return;
    }
    var ex = state.exercises[ui.view], resting = state.rest && state.rest.endsAt > Date.now(), allDone = state.exercises.every(exDone);
    var active = ex && !ex.skipped && (ex.sets.length < Math.max((ex.scheme && ex.scheme.sets) || 3, ex.sets.length) || ui.extra[ui.view]) && !ui.editing;
    var main = resting
      ? '<div class="wk-rest"><button class="wk-rest-b" onclick="WorkoutLive.restAdj(-15)">−15</button><div class="wk-ring"><svg class="focus-ring-svg" viewBox="0 0 200 200"><circle class="focus-ring-bg" cx="100" cy="100" r="88"/><circle class="focus-ring-progress" id="wkRing" cx="100" cy="100" r="88"/></svg><div class="wk-ring-t"><bdi dir="ltr" id="wkRestT"></bdi><span>' + S.rest + '</span></div></div><button class="wk-rest-b" onclick="WorkoutLive.restAdj(15)">+15</button></div><button class="wk-lv-link" onclick="WorkoutLive.restSkip()">' + S.skipRest + '</button>'
      : active ? '<button class="wk-done" onclick="WorkoutLive.logSet()" aria-label="' + S.doneLbl + '">' + S.done + '</button>'
      : allDone ? '<button class="wk-big" onclick="WorkoutLive.finishOpen()">' + S.finish + '</button>' : '';
    d.innerHTML = main + (allDone && !resting ? '' : '<button class="wk-lv-link" onclick="WorkoutLive.finishOpen()">' + S.finish + '</button>');
  }

  // ── timers: ONE 1-second interval while visible; only text nodes change ──
  function tick() {
    if (!state || !$('wkLive') || ui.mode === 'setup') return;
    var now = Date.now(), el = $('wkLvEl'); if (el) el.textContent = clock(W.durationSec(state, now));
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
    var on = $('wkLive') && $('wkLive').classList.contains('on');
    if (!on) return;
    if (document.visibilityState === 'visible') { startTimer(); renderDock(); tick(); if (ui.mode === 'live') acquireWake(); } else stopTimer();
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
    var stale = isStale(r);
    return '<div class="wk-resume-in"><span>🏋️ ' + S.open + '</span><span class="wk-chips">'
      + (stale ? '<button class="wk-chip on" onclick="WorkoutLive.saveOld()">' + S.saveOld + '</button><button class="wk-chip" onclick="WorkoutLive.delOld()">' + S.delOld + '</button>'
        : '<button class="wk-chip on" onclick="WorkoutLive.start()">' + S.resume + '</button>' + (where === 'banner' ? '<button class="wk-chip" onclick="WorkoutLive.hideBanner()" aria-label="' + S.hide + '">✕</button>' : '')) + '</span></div>';
  }
  function banner() {
    hideBanner();
    var html = resumeLine('banner'); if (!html || !document.body) return;
    var b = document.createElement('div'); b.id = 'wkResume'; b.className = 'wk-resume'; b.dir = 'rtl'; b.innerHTML = html; document.body.appendChild(b);
  }
  function hideBanner() { var b = $('wkResume'); if (b) b.remove(); }
  function saveOld() { var r = readDraft(); if (!r) return; draft = r.d; state = r.s; ui.effort = null; hideBanner(); ui.mode = 'live'; ensure(); show(); finishOpen(); }
  function delOld() { if (!confirm(S.delConfirm)) return; drop(KEY_D); hideBanner(); refreshSheet(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();

  window.WorkoutLive = { enabled: enabled, hasDraft: hasDraft, resumeLine: resumeLine, start: start, setup: setup, close: close, view: view, logSet: logSet, undo: undo, addSet: addSet, skipEx: skipEx,
    editSet: editSet, saveEdit: saveEdit, delSet: delSet, cancelEdit: cancelEdit, restAdj: restAdj, restSkip: restSkip, addOpen: addOpen, addName: addName, addEquip: addEquip, addSave: addSave,
    finishOpen: finishOpen, effort: effort, saveWorkout: saveWorkout, backToLive: backToLive, saveOld: saveOld, delOld: delOld, hideBanner: hideBanner,
    setName: setName, setExName: setExName, setEquip: setEquip, addProgEx: addProgEx, removeProgEx: removeProgEx, toggleScheme: toggleScheme, saveSetup: saveSetup,
    state: function () { return state ? JSON.parse(JSON.stringify(state)) : null; } };
})();
