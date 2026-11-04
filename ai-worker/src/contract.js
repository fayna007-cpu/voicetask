// Output contract between the model and the app. Model output is UNTRUSTED: it is validated and
// normalised here (no dependencies); the client still escapes every string before rendering.
// Empty fields may be omitted by the model (output-token economy); normalise() fills them back in.
export const CATEGORIES = ['אישי', 'מקצועי', 'כללי'];
// Action intents (C2, optional): the model only copies raw phrases into `action`; the CLIENT finds the item
// on the device and always asks for confirmation. An old client ignores `action` and shows `reply` as chat,
// so every action reply is non-empty (normalise() fills a default).
export const ACTIONS = ['reschedule', 'complete', 'delete', 'skip_routine'];
export const INTENTS = ['chat', 'add_tasks', 'add_routine', 'query', 'other', ...ACTIONS];
export const RANGES = ['today', 'tomorrow', 'week', 'overdue'];   // 'query': the CLIENT answers from local data
export const MAX_TASKS = 20;
const LIMITS = { reply: 400, title: 120, date_text: 40, time_text: 40, notes: 300 };
const TASK_KEYS = ['title', 'category', 'date_text', 'time_text', 'notes'];
const ACTION_REPLY = 'אפשר לעשות את זה מהאפליקציה';

const str = (max) => ({ type: 'string', maxLength: max });
export const CONTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'reply'],
  properties: {
    intent: { type: 'string', enum: INTENTS },
    reply: str(LIMITS.reply),
    filter: {
      type: 'object',
      additionalProperties: false,
      required: ['range'],
      properties: { range: { type: 'string', enum: RANGES }, category: { type: 'string', enum: CATEGORIES } },
    },
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['target'],
      properties: {
        target: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: str(LIMITS.title), day_text: str(LIMITS.date_text), time_text: str(LIMITS.time_text), nth: { type: 'integer', minimum: -1, maximum: 9 } },
        },
        new_day_text: str(LIMITS.date_text),
        new_time_text: str(LIMITS.time_text),
      },
    },
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
  for (const k of Object.keys(o)) if (!['intent', 'reply', 'tasks', 'filter', 'action'].includes(k)) errors.push('extra key ' + k);
  if (!INTENTS.includes(o.intent)) errors.push('bad intent');
  const isAction = ACTIONS.includes(o.intent);
  if (isAction) {
    const a = o.action, t = a && a.target;
    if (!a || typeof a !== 'object' || Array.isArray(a) || !t || typeof t !== 'object' || Array.isArray(t) || !isStr(t.text) || !t.text.trim() || t.text.length > LIMITS.title) errors.push('action without a valid target.text');
    else {
      for (const k of Object.keys(a)) if (!['target', 'new_day_text', 'new_time_text'].includes(k)) errors.push('extra action key ' + k);
      for (const k of Object.keys(t)) if (!['text', 'day_text', 'time_text', 'nth'].includes(k)) errors.push('extra target key ' + k);
      for (const k of ['day_text', 'time_text']) if (!optStr(t[k], LIMITS.date_text)) errors.push('bad target.' + k);
      for (const k of ['new_day_text', 'new_time_text']) if (!optStr(a[k], LIMITS.date_text)) errors.push('bad ' + k);
      if (!(t.nth === undefined || t.nth === null || (Number.isInteger(t.nth) && t.nth >= -1 && t.nth <= 9))) errors.push('bad target.nth');
    }
    if (o.reply === undefined || o.reply === null) o.reply = '';   // normalise() fills a default for old clients
  } else if (o.action !== undefined && o.action !== null) errors.push('action on a non-action intent');
  if (o.intent === 'query') {
    const f = o.filter;
    if (!f || typeof f !== 'object' || Array.isArray(f) || !RANGES.includes(f.range)) errors.push('query without a valid filter.range');
    else {
      for (const k of Object.keys(f)) if (!['range', 'category'].includes(k)) errors.push('extra filter key ' + k);
      if (!(f.category === undefined || f.category === null || f.category === '' || CATEGORIES.includes(f.category))) errors.push('bad filter.category');
    }
    if (o.reply === undefined || o.reply === null) o.reply = '';   // the client writes the answer; reply may be empty here
  }
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
  if (!errors.length && o.intent !== 'query' && !isAction && !o.reply.trim() && !tasks.length) errors.push('empty reply');      // never an empty answer
  if (!errors.length && (o.intent === 'add_tasks' || o.intent === 'add_routine') && !tasks.length) errors.push('task intent without tasks');
  return { ok: !errors.length, errors };
}

// Valid object -> fixed shape the client can rely on (every field present, trimmed).
export function normalise(o) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = {
    intent: o.intent,
    reply: s(o.reply),
    tasks: o.intent === 'query' || ACTIONS.includes(o.intent) ? [] : (o.tasks || []).map((t) => ({ title: s(t.title), category: CATEGORIES.includes(t.category) ? t.category : '', date_text: s(t.date_text), time_text: s(t.time_text), notes: s(t.notes) })),
  };
  if (o.intent === 'query') out.filter = { range: o.filter.range, category: CATEGORIES.includes(o.filter.category) ? o.filter.category : '' };
  if (ACTIONS.includes(o.intent)) {
    const t = o.action.target;
    out.reply = out.reply || ACTION_REPLY;
    out.action = { target: { text: s(t.text), day_text: s(t.day_text), time_text: s(t.time_text), nth: Number.isInteger(t.nth) ? t.nth : null }, new_day_text: s(o.action.new_day_text), new_time_text: s(o.action.new_time_text) };
  }
  return out;
}

// Replies that claim to know the user's tasks/schedule/day. The model cannot see them, so any such claim
// is invented. Shared by the bake-off gate; the client keeps its own copy of the same guard.
export const FABRICATION = /יש לך \d+ (משימות|פגישות|אירועים)|היום יש לך|מחר יש לך|השבוע יש לך|יש לך (יום|שבוע) (עמוס|פנוי|רגוע|מלא)|(היום|השבוע|המחר|היומן) שלך (עמוס|פנוי|נראה|מלא|ריק)|אין לך (משימות|פגישות|כלום)|פספסת (את|\d)|תכננת (ל|את)/;

// Pasted text may only produce tasks or a chat answer (defence in depth; the client checks too).
export function enforceMode(r, mode) {
  if (mode !== 'pasted') return r;
  if (ACTIONS.includes(r.intent)) { const { action, ...rest } = r; return { ...rest, intent: 'chat', tasks: [] }; }   // pasted text never acts
  if (r.intent === 'add_routine') return { ...r, intent: 'add_tasks' };
  if (r.intent === 'other') return { ...r, tasks: [] };
  return r;
}
