// alfred-ai — single AI gateway for the Alfred PWA.
// Logs: status / layer / model / latency only. Never message content, never keys.
import { LAYERS, CHAIN, BUDGET } from '../config/models.js';
import { buildMessages } from './prompt.js';
import { enforceMode } from './contract.js';
import { callLayer } from './providers.js';
import { runChain, runLayer, loadStates, isSkipped, nextState, capCheck } from './chain.js';

const VERSION = 'c1';
const MODES = ['chat', 'tasks', 'pasted'];

function originAllowed(origin, env) {
  if (!origin) return false;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  return env.ALLOW_LOCALHOST === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
const json = (obj, status, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function readBody(request, env) {
  const max = +(env.MAX_BODY || 8192);
  if (+(request.headers.get('Content-Length') || 0) > max) return { error: 'too_large' };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max) return { error: 'too_large' };
  try { return { body: JSON.parse(text || '{}') }; } catch (_) { return { error: 'bad_json' }; }
}

// Input from the client, re-checked here (the client already masks and trims).
function cleanInput(b) {
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return { error: 'empty_text' };
  const mode = MODES.includes(b.mode) ? b.mode : 'chat';
  const history = (Array.isArray(b.history) ? b.history : []).slice(-6)
    .filter((x) => x && (x.r === 'u' || x.r === 'a') && typeof x.t === 'string').map((x) => ({ r: x.r, t: x.t.slice(0, 300) }));
  const hm = (v, d) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : d);
  const hours = { start: hm(b.hours && b.hours.start, '08:00'), end: hm(b.hours && b.hours.end, '22:00') };
  return { text: text.slice(0, 4000), mode, history, hours };
}

const capMessage = (cap) => {
  const reset = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(new Date().setUTCHours(24, 0, 0, 0)));
  return `הגעת למכסה היומית של העוזר (${cap}). היא מתאפסת הלילה ב-${reset}.`;
};
const chainLayers = () => CHAIN.map((id) => ({ id, ...LAYERS[id] }));
const logLine = (o) => console.log(JSON.stringify(o));        // status/model/latency only

function persistStates(env, ctx, states, attempts) {
  if (!env.STATE) return;
  const now = Date.now();
  for (const a of attempts) {
    const ns = nextState(states[a.layer], a, now, BUDGET);
    if (ns) { states[a.layer] = ns; ctx.waitUntil(env.STATE.put('L:' + a.layer, JSON.stringify(ns), { expirationTtl: 86400 * 3 })); }
  }
}

async function assist(request, env, ctx, h) {
  const { body, error } = await readBody(request, env);
  if (error === 'too_large') return json({ ok: false, error: 'too_large', message: 'ההודעה ארוכה מדי לשליחה (מעל 8KB).' }, 413, h);
  if (error) return json({ ok: false, error }, 400, h);
  const input = cleanInput(body);
  if (input.error) return json({ ok: false, error: input.error, message: 'לא התקבל טקסט.' }, 400, h);

  const cap = await capCheck(env, ctx);
  if (!cap.ok) return json({ ok: false, error: 'daily_cap', message: capMessage(cap.cap), usage: { used: cap.used, cap: cap.cap } }, 429, h);

  const all = chainLayers(), now = Date.now();
  const states = await loadStates(env, all.map((l) => l.id));
  const layers = all.filter((l) => !isSkipped(states[l.id], now));
  const skipped = all.filter((l) => isSkipped(states[l.id], now)).map((l) => ({ layer: l.id, until: states[l.id].until, why: states[l.id].why }));
  const messages = buildMessages({ ...input, now: new Date() });
  const out = await runChain(layers, (L, t, sig) => callLayer(env, messages, L, t, sig), BUDGET);
  persistStates(env, ctx, states, out.attempts);
  const attempts = out.attempts.map((a) => ({ layer: a.layer, model: a.model, status: a.status, ms: a.latencyMs, valid: a.valid, retried: a.retried, error: a.valid ? undefined : a.error }));
  logLine({ t: 'assist', ok: out.ok, layer: out.layer || null, ms: out.totalMs, attempts: attempts.map((a) => `${a.layer}:${a.valid ? 'ok' : a.status || a.error}`) });
  const usage = { used: cap.used, cap: cap.cap };
  if (!out.ok) return json({ ok: false, degraded: true, error: out.error, message: 'העוזר לא זמין כרגע. ההודעה שלך נשמרה.', usage, attempts, skipped }, 200, h);
  return json({ ok: true, layer: out.layer, model: out.model, latencyMs: out.totalMs, result: enforceMode(out.result, input.mode), usage, attempts, skipped }, 200, h);
}

