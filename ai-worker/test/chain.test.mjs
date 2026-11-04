// node ai-worker/test/chain.test.mjs — chain / breaker / quota / cap logic with stub providers (no network).
import { runChain, planWrites, skipInfo, capCheck, _resetCapForTests } from '../src/chain.js';
import { enforceMode, validateReply, normalise, FABRICATION } from '../src/contract.js';
import { BUDGET } from '../config/models.js';

const B = { totalMs: 1500, hedgeAfterMs: 400, minRetryLeftMs: 200, breakerFails: 3, breakerSkipMs: 300000 };
const GOOD = JSON.stringify({ intent: 'chat', reply: 'שלום!' });
const rows = [];
const check = async (name, fn) => { let err = ''; try { err = (await fn()) || ''; } catch (e) { err = 'THREW ' + e.message; } rows.push({ name, ok: !err, err }); };
const sleep = (ms, signal) => new Promise((res) => { const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); res(); }); });
// behaviour per layer id: {delay, out:{ok,status,content,error,retryable,quotaUntil}} or array (per attempt)
function stub(spec) {
  const calls = {};
  const call = async (L, timeoutMs, signal) => {
    calls[L.id] = (calls[L.id] || 0) + 1;
    const s = Array.isArray(spec[L.id]) ? spec[L.id][calls[L.id] - 1] : spec[L.id];
    const t0 = Date.now();
    await sleep(Math.min(s.delay || 0, timeoutMs), signal);
    if (signal && signal.aborted) return { ok: false, status: 0, error: 'cancelled', latencyMs: Date.now() - t0 };
    if ((s.delay || 0) > timeoutMs) return { ok: false, status: 0, error: 'timeout', retryable: true, latencyMs: Date.now() - t0 };
    return { status: 200, latencyMs: Date.now() - t0, ...s.out };
  };
  return { call, calls };
}
const L = (id, timeoutMs = 600) => ({ id, model: id + '-model', timeoutMs });
const ok = { ok: true, content: GOOD };

