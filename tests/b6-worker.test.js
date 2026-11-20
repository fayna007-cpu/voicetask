// F3: local logic test for the PREPARED (not deployed) rest-end worker change — a stub KV + a fake alarm clock, invented data.
// Asserts: a per-id cancel removes exactly one push; the alarm fires within +-5s of the rest end; a foregrounded rest-end is suppressed.
const { scheduleRestEnd, cancelRestEnd, onAlarm } = require('../push-worker/rest-end.b6.js');
let fails = 0; const rec = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

function stubKV() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async (pre) => [...m.keys()].filter((k) => k.indexOf(pre) === 0) };
}
function fakeAlarm(startMs) { let armed = null, t = startMs; return { set: async (ms) => { armed = ms; }, now: () => t, advanceTo: (ms) => { t = ms; }, armed: () => armed }; }
const mkRec = (id, fireAt) => ({ id, userId: 'u1', fireAt, title: 'המנוחה הסתיימה', body: 'לחיצת חזה · סט 2: 16 ק״ג × 6', payload: { type: 'workout', id: 'r1__d', stage: 'restEnd' } });

(async () => {
  const T0 = Date.parse('2026-11-04T16:00:00.000Z');

  // 1) schedule arms the alarm at fireAt
  { const kv = stubKV(), al = fakeAlarm(T0); await kv.put('sub:u1', JSON.stringify({ endpoint: 'x' }));
    await scheduleRestEnd(kv, al, mkRec('a', T0 + 90000));
    rec('schedule stores the push and arms the alarm at the rest end', al.armed() === T0 + 90000 && kv.m.has('rest:a'), 'armed=' + al.armed()); }

  // 2) per-id cancel removes exactly that push, leaves others
  { const kv = stubKV(), al = fakeAlarm(T0);
    await scheduleRestEnd(kv, al, mkRec('a', T0 + 90000)); await scheduleRestEnd(kv, al, mkRec('b', T0 + 120000));
    const r = await cancelRestEnd(kv, 'a', 'u1');
    rec('per-id cancel removes only that id', r.ok && !kv.m.has('rest:a') && kv.m.has('rest:b'), JSON.stringify(r));
    const r2 = await cancelRestEnd(kv, 'a', 'u1'); rec('cancel of a missing id is a no-op ok', r2.ok && r2.missing); }

  // 3) the alarm fires the push within +-5s of the rest end (DO alarm clock)
  { const kv = stubKV(); await kv.put('sub:u1', JSON.stringify({ endpoint: 'x' }));
    const al = fakeAlarm(T0); const sent = [];
    await scheduleRestEnd(kv, al, mkRec('a', T0 + 90000));
    al.advanceTo(T0 + 90000 + 1200);   // DO alarm wakes ~1.2s after fireAt
    const out = await onAlarm(kv, al, async (sub, p) => sent.push(p), null);
    rec('alarm fires the push within +-5s of the rest end', sent.length === 1 && out[0] && out[0].withinTol && out[0].sentLateBy <= 5000, JSON.stringify(out));
    rec('the fired push carries the restEnd copy + payload', sent[0] && sent[0].title === 'המנוחה הסתיימה' && sent[0].payload.stage === 'restEnd', JSON.stringify(sent[0] && sent[0].payload)); }

  // 4) a foregrounded rest-end is suppressed (the in-app alert already fired)
  { const kv = stubKV(); await kv.put('sub:u1', JSON.stringify({ endpoint: 'x' }));
    const al = fakeAlarm(T0); const sent = [];
    await scheduleRestEnd(kv, al, mkRec('a', T0 + 90000)); al.advanceTo(T0 + 90000 + 800);
    const out = await onAlarm(kv, al, async (sub, p) => sent.push(p), async () => true);
    rec('foregrounded rest-end is suppressed (no push sent)', sent.length === 0 && out[0] && out[0].suppressed, JSON.stringify(out)); }

  console.log('\n' + (fails ? 'B6-WORKER: FAIL (' + fails + ')' : 'B6-WORKER: PASS'));
  process.exit(fails ? 1 : 0);
})();