// "בדוק חיבור": ping every configured layer (counts as one request against the daily cap).
async function deepHealth(env, ctx, h) {
  const cap = await capCheck(env, ctx);
  if (!cap.ok) return json({ ok: false, error: 'daily_cap', message: capMessage(cap.cap), usage: { used: cap.used, cap: cap.cap } }, 429, h);
  const all = chainLayers(), now = Date.now(), states = await loadStates(env, all.map((l) => l.id));
  const messages = buildMessages({ text: 'שלום', mode: 'chat', now: new Date() });
  const attempts = await Promise.all(all.map((L) => runLayer((l, t, s) => callLayer(env, messages, l, t, s), L, Date.now() + L.timeoutMs + 500, null, { ...BUDGET, minRetryLeftMs: Infinity })));
  persistStates(env, ctx, states, attempts);
  const layers = all.map((L, i) => ({ layer: L.id, provider: L.provider, model: L.model, ok: attempts[i].valid, ms: attempts[i].latencyMs, status: attempts[i].status, error: attempts[i].valid ? undefined : attempts[i].error,
    skippedUntil: isSkipped(states[L.id], now) ? states[L.id].until : null, why: isSkipped(states[L.id], now) ? states[L.id].why : null }));
  logLine({ t: 'health', layers: layers.map((l) => `${l.layer}:${l.ok ? 'ok' : l.status || l.error}`) });
  return json({ ok: layers.some((l) => l.ok), chain: CHAIN, layers, usage: { used: cap.used, cap: cap.cap } }, 200, h);
}

// Dev-only bake-off routes: exist only under `wrangler dev --var DEV_BAKEOFF:1`. Metrics + model output, never keys.
async function devRoute(url, request, env, h) {
  if (url.pathname === '/__dev/groq-models') {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY } });
    const j = await r.json().catch(() => ({}));
    return json({ status: r.status, ids: (j.data || []).filter((m) => m.active !== false).map((m) => m.id).sort() }, 200, h);
  }
  if (url.pathname === '/__dev/layer' && request.method === 'POST') {       // one configured layer, production code path
    const { body, error } = await readBody(request, env);
    if (error) return json({ ok: false, error }, 400, h);
    const L = LAYERS[body.layer];
    if (!L) return json({ ok: false, error: 'unknown layer' }, 400, h);
    const input = cleanInput(body);
    const messages = buildMessages({ ...input, now: new Date() });
    const a = await runLayer((l, t, s) => callLayer(env, messages, l, t, s), { id: body.layer, ...L, timeoutMs: body.timeoutMs || 20000 }, Date.now() + (body.timeoutMs || 20000) + 1000, null, { ...BUDGET, minRetryLeftMs: Infinity });
    return json({ ...a, result: a.result ? enforceMode(a.result, input.mode) : null }, 200, h);
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = originAllowed(origin, env);
    const h = allowed ? cors(origin) : {};
    ctx = ctx || { waitUntil: () => {} };

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: h });

    if (url.pathname === '/health' && request.method === 'GET') {
      if (url.searchParams.get('deep') === '1') return allowed ? deepHealth(env, ctx, h) : json({ ok: false, error: 'origin_not_allowed' }, 403);
      return json({ ok: true, service: 'alfred-ai', version: VERSION, chain: CHAIN, keys: { groq: !!env.GROQ_API_KEY, openrouter: !!env.OPENROUTER_API_KEY }, ai: !!env.AI }, 200, h);
    }
    if (env.DEV_BAKEOFF === '1' && url.pathname.startsWith('/__dev/')) {
      const r = await devRoute(url, request, env, h);
      if (r) return r;
    }
    if (url.pathname === '/assist') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, h);
      if (!allowed) return json({ ok: false, error: 'origin_not_allowed' }, 403);
      return assist(request, env, ctx, h);
    }
    return json({ ok: false, error: 'not_found' }, 404, h);
  },
};