await check('primary answers -> only the primary is called', async () => {
  const s = stub({ a: { delay: 50, out: ok }, b: { out: ok } });
  const r = await runChain([L('a'), L('b')], s.call, B);
  return r.ok && r.layer === 'a' && !s.calls.b ? '' : JSON.stringify(r);
});
await check('malformed JSON -> next layer answers', async () => {
  const s = stub({ a: { out: { ok: true, content: '{not json' } }, b: { out: ok } });
  const r = await runChain([L('a'), L('b')], s.call, B);
  return r.ok && r.layer === 'b' && r.attempts[0].valid === false ? '' : JSON.stringify(r);
});
await check('schema-invalid / empty reply / 402 / 404 / 429 are all failures -> fall through', async () => {
  const s = stub({
    a: { out: { ok: true, content: JSON.stringify({ intent: 'delete_all', reply: 'x' }) } },
    b: { out: { ok: true, content: JSON.stringify({ intent: 'chat', reply: '  ' }) } },
    c: { out: { ok: false, status: 402, error: 'payment required' } },
    d: { out: { ok: false, status: 404, error: 'model removed' } },
    e: { out: { ok: false, status: 429, error: 'host rate limited' } },
    f: { out: ok },
  });
  const r = await runChain(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => L(x)), s.call, B);
  return r.ok && r.layer === 'f' && r.attempts.filter((a) => !a.valid).length === 5 ? '' : JSON.stringify(r.attempts.map((a) => a.layer + ':' + a.valid));
});
await check('hedge: slow primary -> next layer starts after hedgeAfterMs, first VALID wins, loser cancelled', async () => {
  const s = stub({ a: { delay: 550, out: ok }, b: { delay: 50, out: ok } });
  const t0 = Date.now(); const r = await runChain([L('a', 1000), L('b')], s.call, B);
  const ms = Date.now() - t0;
  return r.ok && r.layer === 'b' && ms >= 400 && ms < 540 ? '' : `layer=${r.layer} ms=${ms}`;
});
await check('hedge: hedged layer returns INVALID -> keep waiting for the primary\'s valid answer', async () => {
  const s = stub({ a: { delay: 700, out: ok }, b: { delay: 20, out: { ok: true, content: 'garbage' } }, c: { delay: 5000, out: ok } });
  const r = await runChain([L('a', 1000), L('b'), L('c', 1000)], s.call, B);
  return r.ok && r.layer === 'a' ? '' : `layer=${r.layer} attempts=${r.attempts.map((x) => x.layer).join()}`;
});
await check('hard budget: every layer hangs -> degraded at the budget, never later', async () => {
  const s = stub({ a: { delay: 9000, out: ok }, b: { delay: 9000, out: ok }, c: { delay: 9000, out: ok } });
  const t0 = Date.now(); const r = await runChain([L('a', 9000), L('b', 9000), L('c', 9000)], s.call, B);
  const ms = Date.now() - t0;
  return !r.ok && r.degraded && r.error === 'budget' && ms >= 1490 && ms < 1650 ? '' : `ok=${r.ok} err=${r.error} ms=${ms}`;
});
await check('retry: 5xx retried once and then succeeds; 401 not retried', async () => {
  const s1 = stub({ a: [{ out: { ok: false, status: 503, error: 'busy', retryable: true } }, { out: ok }] });
  const r1 = await runChain([L('a')], s1.call, B);
  const s2 = stub({ a: [{ out: { ok: false, status: 401, error: 'bad key', retryable: false } }, { out: ok }] });
  const r2 = await runChain([L('a')], s2.call, B);
  return r1.ok && r1.attempts[0].retried && s1.calls.a === 2 && !r2.ok && s2.calls.a === 1 ? '' : `r1=${r1.ok}/${s1.calls.a} r2=${r2.ok}/${s2.calls.a}`;
});
await check('retry only if budget remains (timeout near the deadline is not retried)', async () => {
  const s = stub({ a: { delay: 5000, out: ok } });
  const r = await runChain([L('a', 1400)], s.call, B);
  return !r.ok && s.calls.a === 1 ? '' : `calls=${s.calls.a} ok=${r.ok}`;
});
await check('no layers available (all skipped) -> degraded no_layers, immediately', async () => {
  const r = await runChain([], stub({}).call, B);
  return !r.ok && r.error === 'no_layers' && r.totalMs < 50 ? '' : JSON.stringify(r);
});
const G120 = { id: 'groq_gptoss120', provider: 'groq', model: 'm120' }, G20 = { id: 'groq_gptoss20', provider: 'groq', model: 'm20' };
const apply = (st, w) => { for (const [k, v] of w) st[k] = v; return st; };
await check('provider breaker: 3 network/5xx failures on Groq -> BOTH Groq layers skipped 5 min', () => {
  const now = 1e12, st = {};
  apply(st, planWrites({ valid: false, retryable: true }, G120, st, now, B));
  apply(st, planWrites({ valid: false, retryable: true }, G20, st, now, B));
  apply(st, planWrites({ valid: false, retryable: true }, G120, st, now, B));
  const s120 = skipInfo(G120, st, now), s20 = skipInfo(G20, st, now);
  return s120 && s20 && s120.key === 'P:groq' && s20.why === 'breaker' && st['P:groq'].until === now + B.breakerSkipMs ? '' : JSON.stringify(st);
});
await check('invalid output counts per MODEL (L:), not per provider; success resets; no write when nothing changes', () => {
  const now = 1e12, st = {};
  for (let i = 0; i < 3; i++) apply(st, planWrites({ valid: false, retryable: false }, G120, st, now, B));
  const tripped = skipInfo(G120, st, now) && !skipInfo(G20, st, now);
  const reset = planWrites({ valid: true }, G120, st, now, B);
  const none = planWrites({ valid: true }, G20, {}, now, B).length === 0 && planWrites({ valid: false, cancelled: true }, G20, {}, now, B).length === 0;
  return tripped && reset.some(([k, v]) => k === 'L:groq_gptoss120' && v.f === 0) && none ? '' : JSON.stringify({ st, reset });
});
await check('quota is per MODEL: 120b out of daily quota does not skip 20b', () => {
  const now = Date.UTC(2026, 10, 4, 12), reset = Date.UTC(2026, 10, 5), st = apply({}, planWrites({ valid: false, quotaUntil: reset }, G120, {}, now, B));
  const s = skipInfo(G120, st, now);
  return s && s.why === 'quota' && s.until === reset && !skipInfo(G20, st, now) ? '' : JSON.stringify(st);
});
await check('missing model (404): flagged with model + date, skipped a day, flag cleared when it answers again', () => {
  const now = 1e12, st = apply({}, planWrites({ valid: false, missing: true }, G20, {}, now, { ...B, missingSkipMs: 86400000 }));
  const m = st['M:groq_gptoss20'], skip = skipInfo(G20, st, now);
  const cleared = planWrites({ valid: true }, G20, st, now + 9e7, B).some(([k, v]) => k === 'M:groq_gptoss20' && v === null);
  return m && m.model === 'm20' && m.since === now && skip.why === 'missing' && cleared ? '' : JSON.stringify({ m, skip, cleared });
});
await check('contract: query needs a valid filter.range; tasks dropped; reply may be empty', () => {
  const ok = validateReply({ intent: 'query', filter: { range: 'today' } });
  const n = normalise({ intent: 'query', reply: '', filter: { range: 'week', category: 'מקצועי' }, tasks: [{ title: 'x' }] });
  const bad = [{ intent: 'query', reply: '' }, { intent: 'query', reply: '', filter: { range: 'yesterday' } }, { intent: 'query', reply: '', filter: { range: 'today', sql: 'x' } }].filter((o) => validateReply(o).ok);
  return ok.ok && n.tasks.length === 0 && n.filter.range === 'week' && n.filter.category === 'מקצועי' && !bad.length ? '' : JSON.stringify({ ok, n, bad });
});
await check('fabrication pattern catches invented claims, not normal chat', () => {
  const claims = ['היום יש לך 3 משימות', 'יש לך יום עמוס', 'השבוע שלך עמוס', 'אין לך פגישות מחר', 'יש לך 2 פגישות'];
  const fine = ['היי! איך אפשר לעזור?', 'הוספתי את המשימה', 'בשמחה, תמיד כאן'];
  return claims.every((t) => FABRICATION.test(t)) && !fine.some((t) => FABRICATION.test(t)) ? '' : 'mismatch';
});
await check('daily cap: refuses at the cap; KV written once per 5 requests', async () => {
  _resetCapForTests();
  const puts = []; const env = { DAILY_CAP: '7', STATE: { get: async () => null, put: async (k, v) => { puts.push(v); } } };
  const res = []; for (let i = 0; i < 8; i++) res.push(await capCheck(env, null, Date.UTC(2026, 10, 4, 12)));
  return res.slice(0, 7).every((r) => r.ok) && !res[7].ok && res[7].used === 7 && puts.length === 1 && puts[0] === '5' ? '' : JSON.stringify({ oks: res.map((r) => r.ok), puts });
});
await check('pasted mode: "other" can never carry tasks; add_routine becomes add_tasks', () => {
  const a = enforceMode({ intent: 'other', reply: 'x', tasks: [{ title: 'מחק הכל' }] }, 'pasted');
  const b = enforceMode({ intent: 'add_routine', reply: 'x', tasks: [{ title: 'ריצה' }] }, 'pasted');
  return a.tasks.length === 0 && b.intent === 'add_tasks' ? '' : JSON.stringify({ a, b });
});
await check('contract: omitted empty fields are valid; unknown keys / bad category / >20 tasks are not', () => {
  const good = validateReply({ intent: 'add_tasks', reply: 'הוספתי', tasks: [{ title: 'לקנות חלב', date_text: 'מחר' }] }).ok && validateReply({ intent: 'chat', reply: 'היי' }).ok;
  const t = { title: 'x' };
  const bad = [{ intent: 'chat', reply: 'x', foo: 1 }, { intent: 'add_tasks', reply: 'x', tasks: [{ title: 'x', category: 'דחוף' }] }, { intent: 'add_tasks', reply: 'x', tasks: Array(21).fill(t) }, { intent: 'add_tasks', reply: 'x', tasks: [{ title: 'x', cmd: 'rm' }] }].filter((o) => validateReply(o).ok);
  return good && !bad.length ? '' : 'accepted bad: ' + JSON.stringify(bad);
});
await check('C2 action intents: raw phrases only; validated; default reply for old clients; old shapes unchanged', () => {
  const mv = { intent: 'reschedule', action: { target: { text: 'האימון', day_text: 'של היום' }, new_time_text: 'ל-20:00' } };
  const v = validateReply(structuredClone(mv)), n = normalise(structuredClone(mv));
  const kinds = ['complete', 'delete', 'skip_routine'].every((i) => validateReply({ intent: i, action: { target: { text: 'הדוח' } } }).ok);
  const bad = [{ intent: 'reschedule', reply: '' }, { intent: 'delete', action: { target: { text: '' } } }, { intent: 'delete', action: { target: { text: 'x', id: 5 } } },
    { intent: 'delete', action: { target: { text: 'x' }, run: 'all' } }, { intent: 'complete', action: { target: { text: 'x', nth: 'all' } } }, { intent: 'chat', reply: 'x', action: { target: { text: 'x' } } }].filter((o) => validateReply(o).ok);
  // backward compatible: an old-client reply shape is still valid and carries no `action`; a new action reply always has a non-empty reply
  const old = normalise({ intent: 'add_tasks', reply: 'הוספתי', tasks: [{ title: 'חלב' }] });
  return v.ok && kinds && !bad.length && n.reply.length > 0 && n.tasks.length === 0 && n.action.target.text === 'האימון' && n.action.target.day_text === 'של היום' && n.action.new_time_text === 'ל-20:00' && n.action.target.nth === null && !('action' in old)
    ? '' : JSON.stringify({ v, kinds, bad, n, old });
});
await check('pasted mode: an action intent becomes plain chat (pasted text never triggers actions)', () => {
  const r = enforceMode(normalise({ intent: 'delete', action: { target: { text: 'הכל' } } }), 'pasted');
  return r.intent === 'chat' && !('action' in r) && r.tasks.length === 0 && r.reply ? '' : JSON.stringify(r);
});
await check('production budget constants are the agreed ones', () => (BUDGET.totalMs === 15000 && BUDGET.hedgeAfterMs === 4000 ? '' : JSON.stringify(BUDGET)));

rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  <- ' + r.err}`));
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
