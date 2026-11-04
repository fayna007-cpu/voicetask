// Provider calls. Return shape is the same for every layer:
//   { ok, status, model, content, error, latencyMs }
// Never logs or returns the API key or message content to logs.
import { CONTRACT_SCHEMA } from './contract.js';

const OR_BASE = 'https://openrouter.ai/api/v1';
export const isFreeId = (id) => typeof id === 'string' && id.endsWith(':free');

function orHeaders(env) {
  return {
    Authorization: 'Bearer ' + env.OPENROUTER_API_KEY,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://fayna007-cpu.github.io/voicetask/',
    'X-Title': 'Alfred',
  };
}
const clip = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : s);

// opts: { models:[ids], useModelsArray, schemaMode:'json_schema'|'json_object', reasoningOff, zdr, timeoutMs }
export async function callOpenRouter(env, messages, opts) {
  const t0 = Date.now();
  const models = opts.models || [];
  if (!models.length || !models.every(isFreeId)) return { ok: false, status: 0, error: 'free-only guard: non-:free model id refused', latencyMs: 0 };
  if (!env.OPENROUTER_API_KEY) return { ok: false, status: 0, error: 'missing OPENROUTER_API_KEY', latencyMs: 0 };
  const body = {
    messages,
    max_tokens: 900,
    temperature: 0.2,
    response_format: opts.schemaMode === 'json_object'
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: 'alfred_reply', strict: true, schema: CONTRACT_SCHEMA } },
    provider: { data_collection: 'deny', require_parameters: true, ...(opts.zdr ? { zdr: true } : {}) },
  };
  if (opts.useModelsArray) body.models = models; else body.model = models[0];
  if (opts.reasoningOff !== false) body.reasoning = { effort: 'none' };
  try {
    const r = await fetch(OR_BASE + '/chat/completions', {
      method: 'POST', headers: orHeaders(env), body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs || 6000),
    });
    const j = await r.json().catch(() => ({}));
    const content = j.choices?.[0]?.message?.content ?? null;
    const ok = r.ok && !j.error && typeof content === 'string' && content.trim() !== '';
    return { ok, status: r.status, model: j.model || null, content, error: j.error ? clip(j.error.message || JSON.stringify(j.error)) : (ok ? null : 'empty reply'), latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'TimeoutError' ? 'timeout' : clip(e.message), latencyMs: Date.now() - t0 };
  }
}

// opts: { model, schemaMode, timeoutMs }
export async function callWorkersAI(env, messages, opts) {
  const t0 = Date.now();
  const response_format = opts.schemaMode === 'json_object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: CONTRACT_SCHEMA };
  let timer;
  try {
    const out = await Promise.race([
      env.AI.run(opts.model, { messages, response_format, max_tokens: 900, temperature: 0.2 }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), opts.timeoutMs || 6000); }),
    ]);
    const raw = out && out.response;
    const content = raw && typeof raw === 'object' ? JSON.stringify(raw) : raw ?? null;
    const ok = typeof content === 'string' && content.trim() !== '';
    return { ok, status: ok ? 200 : 0, model: opts.model, content, error: ok ? null : 'empty reply', latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, model: opts.model, error: e.name === 'TimeoutError' ? 'timeout' : clip(e.message), latencyMs: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

// Privacy-first eligibility: only models visible to the owner's account settings (/models/user,
// filtered by "no training on request data"), ending in :free, with the needed parameters.
export async function listEligible(env) {
  const get = async (path, auth) => {
    const r = await fetch(OR_BASE + path, { headers: auth ? orHeaders(env) : {} });
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
    return (await r.json()).data || [];
  };
  const [pub, user, zdr] = await Promise.all([get('/models'), get('/models/user', true), get('/endpoints/zdr')]);
  const userIds = new Set(user.map((m) => m.id));
  const zdrFree = new Set(zdr.filter((e) => isFreeId(e.model_id)).map((e) => e.model_id));
  const row = (m) => ({ id: m.id, inAccount: userIds.has(m.id), zdr: zdrFree.has(m.id), structured: (m.supported_parameters || []).includes('structured_outputs'), jsonMode: (m.supported_parameters || []).includes('response_format') });
  const free = pub.filter((m) => isFreeId(m.id)).map(row);
  return {
    counts: { public: pub.length, account: user.length, freePublic: free.length, freeInAccount: free.filter((m) => m.inAccount).length },
    eligibleStructured: free.filter((m) => m.inAccount && m.structured),
    eligibleJsonOnly: free.filter((m) => m.inAccount && !m.structured && m.jsonMode),
    excludedByAccount: free.filter((m) => !m.inAccount && (m.structured || m.jsonMode)).map((m) => m.id),
  };
}
