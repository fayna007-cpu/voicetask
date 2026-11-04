// Provider chain: total budget, per-layer timeout, one retry (timeout/5xx only, if budget remains),
// hedging (start the next layer if the current one is silent for hedgeAfterMs), first VALID output wins.
// KV state per layer  L:<id> = {f: consecutive failures, until: epoch ms, why: 'breaker'|'quota'}
// KV writes happen only on failure, trip, quota and reset-from-nonzero (free plan: 1,000 writes/day).
import { parseModelJson, validateReply, normalise } from './contract.js';

export async function loadStates(env, ids) {
  const out = {};
  await Promise.all(ids.map(async (id) => { out[id] = (env.STATE && (await env.STATE.get('L:' + id, 'json'))) || { f: 0 }; }));
  return out;
}
export const isSkipped = (s, now) => !!(s && s.until && s.until > now);

// Returns the new state or null when nothing needs to be written.
export function nextState(s, attempt, now, B) {
  s = s || { f: 0 };
  if (attempt.valid) return s.f || s.until ? { f: 0 } : null;
  if (attempt.cancelled) return null;                                  // lost a hedge race: not a failure
  if (attempt.quotaUntil) return { f: 0, until: attempt.quotaUntil, why: 'quota' };
  const f = (s.f || 0) + 1;
  return f >= B.breakerFails ? { f: 0, until: now + B.breakerSkipMs, why: 'breaker' } : { f };
}

async function attemptOnce(call, L, timeoutMs, signal) {
  const r = await call(L, timeoutMs, signal);
  let result = null, errors = [];
  if (r.ok) {
    const parsed = parseModelJson(r.content);
    const v = parsed ? validateReply(parsed) : { ok: false, errors: ['unparseable JSON'] };
    if (v.ok) result = normalise(parsed); else errors = v.errors;
  }
  return { ...r, valid: !!result, result, errors };
}

// One layer with at most one retry. deadline = absolute epoch ms for the whole message.
export async function runLayer(call, L, deadline, signal, B) {
  const t0 = Date.now();
  let a = await attemptOnce(call, L, Math.max(1, Math.min(L.timeoutMs, deadline - Date.now())), signal);
  let retried = false;
  if (!a.valid && a.retryable && !a.quotaUntil && !(signal && signal.aborted) && deadline - Date.now() >= B.minRetryLeftMs) {
    retried = true;
    a = await attemptOnce(call, L, Math.max(1, Math.min(L.timeoutMs, deadline - Date.now())), signal);
  }
  return { layer: L.id, model: a.model || L.model, status: a.status, valid: a.valid, result: a.result, error: a.valid ? null : a.error || (a.errors || []).join(', ') || 'invalid output',
    quotaUntil: a.quotaUntil || null, cancelled: a.error === 'cancelled', retried, latencyMs: Date.now() - t0 };
}

// layers: [{id, ...LAYER}] already filtered (skipped layers removed). call(L, timeoutMs, signal) -> adapter result.
export function runChain(layers, call, B, now = Date.now) {
  const t0 = now(), deadline = t0 + B.totalMs, attempts = [], controllers = [];
  return new Promise((resolve) => {
    let next = 0, running = 0, done = false, hedgeT = null;
    const finish = (r) => {
      if (done) return; done = true;
      clearTimeout(hedgeT); clearTimeout(budgetT);
      controllers.forEach((c) => c.abort());                         // cancel the losers we can cancel
      resolve({ ...r, attempts, totalMs: now() - t0 });
    };
    const budgetT = setTimeout(() => finish({ ok: false, degraded: true, error: 'budget' }), B.totalMs);
    const launch = () => {
      if (done) return;
      if (next >= layers.length) { if (!running) finish({ ok: false, degraded: true, error: layers.length ? 'all_failed' : 'no_layers' }); return; }
      const L = layers[next++], ctrl = new AbortController();
      controllers.push(ctrl); running++;
      clearTimeout(hedgeT);
      hedgeT = setTimeout(launch, B.hedgeAfterMs);                    // hedge: the next layer starts if this one is slow
      runLayer(call, L, deadline, ctrl.signal, B).then((a) => {
        running--; attempts.push(a);
        if (done) return;
        if (a.valid) finish({ ok: true, layer: a.layer, model: a.model, result: a.result, latencyMs: a.latencyMs });
        else if (!running) { clearTimeout(hedgeT); launch(); }        // nothing else in flight -> next layer now
        // (if a hedged layer is still running, its own hedge timer decides when the next one starts)
      });
    };
    launch();
  });
}

// Coarse daily cap: counted in isolate memory, flushed to KV every 5 requests (approximate across isolates).
const capMem = { day: null, base: 0, local: 0 };
export async function capCheck(env, ctx, nowMs = Date.now()) {
  const day = new Date(nowMs).toISOString().slice(0, 10);              // UTC day, same reset as Workers AI
  if (capMem.day !== day) {
    const stored = env.STATE ? +(await env.STATE.get('cap:' + day)) || 0 : 0;
    capMem.day = day; capMem.base = stored; capMem.local = 0;
  }
  const cap = +(env.DAILY_CAP || 150), used = capMem.base + capMem.local;
  if (used >= cap) return { ok: false, used, cap };
  capMem.local++;
  if (capMem.local % 5 === 0 && env.STATE) {
    const p = env.STATE.put('cap:' + day, String(capMem.base + capMem.local), { expirationTtl: 172800 });
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return { ok: true, used: used + 1, cap };
}
export const _resetCapForTests = () => { capMem.day = null; capMem.base = 0; capMem.local = 0; };
