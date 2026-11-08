// Workout: the ☰ "אימונים" sheet. ONE input box (paste or type the shorthand), a preview before anything is saved,
// Undo, conflicts, a history with a "last time" line per exercise. Parsing/deriving lives in workout-core.js (WCore).
// Storage (all OPTIONAL keys): vt_wk_sessions, vt_wk_catalog. Sessions never touch routine instances, completion or the calendar.
(function () {
  'use strict';
  var W = window.WCore, KEY_S = 'vt_wk_sessions', KEY_C = 'vt_wk_catalog';
  var $ = function (id) { return document.getElementById(id); };
  var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ── every Hebrew string, in ONE table (glossary: סט, חזרות, מנוחה, שיא אישי, חימום, השלמה) ──
  var S = {
    title: 'אימונים', input: 'הדבק או הקלד אימון',
    hint: 'שורה ראשונה: אימון, אות, תא (לא חובה) ותאריך. אחריה: תרגיל - סטים',
    placeholder: 'אימון A 14 2.11\nחזה - 26*6, 24*7, 20*11\nמתח - 8, 8, 8',
    emptyTitle: 'עוד אין אימונים כאן', emptyBody: 'הקלד או הדבק את האימונים האחרונים שלך, בדיוק כמו שאתה רושם אותם. למשל:',
    example: 'אימון A 14 2.11\nחזה - 26*6, 24*7, 20*11\nמתח - 8, 8, 8', useExample: 'השתמש בדוגמה',
    loading: 'קורא…', noHeader: 'לא זיהיתי כותרת. פתח בשורה כמו "אימון A 2.11"', saveErr: 'לא הצלחתי לשמור, אין מקום בזיכרון',
    exercises: function (n) { return n === 1 ? 'תרגיל אחד' : n + ' תרגילים'; }, sets: function (n) { return n === 1 ? 'סט אחד' : n + ' סטים'; },
    sessionsN: function (n) { return n === 1 ? 'אימון אחד' : n + ' אימונים'; },
    locker: function (n) { return 'ציוד: תא ' + n; }, usual: 'מהרגיל', removeLocker: 'הסר',
    lastTime: 'בפעם שעברה', cls: function (m) { return 'שיעור · ' + m + ' דקות'; }, kg: 'ק״ג',
    exists: 'כבר קיים', conflict: 'יש כבר אימון כזה באותו יום עם סטים אחרים',
    keep: 'השאר הקיים', replace: 'עדכן', both: 'שמור שניהם',
    save: function (n) { return n === 1 ? '✓ שמור אימון' : '✓ שמור ' + n + ' אימונים'; }, nothing: 'אין מה לשמור',
    saved: function (n) { return n === 1 ? 'נשמר אימון אחד' : 'נשמרו ' + n + ' אימונים'; }, undo: '↶ בטל', undone: 'בוטל',
    unparsed: 'לא הבנתי, אפשר לתקן:', del: 'מחק', delConfirm: 'למחוק את האימון?', more: 'עוד',
    w: {
      reps: function (w) { return w.label + ': ' + w.value + ' חזרות, בטוח?'; }, weight: function (w) { return w.label + ': משקל ' + w.value + ', בטוח?'; },
      line: function (w) { return 'שורה שלא הבנתי: ' + w.value; }, noDate: function () { return 'לא כתבת תאריך, לקחתי את היום'; },
      invalidDate: function (w) { return 'תאריך לא תקין (' + w.value + '), לקחתי את היום'; }, token: function (w) { return 'לא הבנתי: ' + w.value; },
      emptyExercise: function (w) { return w.label + ': אין סטים'; }
    }
  };

  // ── storage ──
  function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (_) { return def; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  var sessions = load(KEY_S, []), catalog = load(KEY_C, { aliases: {} });
  var last = 0, uid = function () { last = Math.max(Date.now(), last + 1); return 'w' + last; };
  var st = { parsed: null, choices: {}, loading: false, err: '', undo: null, status: '', open: {}, shown: 20, timer: null };

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
      + '<div class="rform-lbl">' + S.input + '</div>'
      + '<textarea class="rfi-verbal" id="wkInput" rows="5" placeholder="' + h(S.placeholder) + '" oninput="Workout.onInput()" enterkeyhint="enter"></textarea>'
      + '<div class="rform-hint" style="margin-top:6px">' + S.hint + '</div>'
      + '<div id="wkStatus"></div><div id="wkPreview"></div><div id="wkHistory"></div></div>';
    document.body.appendChild(el);
    if (window.initSheetSwipe && $('routineOverlay')) window.initSheetSwipe(el, $('routineOverlay'));
  }
  function open() {
    ensureSheet();
    $('routineOverlay').classList.add('on'); $('wkSheet').classList.add('on');
    renderStatus(); renderPreview(); renderHistory();
  }
  function close() {
    var s = $('wkSheet'); if (s) s.classList.remove('on');
    var o = $('routineOverlay'); if (o) o.classList.remove('on');
    st.undo = null; st.status = '';
  }

  // ── input -> parse -> preview ──
  function onInput() {
    var v = $('wkInput').value;
    clearTimeout(st.timer);
    if (!v.trim()) { st.parsed = null; st.err = ''; st.loading = false; renderPreview(); renderHistory(); return; }
    st.loading = v.length > 5000; renderPreview();                         // a big paste shows "קורא…" first, then parses
    st.timer = setTimeout(function () { run(v); }, st.loading ? 30 : 180);
  }
  function run(v) {
    var r = W.parse(v, { now: new Date() }), d = W.derive(sessions).types, seen = {};
    st.err = r.errors.length ? r.errors[0] : '';
    r.sessions.forEach(function (s) {
      if (s.locker == null && d[s.type] && d[s.type].usualLocker) { s.locker = d[s.type].usualLocker.n; s.lockerAuto = true; }   // pre-filled, removable
      s._cls = W.classify(s, sessions);
      var k = s.date + '|' + s.type + '|' + W.setsKey(s);
      if (s._cls.kind === 'new' && seen[k]) s._cls = { kind: 'exists', with: null };           // the same session twice in one paste
      seen[k] = 1;
    });
    st.parsed = r; st.choices = {}; st.loading = false; st.status = ''; st.undo = null;
    renderStatus(); renderPreview(); renderHistory();
  }
  function useExample() { $('wkInput').value = S.example; run(S.example); }
  function mergeToken(si, ei, ti) {                                        // fix one unparsed token: re-read the corrected text
    var key = si + '_' + ei + '_' + ti;
    if (st.editing !== key) return;                                        // change AND blur both fire: commit once per edit
    st.editing = null;
    var ex = st.parsed.sessions[si].exercises[ei], tk = ex.unparsed[ti], box = $('wkTok_' + key), v = box ? box.value.trim() : tk;
    if (!v) { ex.unparsed.splice(ti, 1); }
    else {
      var r = W.parse('אימון X 1.1\nx - ' + v, { now: new Date() }).sessions[0], e2 = r && r.exercises[0];
      if (e2) { ex.unparsed.splice(ti, 1); e2.sets.forEach(function (x) { ex.sets.push(x); }); e2.unparsed.forEach(function (x) { ex.unparsed.push(x); }); if (e2.note) ex.note = e2.note; }
    }
    var s = st.parsed.sessions[si]; s.hash = W.hashOf(s); s._cls = W.classify(s, sessions); renderPreview();
  }
  function editToken(si, ei, ti) { st.editing = si + '_' + ei + '_' + ti; renderPreview(); var b = $('wkTok_' + st.editing); if (b) b.focus(); }
  function dropLocker(si) { var s = st.parsed.sessions[si]; s.locker = null; s.lockerAuto = false; renderPreview(); }
  function choose(si, c) { st.choices[si] = c; renderPreview(); }

  // ── save / undo ──
  function persist() { return put(KEY_S, sessions); }
  function toRecord(s, now) {
    return { id: uid(), date: s.date, type: s.type, typeRaw: s.typeRaw, locker: s.locker, mode: s.mode, classes: s.classes,
      exercises: s.exercises.map(function (e) { return { label: e.label, sets: e.sets.map(function (x) { return { w: x.w, r: x.r }; }), unparsed: e.unparsed, note: e.note || null }; }),
      hash: s.hash, createdAt: now, updatedAt: now, source: 'typed', routineId: null, instanceId: null };
  }
  function saveAll() {
    var p = st.parsed; if (!p) return;
    var before = JSON.stringify(sessions), now = new Date().toISOString(), added = [], replaced = [];
    p.sessions.forEach(function (s, i) {
      var c = s._cls, ch = st.choices[i] || 'keep';
      if (c.kind === 'exists' || (c.kind === 'conflict' && ch === 'keep')) return;
      var rec = toRecord(s, now);
      if (c.kind === 'conflict' && ch === 'replace') {
        var idx = sessions.findIndex(function (x) { return x.id === c.with.id; });
        if (idx > -1) { replaced.push({ id: c.with.id, prev: sessions[idx] }); rec.id = c.with.id; rec.createdAt = sessions[idx].createdAt; sessions[idx] = rec; }
        return;
      }
      sessions.push(rec); added.push(rec.id);
    });
    if (!added.length && !replaced.length) return;
    if (!persist()) { sessions = JSON.parse(before); st.status = ''; st.err = 'saveErr'; renderStatus(); renderPreview(); return; }
    st.undo = { added: added, replaced: replaced }; st.status = S.saved(added.length + replaced.length);
    st.parsed = null; st.err = ''; $('wkInput').value = '';
    if (added.length) st.open = {}, st.open[added[added.length - 1]] = 1;
    renderStatus(); renderPreview(); renderHistory();
  }
  function undo() {
    var u = st.undo; if (!u) return;
    sessions = sessions.filter(function (x) { return u.added.indexOf(x.id) < 0; });
    u.replaced.forEach(function (r) { var i = sessions.findIndex(function (x) { return x.id === r.id; }); if (i > -1) sessions[i] = r.prev; });
    persist(); st.undo = null; st.status = S.undone; renderStatus(); renderHistory();
  }
  function del(id) {
    if (!confirm(S.delConfirm)) return;
    sessions = sessions.filter(function (x) { return x.id !== id; }); persist(); renderHistory();
  }
  function toggleUnit(key) { var a = catalog.aliases[key] || {}; catalog.aliases[key] = Object.assign({}, a, { unit: a.unit === 'kg' ? '' : 'kg' }); put(KEY_C, catalog); renderHistory(); }
  function toggleOpen(id) { st.open[id] = !st.open[id]; renderHistory(); }
  function more() { st.shown += 20; renderHistory(); }

  // ── render ──
  function renderStatus() {
    var el = $('wkStatus'); if (!el) return;
    el.innerHTML = st.status ? '<div class="wk-status"><span>' + h(st.status) + '</span>' + (st.undo ? '<button class="chat-suggestion" onclick="Workout.undo()">' + S.undo + '</button>' : '') + '</div>' : '';
  }
  function warnText(w) { var f = S.w[w.code]; return f ? f(w) : w.code; }
  function renderPreview() {
    var el = $('wkPreview'); if (!el) return;
    if (st.loading) { el.innerHTML = '<div class="wk-note">' + S.loading + '</div>'; return; }
    if (st.err === 'saveErr') { el.innerHTML = '<div class="wk-note wk-bad">' + S.saveErr + '</div>'; return; }
    if (st.err === 'noHeader') { el.innerHTML = '<div class="wk-note wk-bad">' + S.noHeader + '</div><div class="chat-suggestions"><button class="chat-suggestion" onclick="Workout.useExample()">' + S.useExample + '</button></div>'; return; }
    var p = st.parsed; if (!p || !p.sessions.length) { el.innerHTML = ''; return; }
    var toSave = 0;
    var cards = p.sessions.map(function (s, si) {
      var c = s._cls, ch = st.choices[si] || 'keep';
      if (c.kind === 'new' || (c.kind === 'conflict' && ch !== 'keep')) toSave++;
      var lock = s.locker != null ? '<span class="routine-badge">' + S.locker(s.locker) + (s.lockerAuto ? ' · ' + S.usual + ' <button class="wk-x" onclick="Workout.dropLocker(' + si + ')" aria-label="' + S.removeLocker + '">✕</button>' : '') + '</span>' : '';
      var rows = s.exercises.map(function (e, ei) {
        var toks = e.unparsed.map(function (t, ti) {
          var key = si + '_' + ei + '_' + ti;
          return st.editing === key ? '<input class="edit-dt wk-tok" id="wkTok_' + key + '" value="' + h(t) + '" dir="auto" onchange="Workout.mergeToken(' + si + ',' + ei + ',' + ti + ')" onblur="Workout.mergeToken(' + si + ',' + ei + ',' + ti + ')">'
            : '<button class="chat-suggestion wk-unparsed" onclick="Workout.editToken(' + si + ',' + ei + ',' + ti + ')">✏️ ' + h(t) + '</button>';
        }).join('');
        return '<div class="wk-row"><span class="wk-label">' + h(e.label) + '</span><span class="wk-sets">' + setChips(e.sets) + '</span>' + (toks ? '<div class="wk-sets">' + toks + '</div>' : '') + (e.note ? '<div class="wk-last">' + h(e.note) + '</div>' : '') + '</div>';
      }).join('');
      var warns = s.warnings.map(function (w) { return '<span class="cal-badge pending">⚠️ ' + h(warnText(w)) + '</span>'; }).join(' ');
      var hasTok = s.exercises.some(function (e) { return e.unparsed.length; });
      var conf = c.kind === 'exists' ? '<span class="cal-badge synced">' + S.exists + '</span>'
        : c.kind === 'conflict' ? '<div class="wk-note">' + S.conflict + '</div><div class="chat-suggestions">' + ['keep', 'replace', 'both'].map(function (k) { return '<button class="chat-suggestion" onclick="Workout.choose(' + si + ',\'' + k + '\')">' + (ch === k ? '✓ ' : '') + S[k] + '</button>'; }).join('') + '</div>' : '';
      return '<div class="chat-confirm"><div class="chat-confirm-title">אימון ' + h(s.type) + ' · ' + dayLabel(s.date) + '</div><div class="wk-meta">' + lock + '<span>' + summary(s) + '</span></div>'
        + rows + (hasTok ? '<div class="wk-note">' + S.unparsed + '</div>' : '') + (warns ? '<div class="wk-warns">' + warns + '</div>' : '') + conf + '</div>';
    }).join('');
    el.innerHTML = cards + '<button class="rform-save"' + (toSave ? '' : ' disabled style="opacity:.45"') + ' onclick="Workout.save()">' + (toSave ? S.save(toSave) : S.nothing) + '</button>';
  }
  function renderHistory() {
    var el = $('wkHistory'); if (!el) return;
    var showEmpty = !sessions.length && !(st.parsed && st.parsed.sessions.length);
    if (showEmpty) {
      el.innerHTML = '<div class="empty"><span class="empty-icon">🏋️</span><p><b>' + S.emptyTitle + '</b><br>' + S.emptyBody + '</p><div class="wk-example">' + h(S.example) + '</div>'
        + '<div class="chat-suggestions" style="justify-content:center"><button class="chat-suggestion" onclick="Workout.useExample()">' + S.useExample + '</button></div></div>';
      return;
    }
    var recent = W.sortRecent(sessions), list = recent.slice(0, st.shown);
    if (st.open && !Object.keys(st.open).length && recent[0]) st.open[recent[0].id] = 1;
    el.innerHTML = (recent.length ? '<div class="section-hdr" style="padding:18px 0 6px"><div class="section-hdr-left"><span class="section-hdr-title">' + S.title + '</span><span class="section-count">' + recent.length + '</span></div></div>' : '')
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

  window.Workout = { open: open, close: close, onInput: onInput, useExample: useExample, save: saveAll, undo: undo, choose: choose, editToken: editToken, mergeToken: mergeToken, dropLocker: dropLocker,
    del: del, toggleUnit: toggleUnit, toggleOpen: toggleOpen, more: more, sessions: function () { return sessions.slice(); } };
})();
