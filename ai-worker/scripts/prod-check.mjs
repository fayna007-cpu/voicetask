// Production hardening checks against the Worker running WITHOUT dev flags (plain `wrangler dev`).
//   node scripts/prod-check.mjs [--base http://127.0.0.1:8787] [--marker <text>]
// The marker is sent once as message text so the operator can grep the Worker log for it (must be absent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://127.0.0.1:8787');
const MARKER = arg('--marker', 'סימן-בדיקה-' + Date.now().toString(36));
const GH = 'https://fayna007-cpu.github.io';
const rows = [];
const check = async (name, fn) => { let err = ''; try { err = (await fn()) || ''; } catch (e) { err = 'THREW ' + e.message; } rows.push({ name, ok: !err, err }); };
const req = (p, init = {}) => fetch(BASE + p, init);
const J = { 'Content-Type': 'application/json' };

await check('wrangler.toml: ALLOWED_ORIGINS is exactly https://fayna007-cpu.github.io, no dev switch set', () => {
  const toml = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.toml'), 'utf8');
  const m = toml.match(/^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m);
  const dev = /^\s*(ALLOW_LOCALHOST|DEV_BAKEOFF)\s*=/m.test(toml);
  return m && m[1] === GH && !dev ? '' : JSON.stringify({ origins: m && m[1], devSwitch: dev });
});
await check('Origin http://localhost -> preflight 403 and /assist 403', async () => {
  const a = await req('/assist', { method: 'OPTIONS', headers: { Origin: 'http://localhost' } });
  const b = await req('/assist', { method: 'POST', headers: { ...J, Origin: 'http://localhost' }, body: '{"text":"x"}' });
  return a.status === 403 && b.status === 403 && !a.headers.get('access-control-allow-origin') ? '' : `${a.status}/${b.status}`;
});
await check('bake-off/dev routes -> 404 (layer, limits, groq-models)', async () => {
  const s = await Promise.all([
    req('/__dev/layer', { method: 'POST', headers: { ...J, Origin: GH }, body: '{"layer":"workers_ai","text":"x"}' }),
    req('/__dev/limits?layer=groq_gptoss20', { headers: { Origin: GH } }),
    req('/__dev/groq-models', { headers: { Origin: GH } }),
  ]).then((rs) => rs.map((r) => r.status));
  return s.every((x) => x === 404) ? '' : s.join('/');
});
await check('body > 8 KB -> 413', async () => {
  const r = await req('/assist', { method: 'POST', headers: { ...J, Origin: GH }, body: JSON.stringify({ text: 'א'.repeat(5000) }) });
  return r.status === 413 ? '' : String(r.status);
});
await check('wrong method -> 405 (GET /assist)', async () => {
  const r = await req('/assist', { headers: { Origin: GH } });
  return r.status === 405 ? '' : String(r.status);
});
await check('/health exposes only booleans for keys (no key material)', async () => {
  const t = await (await req('/health', { headers: { Origin: GH } })).text();
  const j = JSON.parse(t);
  return typeof j.keys.groq === 'boolean' && typeof j.keys.openrouter === 'boolean' && !/sk-or|gsk_/.test(t) ? '' : t.slice(0, 200);
});
await check('a real /assist from the app origin works (marker message sent for the log check)', async () => {
  const j = await (await req('/assist', { method: 'POST', headers: { ...J, Origin: GH }, body: JSON.stringify({ text: 'הודעה לבדיקה ' + MARKER, mode: 'chat' }) })).json();
  return j.ok ? '' : JSON.stringify(j).slice(0, 200);
});

rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  <- ' + r.err}`));
console.log('MARKER=' + MARKER);
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
