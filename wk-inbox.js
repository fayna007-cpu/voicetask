// wk-inbox.js — J9 NOTIFICATION CENTER. A persistent local inbox so no Alfred notification is lost.
// Storage = IndexedDB (survives restarts); works in BOTH the page and the service worker (shared DB).
// Items: {id, ts, category, title, body, read, deepLink}. Cap 100, keep 30 days, local only, nothing sent anywhere.
(function (root) {
  'use strict';
  var DB = 'alfred-inbox', STORE = 'items', CAP = 100, KEEP_MS = 30 * 24 * 3600 * 1000;

  function open() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { var db = r.result; if (!db.objectStoreNames.contains(STORE)) { var os = db.createObjectStore(STORE, { keyPath: 'id' }); os.createIndex('ts', 'ts'); } };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) { return open().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(STORE, mode), os = t.objectStore(STORE); var out = fn(os); t.oncomplete = function () { res(out && out.value !== undefined ? out.value : out); }; t.onerror = function () { rej(t.error); }; }); }); }
  function all() { return tx('readonly', function (os) { var box = { value: [] }; os.getAll().onsuccess = function (e) { box.value = e.target.result || []; }; return box; }); }

  // add an item (dedupe by id). Prunes to CAP newest + drops items older than KEEP_MS.
  function add(item) {
    if (!item || !item.id) return Promise.resolve(false);
    var it = { id: String(item.id), ts: item.ts || Date.now(), category: item.category || 'אחר', title: String(item.title || ''), body: String(item.body || ''), read: !!item.read, deepLink: item.deepLink || null, expireAt: item.expireAt || null };
    if (item.test || /^(test|wk_test)/.test(it.id)) return Promise.resolve(false);   // never record a test PUSH as a journey item (N5's own 'בדיקה' item uses expireAt, not test)
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, 'readwrite'), os = t.objectStore(STORE);
        var g = os.get(it.id);
        g.onsuccess = function () { if (g.result) { res(false); return; } os.put(it); };   // dedupe: keep the first
        t.oncomplete = function () { prune().then(function () { res(true); }); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function prune() {
    return all().then(function (list) {
      var now = Date.now();
      var expired = function (x) { return (x.expireAt && now > x.expireAt) || (now - x.ts > KEEP_MS); };   // N5 'בדיקה' item auto-removes at expireAt (24h)
      var dead = list.filter(expired);
      var live = list.filter(function (x) { return !expired(x); }).sort(function (a, b) { return b.ts - a.ts; });
      var over = live.slice(CAP);                                 // beyond the newest CAP
      var drop = dead.concat(over).map(function (x) { return x.id; });
      if (!drop.length) return;
      return tx('readwrite', function (os) { drop.forEach(function (id) { os.delete(id); }); });
    });
  }
  function list() { return all().then(function (l) { return l.sort(function (a, b) { return b.ts - a.ts; }); }); }
  function unreadCount() { return all().then(function (l) { return l.filter(function (x) { return !x.read; }).length; }); }
  function markRead(id) { return tx('readwrite', function (os) { var g = os.get(String(id)); g.onsuccess = function () { var v = g.result; if (v && !v.read) { v.read = true; os.put(v); } }; }); }
  function markAll() { return tx('readwrite', function (os) { os.getAll().onsuccess = function (e) { (e.target.result || []).forEach(function (v) { if (!v.read) { v.read = true; os.put(v); } }); }; }); }

  function _clear() { return tx('readwrite', function (os) { os.clear(); }); }
  root.WkInbox = { add: add, list: list, unreadCount: unreadCount, markRead: markRead, markAll: markAll, prune: prune, _clear: _clear, _DB: DB, _STORE: STORE, _CAP: CAP };

  // ── UI (page only): the notification center per ref 12 + the bell dot ──
  if (typeof document !== 'undefined') {
    var ICO = {
      dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9v6M4 10v4M18 9v6M20 10v4M6 12h12"/></svg>',
      check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      bellOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="7"/></svg>'
    };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var ymd = function (ts) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(ts)); } catch (e) { return '' + ts; } };
    var hhmm = function (ts) { try { return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)); } catch (e) { return ''; } };
    var filter = 'all';

    function group(ts) { var t = ymd(ts), today = ymd(Date.now()), y = ymd(Date.now() - 86400000); return t === today ? 'היום' : t === y ? 'אתמול' : 'מוקדם יותר'; }
    function catLabel(c) { var workout = c === 'אימון'; return '<span class="wk-nc-cat ' + (workout ? 'wk-nc-cat-w' : 'wk-nc-cat-t') + '"><span class="wk-nc-cat-ic">' + (workout ? ICO.dumbbell : ICO.check) + '</span>' + esc(workout ? 'אימון' : (c === 'משימה' ? 'משימה' : c)) + '</span>'; }

    function card(it) {
      return '<button class="wk-nc-card' + (it.read ? '' : ' unread') + '" data-id="' + esc(it.id) + '" data-link="' + esc(it.deepLink || '') + '">'
        + '<div class="wk-nc-head">' + catLabel(it.category) + '<span class="wk-nc-time">' + (it.read ? '' : '<span class="wk-nc-dot" aria-label="חדש"></span>') + '<bdi dir="ltr">' + esc(hhmm(it.ts)) + '</bdi></span></div>'
        + '<div class="wk-nc-title">' + esc(it.title) + '</div>'
        + (it.body ? '<div class="wk-nc-body">' + esc(it.body) + '</div>' : '')
        + '</button>';
    }
    function render(el, items, unread) {
      var f = items.filter(function (it) { return filter === 'all' || (filter === 'workout' && it.category === 'אימון') || (filter === 'task' && it.category === 'משימה'); });
      var chip = function (k, label) { return '<button class="wk-nc-chip' + (filter === k ? ' on' : '') + '" data-f="' + k + '">' + label + '</button>'; };
      var html = '<div class="wk-nc-top"><button class="wk-nc-x" aria-label="סגור"></button><div class="wk-nc-h-wrap"><h2 class="wk-nc-h">התראות</h2></div>'
        + '<div class="wk-nc-sub-row"><span class="wk-nc-sub">' + (unread ? unread + ' חדשות' : 'אין חדשות') + '</span>'
        + '<button class="wk-nc-markall"' + (unread ? '' : ' disabled') + '>סמן הכל כנקרא</button></div>'
        + '<div class="wk-nc-chips">' + chip('all', 'הכל') + chip('workout', 'אימון') + chip('task', 'משימות') + '</div></div><div class="wk-nc-scroll">';
      if (!f.length) {
        html += '<div class="wk-nc-empty"><div class="wk-nc-empty-ic">' + ICO.bellOff + '</div><div class="wk-nc-empty-t">כאן יופיעו ההתראות שלך</div><div class="wk-nc-empty-s">כל תזכורת ועדכון נשמרים כאן, גם אם לא היית בסביבה.</div></div>';
      } else {
        var lastG = null;
        f.forEach(function (it) { var g = group(it.ts); if (g !== lastG) { html += '<div class="wk-nc-group">' + g + '</div>'; lastG = g; } html += card(it); });
      }
      html += '</div>';
      el.innerHTML = html;
    }
    function openCenter() {
      var el = document.getElementById('wkInbox'); if (!el) { el = document.createElement('div'); el.id = 'wkInbox'; el.className = 'wk-nc'; el.setAttribute('dir', 'rtl'); el.setAttribute('role', 'dialog'); document.body.appendChild(el); }
      Promise.all([list(), unreadCount()]).then(function (r) {
        render(el, r[0], r[1]); el.classList.add('on');
        el.onclick = function (ev) {
          var x = ev.target.closest('.wk-nc-x'); if (x) { closeCenter(); return; }
          var ch = ev.target.closest('.wk-nc-chip'); if (ch) { filter = ch.getAttribute('data-f'); openCenter(); return; }
          var ma = ev.target.closest('.wk-nc-markall'); if (ma) { markAll().then(function () { refreshBell(); openCenter(); }); return; }
          var c = ev.target.closest('.wk-nc-card'); if (c) { var id = c.getAttribute('data-id'), link = c.getAttribute('data-link'); markRead(id).then(function () { refreshBell(); if (link && window.WorkoutHome && link.indexOf('workout') === 0) { closeCenter(); try { WorkoutHome.openFromNotif({ id: id, payload: { type: 'workout' } }); } catch (e) { } } else { c.classList.remove('unread'); } }); return; }
        };
      });
    }
    function closeCenter() { var el = document.getElementById('wkInbox'); if (el) el.classList.remove('on'); }
    function refreshBell() { unreadCount().then(function (n) { document.querySelectorAll('.bnav-item').forEach(function (b) { if (/התראות/.test(b.textContent)) { b.classList.toggle('has-unread', n > 0); b.setAttribute('data-unread', n > 0 ? '•' : ''); } }); }); }

    root.WkInbox.open = openCenter; root.WkInbox.close = closeCenter; root.WkInbox.refreshBell = refreshBell;
    // keep the bell dot fresh on open + when returning to the app
    try { window.addEventListener('load', function () { setTimeout(refreshBell, 300); }); document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshBell(); }); } catch (e) { }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WkInbox;
})(typeof self !== 'undefined' ? self : this);
