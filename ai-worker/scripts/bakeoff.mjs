// Live bake-off: which models actually handle Alfred's Hebrew contract, in what order.
// Talks ONLY to the local `wrangler dev` (which holds the key in .dev.vars); this script never sees the key.
//   1) cd ai-worker && wrangler dev --var ALLOW_LOCALHOST:1 --var DEV_BAKEOFF:1
//   2) node scripts/bakeoff.mjs [--or-budget 45] [--base http://127.0.0.1:8787]
// Resumable: results cache in ai-worker/.bakeoff/ (gitignored). OpenRouter :free = 50 req/day without
// credits, 20/min — the script spaces calls and stops at the budget.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://127.0.0.1:8787');
const OR_BUDGET = +arg('--or-budget', 45);
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.bakeoff');
fs.mkdirSync(DIR, { recursive: true });
const CACHE = path.join(DIR, 'results.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { probes: {}, runs: {} };
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let orCalls = 0;

import { P, score } from './bakeoff-lib.mjs';

async function probe(body) {
  if (body.layer !== 'workers-ai') {
    if (orCalls >= OR_BUDGET) return { skipped: 'budget' };
    orCalls++; await sleep(3200);                       // stay under 20 req/min
  }
  const r = await fetch(BASE + '/__dev/probe', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify(body) });
  return r.json();
}

(async () => {
  const health = await fetch(BASE + '/health', { headers: { Origin: 'http://localhost' } }).then((r) => r.json()).catch((e) => ({ error: e.message }));
  if (!health.ok) { console.log('wrangler dev is not reachable at', BASE, health); process.exit(1); }
  if (!health.openrouterKey) console.log('WARNING: no OPENROUTER_API_KEY in .dev.vars — OpenRouter rows will fail');

  // A) privacy-filtered eligibility
  const elig = cache.elig || (cache.elig = await fetch(BASE + '/__dev/models', { headers: { Origin: 'http://localhost' } }).then((r) => r.json()));
  save();
  if (elig.error) { console.log('eligibility failed:', elig.error); process.exit(1); }
  console.log('Account filter:', JSON.stringify(elig.counts));
  console.log('Eligible :free + structured outputs:', elig.eligibleStructured.map((m) => m.id + (m.zdr ? ' [ZDR]' : '')).join(', ') || 'NONE');
  console.log('Eligible :free + JSON mode only   :', elig.eligibleJsonOnly.map((m) => m.id + (m.zdr ? ' [ZDR]' : '')).join(', ') || 'none');
  console.log('Excluded by your privacy settings :', elig.excludedByAccount.join(', ') || 'none');
  const cands = [...elig.eligibleStructured.map((m) => ({ id: m.id, mode: 'json_schema' })), ...elig.eligibleJsonOnly.map((m) => ({ id: m.id, mode: 'json_object' }))];

  // B) parameter acceptance per candidate: drop what a model rejects, record what it accepted
  for (const c of cands) {
    if (cache.probes[c.id]) { c.cfg = cache.probes[c.id]; continue; }
    const variants = [
      { schemaMode: c.mode, reasoningOff: true, zdr: false },
      { schemaMode: c.mode, reasoningOff: false, zdr: false },
      { schemaMode: 'json_object', reasoningOff: false, zdr: false },
    ];
    for (const v of variants) {
      const r = await probe({ layer: 'openrouter', model: c.id, text: P[0].text, ...v });
      if (r.skipped) break;
      if (r.status === 200 || r.ok) { c.cfg = { ...v, accepted: true, firstError: null }; break; }
      c.cfg = { ...v, accepted: false, lastStatus: r.status, firstError: r.error };
      if (![400, 422].includes(r.status)) break;          // only a parameter error is worth a different variant
    }
    if (c.cfg && c.cfg.accepted) {                          // is this host zero-retention? (OpenRouter enforces zdr:true)
      const z = await probe({ layer: 'openrouter', model: c.id, text: P[6].text, ...c.cfg, zdr: true });
      c.cfg.zdrEnforced = !z.skipped && (z.status === 200 || z.ok);
    }
    if (c.cfg) { cache.probes[c.id] = c.cfg; save(); }
  }

  // C) verify the `models` fallback array on Chat Completions with one live call
  const usable = cands.filter((c) => c.cfg && c.cfg.accepted);
  if (usable.length && !cache.modelsArray) {
    const r = await probe({ layer: 'openrouter', useModelsArray: true, models: ['alfred-test/does-not-exist:free', usable[0].id], text: P[6].text, ...usable[0].cfg });
    if (!r.skipped) { cache.modelsArray = { status: r.status, answeredBy: r.model, ok: !!r.ok, error: r.error || null }; save(); }
  }
  console.log('`models` array check:', JSON.stringify(cache.modelsArray || 'not run'));

  // D) the phrases: every usable candidate + Workers AI
  const layers = [...usable.map((c) => ({ key: c.id, body: { layer: 'openrouter', model: c.id, ...c.cfg } })), { key: 'workers-ai', body: { layer: 'workers-ai' } }];
  for (const L of layers) {
    cache.runs[L.key] = cache.runs[L.key] || {};
    for (const p of P) {
      if (cache.runs[L.key][p.id]) continue;
      const r = await probe({ ...L.body, text: p.text, pasted: !!p.pasted });
      if (r.skipped) break;
      cache.runs[L.key][p.id] = { status: r.status, latencyMs: r.latencyMs, model: r.model, valid: r.valid, errors: r.validationErrors, error: r.error, parsed: r.parsed, score: score(p, r) };
      save();
    }
  }

  // E) report
  const rows = [];
  for (const [k, runs] of Object.entries(cache.runs)) {
    const v = Object.values(runs); if (!v.length) continue;
    const pct = (f) => Math.round(100 * v.filter(f).length / v.length);
    const lat = v.map((x) => x.latencyMs || 0).sort((a, b) => a - b);
    rows.push({ layer: k, n: `${v.length}/${P.length}`, validJSON: pct((x) => x.score.valid), intent: pct((x) => x.score.intent), rawTimes: pct((x) => x.score.times), safe: pct((x) => x.score.safe), hebrew: pct((x) => x.score.hebrew), computedDates: v.filter((x) => x.score.iso).length, p50ms: lat[Math.floor(lat.length / 2)], p90ms: lat[Math.floor(lat.length * 0.9)] });
  }
  rows.sort((a, b) => (b.validJSON + b.intent + b.rawTimes + b.safe) - (a.validJSON + a.intent + a.rawTimes + a.safe) || a.p50ms - b.p50ms);
  console.table(rows);
  const md = ['| layer | n | valid JSON % | intent % | raw times % | injection-safe % | Hebrew % | computed dates | p50 ms | p90 ms |', '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.layer} | ${r.n} | ${r.validJSON} | ${r.intent} | ${r.rawTimes} | ${r.safe} | ${r.hebrew} | ${r.computedDates} | ${r.p50ms} | ${r.p90ms} |`)];
  fs.writeFileSync(path.join(DIR, 'report.md'), md.join('\n') + '\n');
  console.log(`OpenRouter calls this run: ${orCalls}/${OR_BUDGET}. Report: .bakeoff/report.md (raw outputs in results.json for the Hebrew-quality read)`);
})();
