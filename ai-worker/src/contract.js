// Output contract between the model and the app. Model output is UNTRUSTED: everything is
// validated here (no dependencies), and the client escapes every string before rendering.
export const CATEGORIES = ['אישי', 'מקצועי', 'כללי'];
export const INTENTS = ['chat', 'add_tasks', 'add_routine', 'other'];
export const MAX_TASKS = 20;
const LIMITS = { reply: 600, title: 120, category: 10, date_text: 40, time_text: 40, notes: 300 };

const str = (max) => ({ type: 'string', maxLength: max });
export const CONTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'reply', 'tasks'],
  properties: {
    intent: { type: 'string', enum: INTENTS },
    reply: str(LIMITS.reply),
    tasks: {
      type: 'array',
      maxItems: MAX_TASKS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'category', 'date_text', 'time_text', 'notes'],
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
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
  return null;
}

export function validateReply(o) {
  const errors = [];
  const isStr = (v) => typeof v === 'string';
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['not an object'] };
  for (const k of Object.keys(o)) if (!['intent', 'reply', 'tasks'].includes(k)) errors.push('extra key ' + k);
  if (!INTENTS.includes(o.intent)) errors.push('bad intent');
  if (!isStr(o.reply) || o.reply.length > LIMITS.reply) errors.push('bad reply');
  if (!Array.isArray(o.tasks) || o.tasks.length > MAX_TASKS) errors.push('bad tasks');
  else o.tasks.forEach((t, i) => {
    if (!t || typeof t !== 'object') { errors.push(`task ${i} not object`); return; }
    for (const k of Object.keys(t)) if (!(k in LIMITS) || k === 'reply') errors.push(`task ${i} extra key ${k}`);
    for (const k of ['title', 'date_text', 'time_text', 'notes']) if (!isStr(t[k]) || t[k].length > LIMITS[k]) errors.push(`task ${i} bad ${k}`);
    if (!CATEGORIES.includes(t.category)) errors.push(`task ${i} bad category`);
    if (isStr(t.title) && !t.title.trim()) errors.push(`task ${i} empty title`);
  });
  // A reply must never be empty: chat needs text, task intents need tasks or text.
  if (!errors.length && !o.reply.trim() && !(o.tasks && o.tasks.length)) errors.push('empty reply');
  if (!errors.length && (o.intent === 'add_tasks' || o.intent === 'add_routine') && !o.tasks.length) errors.push('task intent without tasks');
  return { ok: !errors.length, errors };
}
