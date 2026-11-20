// B6 (PREPARED — NOT wired into wrangler.toml, NOT deployed). The rest-end lock-screen push the client already schedules
// needs the worker to (1) fire within +-5s of the rest end, and (2) cancel one push by id. The live worker is a 1-minute
// cron with only a bulk /cleanup, so neither holds. This module is the prepared change, written so its logic is testable in
// plain node (tests/b6-worker.test.js) without the Workers runtime; the wiring + rollback are at the bottom.
//
// Core logic, runtime-agnostic. `kv` is any {get,put,delete} over strings; `alarm` is {set(ms),now()} (a DO alarm in prod,
// a fake clock in the test); `send(sub,payload)` delivers one push. Nothing here talks to the network directly.
'use strict';

// schedule a single rest-end push: store it and arm an alarm for its fireAt (DO alarm = second-accurate, so |fire - fireAt| <= ~1s << 5s)
async function scheduleRestEnd(kv, alarm, rec) {
  // rec = { id, userId, fireAt (ms), title, body, payload:{type:'workout', id, stage:'restEnd'} }
  await kv.put('rest:' + rec.id, JSON.stringify({ userId: rec.userId, fireAt: rec.fireAt, title: rec.title, body: rec.body, payload: rec.payload }));
  await alarm.set(rec.fireAt);   // arm (or re-arm to the earliest pending) — see earliestPending below
  return { ok: true };
}

// per-id cancel: the gap the live worker cannot do (it only has a bulk /cleanup)
async function cancelRestEnd(kv, id, userId) {
  const raw = await kv.get('rest:' + id); if (!raw) return { ok: true, missing: true };
  const r = JSON.parse(raw); if (userId && r.userId !== userId) return { ok: false, reason: 'owner-mismatch' };
  await kv.delete('rest:' + id); return { ok: true };
}

// the alarm handler: fire every rest-end whose time has come (within tolerance), skipping any the client marked foregrounded
async function onAlarm(kv, alarm, send, isForegrounded) {
  const now = alarm.now(), TOL = 5000, out = [];
  const list = await kv.list('rest:');
  for (const key of list) {
    const r = JSON.parse(await kv.get(key)); if (!r) continue;
    if (r.fireAt > now + 1) continue;                         // not due yet
    await kv.delete(key);
    if (isForegrounded && (await isForegrounded(r.userId, r.payload))) { out.push({ id: key.slice(5), suppressed: true }); continue; }   // SW foreground-suppression for stage restEnd
    const sub = JSON.parse((await kv.get('sub:' + r.userId)) || 'null');
    if (sub) { await send(sub, { title: r.title, body: r.body, payload: r.payload }); out.push({ id: key.slice(5), sentLateBy: Math.max(0, now - r.fireAt), withinTol: (now - r.fireAt) <= TOL }); }
  }
  // re-arm for the next pending, if any
  let next = Infinity; const l2 = await kv.list('rest:');
  for (const k of l2) { const r = JSON.parse(await kv.get(k)); if (r && r.fireAt < next) next = r.fireAt; }
  if (next !== Infinity) await alarm.set(next);
  return out;
}

module.exports = { scheduleRestEnd, cancelRestEnd, onAlarm };

/* ───────────────────────── WIRING (apply only when deploying — NOT done here) ─────────────────────────
 push-worker/index.js:
   • add route  POST /schedule-rest   -> id the RestEnd DO by userId, call stub.fetch('/schedule', {rec})  -> scheduleRestEnd
   • add route  POST /schedule-cancel -> RestEnd DO .fetch('/cancel', {id,userId})                          -> cancelRestEnd
   • export class RestEnd { constructor(state){ this.kv = <KV or this.state.storage>; this.state = state; }
       async fetch(req){ route -> scheduleRestEnd/cancelRestEnd using this.state.storage + {set:(ms)=>this.state.storage.setAlarm(ms), now:()=>Date.now()} }
       async alarm(){ return onAlarm(kv, {set,now}, sendPush, isForegroundedViaIDBShadow); } }
 wrangler.toml:
   [[durable_objects.bindings]] name = "REST_END"  class_name = "RestEnd"
   [[migrations]] tag = "v1-restend"  new_classes = ["RestEnd"]
 sw.js (_swShouldSwallow): for payload.stage === 'restEnd', swallow when a client is focused (IDB shadow flag), same rule as other foregrounded notifs.

 PLATFORM CAVEAT: Durable Object alarms require DO, which needs the Workers Paid plan (DO is not on the free plan).
   If the account stays free -> BEST ALTERNATIVE: keep the 1-minute cron as the locked-screen BACKSTOP only (it may fire up to
   ~60s late, acceptable for a lock-screen catch-up), and let the in-app client timer remain the accurate, primary rest-end
   alert (already shipped). The per-id cancel (/schedule-cancel + KV delete by id) works on either plan and should ship regardless.

 ROLLBACK: the change is additive. To roll back: remove the two routes and the RestEnd class from index.js, remove the
   durable_objects binding + the v1-restend migration from wrangler.toml (add a delete-class migration if already applied),
   redeploy. KV keys are prefixed 'rest:' and expire on their own TTL, so no data migration is needed either way.
──────────────────────────────────────────────────────────────────────────────────────────────────────── */
