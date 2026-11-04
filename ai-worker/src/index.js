// alfred-ai — single AI gateway for the Alfred PWA.
// Logs: status / model / latency only. Never message content, never the key.
import config from '../config/models.js';
import { buildMessages } from './prompt.js';
import { parseModelJson, validateReply } from './contract.js';
import { callOpenRouter, callWorkersAI, listEligible } from './providers.js';

const VERSION = 'c0-skeleton';

function originAllowed(origin, env) {
  if (!origin) return false;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  return env.ALLOW_LOCALHOST === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (obj, status, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function readBody(request, env) {
  const max = +(env.MAX_BODY || 8192);
  const len = +(request.headers.get('Content-Length') || 0);
  if (len > max) return { error: 'too_large' };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max) return { error: 'too_large' };
  try { return { body: JSON.parse(text || '{}') }; } catch (_) { return { error: 'bad_json' }; }
}

// Dev-only bake-off routes: exist only under `wrangler dev --var DEV_BAKEOFF:1`. Return metrics + model
// output; never the key.
async function devRoute(url, request, env, h) {
  if (url.pathname === '/__dev/models') return json(await listEligible(env), 200, h);
  if (url.pathname === '/__dev/probe' && request.method === 'POST') {
    const { body, error } = await readBody(request, env);
    if (error) return json({ ok: false, error }, 400, h);
    const messages = buildMessages({ text: body.text || '', pasted: !!body.pasted });
    const res = body.layer === 'workers-ai'
      ? await callWorkersAI(env, messages, { model: body.model || config.workersAiModel, schemaMode: body.schemaMode, timeoutMs: body.timeoutMs || 20000 })
      : await callOpenRouter(env, messages, { models: body.models || [body.model], useModelsArray: !!body.useModelsArray, schemaMode: body.schemaMode, reasoningOff: body.reasoningOff, zdr: !!body.zdr, timeoutMs: body.timeoutMs || 20000 });
    const parsed = res.ok ? parseModelJson(res.content) : null;
    const v = parsed ? validateReply(parsed) : { ok: false, errors: [res.ok ? 'unparseable JSON' : 'no content'] };
    return json({ ...res, parsed, valid: v.ok, validationErrors: v.errors }, 200, h);
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = originAllowed(origin, env);
    const h = allowed ? cors(origin) : {};

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: h });

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, service: 'alfred-ai', version: VERSION, chain: config.chain.length ? config.chain : 'not configured', workersAi: config.workersAiModel, openrouterKey: !!env.OPENROUTER_API_KEY }, 200, h);
    }

    if (env.DEV_BAKEOFF === '1' && url.pathname.startsWith('/__dev/')) {
      const r = await devRoute(url, request, env, h);
      if (r) return r;
    }

    if (url.pathname === '/assist') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, h);
      if (!allowed) return json({ ok: false, error: 'origin_not_allowed' }, 403);
      const { error } = await readBody(request, env);
      if (error === 'too_large') return json({ ok: false, error: 'too_large', message: 'ההודעה ארוכה מדי (מעל 8KB)' }, 413, h);
      if (error) return json({ ok: false, error }, 400, h);
      return json({ ok: false, degraded: true, error: 'not_built', message: 'השער עדיין בבנייה (C1)' }, 501, h);
    }

    return json({ ok: false, error: 'not_found' }, 404, h);
  },
};
