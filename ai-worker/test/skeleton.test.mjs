// node ai-worker/test/skeleton.test.mjs   — no dependencies, no network (providers are not called).
import worker from '../src/index.js';
import { validateReply, parseModelJson } from '../src/contract.js';
import { isFreeId, callOpenRouter } from '../src/providers.js';

const ENV = { ALLOWED_ORIGINS: 'https://fayna007-cpu.github.io', DAILY_CAP: '150', MAX_BODY: '8192' };
const GH = 'https://fayna007-cpu.github.io';
const rows = [];
const check = async (name, fn) => { let err = ''; try { err = (await fn()) || ''; } catch (e) { err = 'THREW ' + e.message; } rows.push({ name, ok: !err, err }); };
const req = (path, init = {}) => new Request('https://alfred-ai.example' + path, init);

await check('preflight from the app origin -> 204 + CORS', async () => {
  const r = await worker.fetch(req('/assist', { method: 'OPTIONS', headers: { Origin: GH } }), ENV);
  return r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === GH ? '' : `status ${r.status}`;
});
await check('preflight from another origin -> 403, no CORS header', async () => {
  const r = await worker.fetch(req('/assist', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), ENV);
  return r.status === 403 && !r.headers.get('Access-Control-Allow-Origin') ? '' : `status ${r.status}`;
});
await check('localhost refused unless ALLOW_LOCALHOST=1', async () => {
  const a = await worker.fetch(req('/assist', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080' } }), ENV);
  const b = await worker.fetch(req('/assist', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080' } }), { ...ENV, ALLOW_LOCALHOST: '1' });
  return a.status === 403 && b.status === 204 ? '' : `${a.status}/${b.status}`;
});
await check('/health works and never exposes a key value', async () => {
  const r = await worker.fetch(req('/health', { headers: { Origin: GH } }), { ...ENV, OPENROUTER_API_KEY: 'fake-test-key-SECRET' });
  const t = await r.text();
  return r.status === 200 && !t.includes('SECRET') && JSON.parse(t).keys.openrouter === true ? '' : t;
});
await check('/assist from a foreign origin -> 403', async () => {
  const r = await worker.fetch(req('/assist', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), ENV);
  return r.status === 403 ? '' : `status ${r.status}`;
});
await check('/assist body > 8 KB -> 413 with a Hebrew message', async () => {
  const r = await worker.fetch(req('/assist', { method: 'POST', headers: { Origin: GH }, body: JSON.stringify({ text: 'א'.repeat(5000) }) }), ENV);
  const j = await r.json();
  return r.status === 413 && /8KB/.test(j.message) ? '' : `status ${r.status}`;
});
await check('dev routes do not exist in production (no DEV_BAKEOFF)', async () => {
  const r = await worker.fetch(req('/__dev/layer', { method: 'POST', headers: { Origin: GH }, body: '{}' }), ENV);
  return r.status === 404 ? '' : `status ${r.status}`;
});
await check('free-only guard refuses a non-:free id before any network call', async () => {
  const r = await callOpenRouter({ OPENROUTER_API_KEY: 'x' }, [], { model: 'openai/gpt-5' }, 1000);
  return !r.ok && /free-only/.test(r.error) && isFreeId('a/b:free') && !isFreeId('openrouter/free') ? '' : JSON.stringify(r);
});
await check('validator accepts a correct reply', () => {
  const v = validateReply({ intent: 'add_tasks', reply: 'הוספתי משימה', tasks: [{ title: 'לקנות חלב', category: 'אישי', date_text: 'מחר', time_text: 'ב-18:00', notes: '' }] });
  return v.ok ? '' : v.errors.join();
});
await check('validator rejects: extra key, bad category, empty reply, >20 tasks, task intent w/o tasks', () => {
  const t = { title: 'x', category: 'אישי', date_text: '', time_text: '', notes: '' };
  const bad = [
    { intent: 'chat', reply: 'hi', tasks: [], extra: 1 },
    { intent: 'add_tasks', reply: 'x', tasks: [{ ...t, category: 'דחוף' }] },
    { intent: 'chat', reply: '   ', tasks: [] },
    { intent: 'add_tasks', reply: 'x', tasks: Array(21).fill(t) },
    { intent: 'add_tasks', reply: 'ok', tasks: [] },
  ];
  const passed = bad.filter((o) => validateReply(o).ok);
  return passed.length ? 'accepted: ' + JSON.stringify(passed) : '';
});
await check('parseModelJson tolerates ```json fences and prose, returns null on garbage', () => {
  const a = parseModelJson('```json\n{"intent":"chat","reply":"שלום","tasks":[]}\n```');
  const b = parseModelJson('Sure! {"intent":"chat","reply":"שלום","tasks":[]} hope it helps');
  return a && b && parseModelJson('not json') === null && parseModelJson('') === null ? '' : 'parse failed';
});

rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  <- ' + r.err}`));
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
