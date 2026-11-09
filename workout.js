// Workout: the ☰ "אימונים" sheet. A weekly summary, a (not yet active) start button and the recent sessions with a "last time"
// line per exercise. Sessions are recorded only by the future live workout screen; parsing/deriving lives in workout-core.js (WCore).
// Storage (all OPTIONAL keys): vt_wk_sessions, vt_wk_catalog. Sessions never touch routine instances, completion or the calendar.
(function () {
  'use strict';
  var W = window.WCore, KEY_S = 'vt_wk_sessions', KEY_C = 'vt_wk_catalog';
  var $ = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ── every Hebrew string, in ONE table (glossary: סט, חזרות, מנוחה, שיא אישי, חימום, השלמה) ──
  var S = {
    title: 'אימונים', recent: 'אימונים אחרונים',
    weekNone: 'עוד לא התחלנו השבוע', week: function (n, sets) { return 'השבוע: ' + S.sessionsN(n) + (sets ? ' · ' + S.sets(sets) : ''); },
    start: 'התחל אימון עכשיו', resume: 'המשך את האימון', soon: 'זמין בקרוב', editProgram: 'ערוך תוכנית',
    empty: 'אחרי האימון הראשון תראה כאן את הסטים שלך',
    exercises: function (n) { return n === 1 ? 'תרגיל אחד' : n + ' תרגילים'; }, sets: function (n) { return n === 1 ? 'סט אחד' : n + ' סטים'; },
    sessionsN: function (n) { return n === 1 ? 'אימון אחד' : n + ' אימונים'; },
    locker: function (n) { return 'ציוד: תא ' + n; },
    lastTime: 'בפעם שעברה', cls: function (m) { return 'שיעור · ' + m + ' דקות'; }, kg: 'ק״ג',
    del: 'מחק', delConfirm: 'למחוק את האימון?', more: 'עוד'
  };

  // ── storage ──
  function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (_) { return def; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  var sessions = load(KEY_S, []), catalog = load(KEY_C, { aliases: {} });
  var st = { open: {}, shown: 20 };

  // ── formatting helpers ──
  var dayLabel = function (ymd) { var d = new Date(ymd + 'T12:00:00Z'), p = ymd.split('-'); return d.toLocaleDateString('he-IL', { weekday: 'short', timeZone: 'UTC' }) + ' ' + (+p[2]) + '.' + (+p[1]) + (+p[0] !== new Date().getFullYear() ? '.' + p[0] : ''); };
  var setChips = function (sets) { return sets.map(function (x) { return '<span class="wk-set" dir="ltr">' + (x.w == null ? x.r : h(x.w) + '×' + x.r) + '</span>'; }).join(''); };
  var nSets = function (s) { return s.exercises.reduce(function (a, e) { return a + e.sets.length; }, 0); };
  var summary = function (s) { return s.mode === 'class' && !s.exercises.length ? S.cls(s.classes[0].minutes) : S.exercises(s.exercises.length) + ' · ' + S.sets(nSets(s)); };
  var unitOf = function (label) { var a = catalog.aliases[W.labelKey(label)]; return a && a.unit === 'kg'; };

  // ── sheet ──
  function ensureSheet() {
    if ($('wkSheet')) return;
    var el = document.createElement('div');
    el.className = 'rsheet'; el.id = 'wkSheet';
    el.innerHTML = '<div class="rsheet-handle-area"><div class="rsheet-handle"></div></div>'
      + '<div class="rsheet-head"><button class="rsheet-close-btn" onclick="Workout.close()" aria-label="סגור">✕</button><h3>🏋️ ' + S.title + '</h3><div style="width:32px"></div></div>'
      + '<div class="rsheet-scroll" style="padding:12px 16px calc(32px + var(--sab));direction:rtl">'
      + '<div id="wkWeek"></div>'
      + '<div id="wkStartBox"></div>'
      + '<div id="wkHistory"></div></div>';
    document.body.appendChild(el);
    if (window.initSheetSwipe && $('routineOverlay')) window.initSheetSwipe(el, $('routineOverlay'));
  }
  function open() {
    ensureSheet();
    sessions = load(KEY_S, []); catalog = load(KEY_C, { aliases: {} });
    $('routineOverlay').classList.add('on'); $('wkSheet').classList.add('on');
    renderWeek(); renderStart(); renderHistory();
  }
  function close() {
    var s = $('wkSheet'); if (s) s.classList.remove('on');
    var o = $('routineOverlay'); if (o) o.classList.remove('on');
  }

  function persist() { return put(KEY_S, sessions); }
  function del(id) {
    if (!confirm(S.delConfirm)) return;
    sessions = sessions.filter(function (x) { return x.id !== id; }); persist(); renderWeek(); renderHistory();
  }
  function toggleUnit(key) { var a = catalog.aliases[key] || {}; catalog.aliases[key] = Object.assign({}, a, { unit: a.unit === 'kg' ? '' : 'kg' }); put(KEY_C, catalog); renderHistory(); }
  function toggleOpen(id) { st.open[id] = !st.open[id]; renderHistory(); }
  function more() { st.shown += 20; renderHistory(); }

  // ── render ──
  function renderWeek() {
    var el = $('wkWeek'); if (!el) return;
    var r = W.weekRange(new Date()), inWeek = sessions.filter(function (s) { return s.date >= r.start && s.date <= r.end; });
    el.innerHTML = '<div class="wk-note" style="font-size:14px;color:var(--text);font-weight:700;margin:2px 0 12px">' + h(inWeek.length ? S.week(inWeek.length, inWeek.reduce(function (a, s) { return a + nSets(s); }, 0)) : S.weekNone) + '</div>';
  }
  function renderStart() {                                                // the live workout (workout-live.js); off = the kill switch
    var el = $('wkStartBox'); if (!el) return;
    var L = window.WorkoutLive, on = !!(L && L.enabled());
    el.innerHTML = !on ? '<button class="rform-save" id="wkStart" disabled style="opacity:.45">' + S.start + '</button><div class="wk-note" style="text-align:center">' + S.soon + '</div>'
      : L.resumeLine('sheet') + '<button class="rform-save" id="wkStart" onclick="WorkoutLive.start()">' + (L.hasDraft() ? S.resume : S.start) + '</button>'
        + '<div class="wk-note" style="text-align:center"><button class="wk-lv-link" onclick="WorkoutLive.setup()">' + S.editProgram + '</button></div>';
  }
  function renderHistory() {
    var el = $('wkHistory'); if (!el) return;
    if (!sessions.length) { el.innerHTML = '<div class="empty"><span class="empty-icon">🏋️</span><p>' + S.empty + '</p></div>'; return; }
    var recent = W.sortRecent(sessions), list = recent.slice(0, st.shown);
    if (st.open && !Object.keys(st.open).length && recent[0]) st.open[recent[0].id] = 1;
    el.innerHTML = (recent.length ? '<div class="section-hdr" style="padding:18px 0 6px"><div class="section-hdr-left"><span class="section-hdr-title">' + S.recent + '</span><span class="section-count">' + recent.length + '</span></div></div>' : '')
      + list.map(function (s) {
        var open = !!st.open[s.id];
        var body = !open ? '' : '<div class="wk-body">' + (s.mode === 'class' && !s.exercises.length ? '<div class="wk-row"><span class="wk-label">' + h(s.classes[0].label) + '</span><span class="wk-sets">' + S.cls(s.classes[0].minutes) + '</span></div>' : s.exercises.map(function (e) {
          var lt = W.lastTimeBefore(sessions, e.label, s.date), key = W.labelKey(e.label), kg = unitOf(e.label);
          return '<div class="wk-row"><span class="wk-label">' + h(e.label) + '</span><span class="wk-sets">' + setChips(e.sets) + '</span>'
            + '<button class="wk-unit' + (kg ? ' on' : '') + '" onclick="Workout.toggleUnit(\'' + h(key).replace(/'/g, '&#39;') + '\')" aria-label="' + S.kg + '">' + S.kg + '</button>'
            + (lt ? '<div class="wk-last">' + S.lastTime + ': ' + lt.sets.map(function (x) { return '<bdi dir="ltr">' + (x.w == null ? x.r : h(x.w) + '×' + x.r) + '</bdi>'; }).join(' · ') + ' · ' + dayLabel(lt.date) + '</div>' : '') + '</div>';
        }).join('') + (s.exercises.some(function (e) { return e.unparsed.length; }) ? '<div class="wk-last">' + s.exercises.map(function (e) { return e.unparsed.join(' '); }).filter(Boolean).map(h).join(' · ') + '</div>' : ''))
          + '<div class="chat-suggestions"><button class="chat-suggestion" onclick="Workout.del(\'' + s.id + '\')">' + S.del + '</button></div></div>';
        return '<div class="wk-sess"><button class="wk-sess-head" onclick="Workout.toggleOpen(\'' + s.id + '\')"><span class="wk-sess-t">אימון ' + h(s.type) + ' · ' + dayLabel(s.date) + '</span>'
          + (s.locker != null ? '<span class="wk-sess-l">' + S.locker(s.locker) + '</span>' : '') + '<span class="wk-sess-s">' + summary(s) + '</span></button>' + body + '</div>';
      }).join('')
      + (recent.length > list.length ? '<div class="chat-suggestions" style="justify-content:center"><button class="chat-suggestion" onclick="Workout.more()">' + S.more + '</button></div>' : '');
  }

  window.Workout = { open: open, close: close, del: del, toggleUnit: toggleUnit, toggleOpen: toggleOpen, more: more, sessions: function () { return sessions.slice(); } };
})();
