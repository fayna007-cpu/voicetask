// Output contract between the model and the app. Model output is UNTRUSTED: it is validated and
// normalised here (no dependencies); the client still escapes every string before rendering.
// Empty fields may be omitted by the model (output-token economy); normalise() fills them back in.
export const CATEGORIES = ['אישי', 'מקצועי', 'כללי'];
export const INTENTS = ['chat', 'add_tasks', 'add_routine', 'other'];
export const MAX_TASKS = 20;
const LIMITS = { reply: 400, title: 120, date_text: 40, time_text: 40, notes: 300 };
const TASK_KEYS = ['title', 'category', 'date_text', 'time_text', 'notes'];

const str = (max) => ({ type: 'string', maxLength: max });
export const CONTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'reply'],
  properties: {
    intent: { type: 'string', enum: INTENTS },
    reply: str(LIMITS.reply),
    tasks: {
      type: 'array',
      maxItems: MAX_TASKS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: str(LIMITS.title),
          category: { type: 'string', enum: CATEGORIES },
          date_text: str(LIMITS.date_text),
          time_text: str(LIMITS.time_text),
          notes: str(LIMITS.notes),
        },
      },
    },
  },
};

// Model text -> object. Tolerates ```json fences and leading prose (json_object-mode models),
// but the result must still pass validateReply().
export function parseModelJson(text) {
  if (text && typeof text === 'object') return text;           // Workers AI may return an object already
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
  return null;
}

export function validateReply(o) {
  const errors = [];
  const isStr = (v) => typeof v === 'string';
  const optStr = (v, max) => v === undefined || v === null || (isStr(v) && v.length <= max);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['not an object'] };
  for (const k of Object.keys(o)) if (!['intent', 'reply', 'tasks'].includes(k)) errors.push('extra key ' + k);
  if (!INTENTS.includes(o.intent)) errors.push('bad intent');
  if (!isStr(o.reply) || o.reply.length > LIMITS.reply) errors.push('bad reply');
  const tasks = o.tasks === undefined || o.tasks === null ? [] : o.tasks;
  if (!Array.isArray(tasks) || tasks.length > MAX_TASKS) errors.push('bad tasks');
  else tasks.forEach((t, i) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) { errors.push(`task ${i} not object`); return; }
    for (const k of Object.keys(t)) if (!TASK_KEYS.includes(k)) errors.push(`task ${i} extra key ${k}`);
    if (!isStr(t.title) || !t.title.trim() || t.title.length > LIMITS.title) errors.push(`task ${i} bad title`);
    for (const k of ['date_text', 'time_text', 'notes']) if (!optStr(t[k], LIMITS[k])) errors.push(`task ${i} bad ${k}`);
    if (!(t.category === undefined || t.category === null || t.category === '' || CATEGORIES.includes(t.category))) errors.push(`task ${i} bad category`);
  });
  if (!errors.length && !o.reply.trim() && !tasks.length) errors.push('empty reply');      // never an empty answer
  if (!errors.length && (o.intent === 'add_tasks' || o.intent === 'add_routine') && !tasks.length) errors.push('task intent without tasks');
  return { ok: !errors.length, errors };
}

// Valid object -> fixed shape the client can rely on (every field present, trimmed).
export function normalise(o) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    intent: o.intent,
    reply: s(o.reply),
    tasks: (o.tasks || []).map((t) => ({ title: s(t.title), category: CATEGORIES.includes(t.category) ? t.category : '', date_text: s(t.date_text), time_text: s(t.time_text), notes: s(t.notes) })),
  };
}

// Pasted text may only produce tasks or a chat answer (defence in depth; the client checks too).
export function enforceMode(r, mode) {
  if (mode !== 'pasted') return r;
  if (r.intent === 'add_routine') return { ...r, intent: 'add_tasks' };
  if (r.intent === 'other') return { ...r, tasks: [] };
  return r;
}
