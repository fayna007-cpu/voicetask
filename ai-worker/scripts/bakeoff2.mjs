// Round 2: the same 20 phrases on configured layers through the PRODUCTION code path (runLayer + adapters).
//   cd ai-worker && wrangler dev --var ALLOW_LOCALHOST:1 --var DEV_BAKEOFF:1
//   node scripts/bakeoff2.mjs --layers groq_llama70,groq_gptoss120,groq_8b,workers_ai [--out round2]
// Talks only to the local dev Worker (which holds the keys); never sees a key. Resumable cache in .bakeoff/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, score } from './bakeoff-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://127.0.0.1:8787');
const LAYERS = arg('--layers', 'groq_llama70,groq_gptoss120,groq_8b,workers_ai').split(',');
const OUT = arg('--out', 'round2');
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.bakeoff');
fs.mkdirSync(DIR, { recursive: true });
const CACHE = path.join(DIR, OUT + '.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Minimum spacing per layer so per-minute limits are not what we measure (gpt-oss free TPM is 8K).
const SPACING = { groq_gptoss120: 13000, groq_gptoss20: 13000, groq_qwen27: 7000, or_xing: 3500, workers_ai: 0 };
const last = {};
const H = { 'Content-Type': 'application/json', Origin: 'http://localhost' };

(async () => {
  const health = await fetch(BASE + '/health', { headers: H }).then((r) => r.json()).catch((e) => ({ error: e.message }));
  if (!health.ok) { console.log('dev Worker not reachable', health); process.exit(1); }
  console.log('keys present:', JSON.stringify(health.keys));
  if (LAYERS.some((l) => l.startsWith('groq'))) {
    const g = await fetch(BASE + '/__dev/groq-models', { headers: H }).then((r) => r.json());
    console.log('Groq models API: HTTP', g.status, '|', g.ids.length, 'active models');
    for (const id of ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']) console.log('  ', id, g.ids.includes(id) ? 'available' : 'NOT AVAILABLE');
  }
  for (const p of P) {                                  // interleave layers per phrase
    for (const layer of LAYERS) {
      cache[layer] = cache[layer] || {};
      if (cache[layer][p.id]) continue;
      const wait = (last[layer] || 0) + (SPACING[layer] || 0) - Date.now();
      if (wait > 0) await sleep(wait);
      last[layer] = Date.now();
      const r = await fetch(BASE + '/__dev/layer', { method: 'POST', headers: H, body: JSON.stringify({ layer, text: p.text, mode: p.pasted ? 'pasted' : 'chat' }) }).then((x) => x.json()).catch((e) => ({ error: e.message }));
      const asRound1 = { valid: r.valid, parsed: r.result };
      cache[layer][p.id] = { status: r.status, ms: r.latencyMs, model: r.model, valid: r.valid, error: r.valid ? null : r.error, retried: r.retried, result: r.result, score: score(p, asRound1) };
      save();
      process.stdout.write(`${p.id} ${layer} ${r.valid ? 'ok' : 'FAIL ' + (r.status || '') + ' ' + (r.error || '').slice(0, 60)} ${r.latencyMs}ms\n`);
    }
  }
  const rows = [];
  for (const layer of LAYERS) {
    const v = Object.values(cache[layer] || {}); if (!v.length) continue;
    const pct = (f) => Math.round(100 * v.filter(f).length / v.length);
    const lat = v.filter((x) => x.valid).map((x) => x.ms).sort((a, b) => a - b);
    rows.push({ layer, n: v.length, validJSON: pct((x) => x.score.valid), intent: pct((x) => x.score.intent), rawTimes: pct((x) => x.score.times), injectionSafe: pct((x) => x.score.safe), hebrew: pct((x) => x.score.hebrew), computedDates: v.filter((x) => x.score.iso).length, p50: lat[Math.floor(lat.length / 2)] || null, p90: lat[Math.floor(lat.length * 0.9)] || null });
  }
  console.table(rows);
  fs.writeFileSync(path.join(DIR, OUT + '-table.json'), JSON.stringify(rows, null, 1));
})();
