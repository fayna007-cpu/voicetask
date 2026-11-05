// Provider chain: total budget, per-layer timeout, one retry (timeout/5xx only, if budget remains),
// hedging (start the next layer if the current one is silent for hedgeAfterMs), first VALID output wins.
// KV state per layer  L:<id> = {f: consecutive failures, until: epoch ms, why: 'breaker'|'quota'}
// KV writes happen only on failure, trip, quota and reset-from-nonzero (free plan: 1,000 writes/day).
import { parseModelJson, validateReply, normalise } from './contract.js';

// KV state (writes only on change — free plan allows 1,000 writes/day):
//   Q:<layer>    daily-quota skip, per MODEL            {until}
//   M:<layer>    model missing at the provider (404)    {model, since, until}   -> yellow line in settings
//   L:<layer>    invalid-output breaker, per MODEL      {f, until}
//   P:<provider> network/timeout/5xx breaker, per PROVIDER {f, until}           -> a Groq outage skips both Groq layers
export const stateKeys = (L) => ['Q:' + L.id, 'M:' + L.id, 'L:' + L.id, 'P:' + L.provider];
export async function loadStates(env, layers) {
  const keys = [...new Set(layers.flatMap(stateKeys))], out = {};
  await Promise.all(keys.map(async (k) => { out[k] = (env.STATE && (await env.STATE.get(k, 'json'))) || null; }));
  return out;
}
export function skipInfo(L, st, now) {
  for (const k of stateKeys(L)) {
    const s = st[k];
    if (s && s.until && s.until > now) return { layer: L.id, key: k, until: s.until, why: k[0] === 'Q' ? 'quota' : k[0] === 'M' ? 'missing' : 'breaker' };
  }
  return null;
}
// One finished attempt -> list of [key, value|null] writes (null = delete). Mutate-free; caller applies in order.
export function planWrites(a, L, st, now, B) {
  const w = [], P = 'P:' + L.provider, LL = 'L:' + L.id, M = 'M:' + L.id;
  if (a.cancelled) return w;                                           // lost a hedge race: not a failure
  if (a.valid) {
    if (st[P] && (st[P].f || st[P].until)) w.push([P, { f: 0 }]);
    if (st[LL] && (st[LL].f || st[LL].until)) w.push([LL, { f: 0 }]);
    if (st[M]) w.push([M, null]);                                      // the model is back: clear the flag
    return w;
  }
  if (a.quotaUntil) return [['Q:' + L.id, { until: a.quotaUntil }]];
  if (a.missing) return st[M] && st[M].until > now ? w : [[M, { model: L.model, since: now, until: now + B.missingSkipMs }]];
  const key = a.retryable ? P : LL;
  if (st[key] && st[key].until > now) return w;                        // already tripped (e.g. by the other Groq layer): keep it
  const f = ((st[key] && st[key].f) || 0) + 1;
  w.push([key, f >= B.breakerFails ? { f: 0, until: now + B.breakerSkipMs } : { f }]);
  return w;
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
    quotaUntil: a.quotaUntil || null, missing: !!a.missing, retryable: !!a.retryable, cancelled: a.error === 'cancelled', retried, latencyMs: Date.now() - t0, tokens: a.tokens || null };
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
