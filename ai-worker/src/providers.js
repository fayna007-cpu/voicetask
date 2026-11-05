// Provider adapters. Every adapter returns the same shape:
//   { ok, status, model, content, error, latencyMs, retryable, quotaUntil }
//   retryable  = timeout or 5xx (the only cases worth one retry)
//   quotaUntil = epoch ms when a DAILY quota resets (skip the layer until then, not the 5-min breaker)
// 402 / 404 / 429 / empty replies are plain provider failures. Never logs content or keys.
import { CONTRACT_SCHEMA } from './contract.js';

export const isFreeId = (id) => typeof id === 'string' && id.endsWith(':free');
// Model churn: the id in config/models.js no longer exists at the provider.
const MISSING = /does not exist|model[^.]{0,40}not found|no endpoints|not a valid model|decommissioned|no such model|\b5007\b/i;
const markMissing = (r) => { if (r.status === 404 || MISSING.test(r.error || '')) { r.missing = true; r.retryable = false; } return r; };
const clip = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : s);
export const nextUtcMidnight = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

function timeoutSignal(ms, outer) {
  const t = AbortSignal.timeout(ms);
  return outer && AbortSignal.any ? AbortSignal.any([t, outer]) : t;
}
const schemaFormat = (strict) => ({ type: 'json_schema', json_schema: { name: 'alfred_reply', strict, schema: CONTRACT_SCHEMA } });

// OpenAI-compatible chat completions (Groq, OpenRouter).
async function chatCompletions(url, key, body, timeoutMs, outer, extraHeaders = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs, outer),
    });
    const j = await r.json().catch(() => ({}));
    const content = j.choices?.[0]?.message?.content ?? null;
    const ok = r.ok && !j.error && typeof content === 'string' && content.trim() !== '';
    const error = j.error ? clip(j.error.message || JSON.stringify(j.error)) : ok ? null : r.ok ? 'empty reply' : 'HTTP ' + r.status;
    return { ok, status: r.status, model: j.model || body.model, content, error, latencyMs: Date.now() - t0, retryable: r.status >= 500, headers: r.headers };
  } catch (e) {
    const aborted = e.name === 'AbortError' && outer && outer.aborted;
    return { ok: false, status: 0, model: body.model, content: null, error: aborted ? 'cancelled' : e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : clip(e.message), latencyMs: Date.now() - t0, retryable: !aborted };
  }
}

export async function callGroq(env, messages, L, timeoutMs, outer) {
  if (!env.GROQ_API_KEY) return { ok: false, status: 0, model: L.model, error: 'missing GROQ_API_KEY', latencyMs: 0, retryable: false };
  const body = {
    model: L.model, messages, temperature: 0.2, max_completion_tokens: L.maxTokens,
    response_format: L.mode === 'json_schema' ? schemaFormat(false) : { type: 'json_object' },
    ...(L.extra || {}),
  };
  const r = await chatCompletions('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, body, timeoutMs, outer);
  // Daily limits (requests/tokens per day) -> skip until retry-after; per-minute limits are plain failures.
  if (r.status === 429 && /per day|\bRPD\b|\bTPD\b/i.test(r.error || '')) {
    const ra = +(r.headers && r.headers.get('retry-after')) || 0;
    r.quotaUntil = Date.now() + (ra > 0 ? ra * 1000 : 60 * 60 * 1000);
  }
  delete r.headers;
  return markMissing(r);
}

export async function callOpenRouter(env, messages, L, timeoutMs, outer) {
  if (!isFreeId(L.model)) return { ok: false, status: 0, model: L.model, error: 'free-only guard: non-:free model id refused', latencyMs: 0, retryable: false };
  if (!env.OPENROUTER_API_KEY) return { ok: false, status: 0, model: L.model, error: 'missing OPENROUTER_API_KEY', latencyMs: 0, retryable: false };
  const body = {
    model: L.model, messages, temperature: 0.2, max_tokens: L.maxTokens,      // ONE model per call, no `models` array
    response_format: L.mode === 'json_schema' ? schemaFormat(false) : { type: 'json_object' },
    provider: { data_collection: 'deny', require_parameters: true },
    ...(L.extra || {}),
  };
  const r = await chatCompletions('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, body, timeoutMs, outer,
    { 'HTTP-Referer': 'https://fayna007-cpu.github.io/voicetask/', 'X-Title': 'Alfred' });
  // The account's free daily quota (not an upstream host 429) -> skip until X-RateLimit-Reset.
  if (r.status === 429 && /per-day|per day|free-models/i.test(r.error || '')) {
    const reset = +(r.headers && r.headers.get('x-ratelimit-reset')) || 0;
    r.quotaUntil = reset > Date.now() ? reset : nextUtcMidnight();
  }
  delete r.headers;
  return markMissing(r);
}

export async function callWorkersAI(env, messages, L, timeoutMs) {
  const t0 = Date.now();
  const response_format = L.mode === 'json_object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: CONTRACT_SCHEMA };
  let timer;
  try {
    const out = await Promise.race([
      env.AI.run(L.model, { messages, response_format, max_tokens: L.maxTokens, temperature: 0.2 }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), timeoutMs); }),
    ]);
    const raw = out && out.response;
    const content = raw && typeof raw === 'object' ? JSON.stringify(raw) : raw ?? null;
    const ok = typeof content === 'string' && content.trim() !== '';
    return { ok, status: ok ? 200 : 0, model: L.model, content, error: ok ? null : 'empty reply', latencyMs: Date.now() - t0, retryable: false };
  } catch (e) {
    const msg = clip(e.message || String(e));
    const r = { ok: false, status: 0, model: L.model, content: null, error: e.name === 'TimeoutError' ? 'timeout' : msg, latencyMs: Date.now() - t0, retryable: e.name === 'TimeoutError' || /\b5\d\d\b|internal/i.test(msg) };
    if (/daily free allocation|neurons/i.test(msg)) { r.quotaUntil = nextUtcMidnight(); r.retryable = false; }   // free neurons reset 00:00 UTC
    return markMissing(r);
  } finally { clearTimeout(timer); }
}

export function callLayer(env, messages, L, timeoutMs, outer) {
  if (L.provider === 'groq') return callGroq(env, messages, L, timeoutMs, outer);
  if (L.provider === 'openrouter') return callOpenRouter(env, messages, L, timeoutMs, outer);
  if (L.provider === 'workers-ai') return callWorkersAI(env, messages, L, timeoutMs);
  return Promise.resolve({ ok: false, status: 0, error: 'unknown provider', latencyMs: 0, retryable: false });
}
