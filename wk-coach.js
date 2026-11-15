// wk-coach.js - the live-workout motivator. Three modes, one table. Voice: masculine second person, short, direct, never shaming.
// "under" = below the target: a challenge, not guilt. Placeholders (fill from the user's OWN data only):
//   {target} the set target e.g. 28×8   {done} what he did e.g. 26×8   {pr} e.g. חזה 30×3   {n} sets left   {rest} seconds
// Kinds: start exceed met under pr rest halfway lastSet finish. Use pick(list,lastIndex) so a line never repeats twice in a row.
(function (root) {
  'use strict';
  var MODES = {
    calm: { label: 'רגוע', hint: 'שקט, בלי לחץ',
      start: ['מתחילים בקלילות. הסט הראשון קובע את הקצב', 'בוא ניכנס לאימון. בלי למהר', 'הכל מוכן. סט ראשון כשנוח לך'],
      exceed: ['יפה. יותר מהיעד', 'הרמת מעבר ליעד. נעים לראות', 'סט חזק, בדיוק כמו שצריך'],
      met: ['בדיוק ביעד. יפה', 'סט נקי. ממשיכים', 'עמדת ביעד. טוב'],
      under: ['קצת מתחת ליעד. זה קורה', 'הסט הזה היה קשה. הבא מתחיל מחדש', 'אין בעיה. נחזור ליעד בסט הבא'],
      pr: ['שיא אישי: {pr}. כל הכבוד', 'זה חדש: {pr}. תיהנה מזה', '{pr}. שיא חדש'],
      rest: ['המנוחה נגמרה. כשאתה מוכן', 'זמן לסט הבא, בקצב שלך', 'חזרנו. הסט הבא מחכה'],
      halfway: ['חצי אימון מאחוריך. קצב טוב', 'באמצע הדרך. הכל בסדר', 'חצי כבר עשית'],
      lastSet: ['סט אחרון בתרגיל', 'האחרון בתרגיל. סוגרים יפה', 'עוד אחד ונסגר'],
      finish: ['אימון טוב. נשמר', 'סיימת. כל הכבוד על ההגעה', 'נסגר. תנוח ותשתה'] },
    coach: { label: 'מאמן', hint: 'מעודד ומדויק (ברירת מחדל)',
      start: ['בוא נתחיל. הסט הראשון: {target}', 'הכל מוכן. {target} פותח את האימון', 'היעד הראשון: {target}. לך על זה'],
      exceed: ['מעבר ליעד! {done}', '{done}. חזק מהיעד', 'יותר ממה שביקשתי. {done}'],
      met: ['ביעד. בדיוק כך', '{done}. עמדת במטרה', 'סט מדויק. ממשיכים'],
      under: ['פחות מהיעד. הסט הבא חוזר ל-{target}', 'זה לא כל מה שיש לך. {target} בסט הבא', 'מתחת ליעד. תתרכז ותחזור ל-{target}'],
      pr: ['שיא אישי! {pr}', 'זה חדש: {pr}. תזכור את התחושה', 'שבר את הרף: {pr}'],
      rest: ['המנוחה נגמרה. סט הבא, {target}', 'חזרנו לעבודה. {target}', 'זמן. מרימים'],
      halfway: ['חצי אימון. הקצב מצוין', 'באמצע. עכשיו מחזיקים', 'חצי מאחוריך. נשאר החלק החזק'],
      lastSet: ['סט אחרון. תן הכל', 'האחרון בתרגיל. אל תחסוך', 'עוד אחד ונסגר התרגיל'],
      finish: ['אימון סגור. עבודה אמיתית', 'כל הכבוד. הפעם הבאה כבר מחושבת', 'נעשה. זה בונה התקדמות'] },
    fire: { label: 'אש', hint: 'תובעני וחד',
      start: ['עכשיו עובדים. {target}, בלי מיקוח', 'לא באנו להסתכל. {target}', 'מתחילים חזק. {target}'],
      exceed: ['זה כבר משהו. {done}', '{done}. ככה נראה סט', 'עברת את היעד. תמשיך כך'],
      met: ['ביעד. אפשר יותר, אבל זה טוב', '{done}. עכשיו תעלה את הרף', 'עמדת. עכשיו תרצה יותר'],
      under: ['פחות מהיעד. אתה יכול יותר, {target}', 'זה לא הרף שלך. הסט הבא {target}', 'מתחת ליעד. תחזיר את זה, {target}'],
      pr: ['שיא! {pr}. ככה בונים', '{pr}. זה מה שאני מדבר עליו', 'שבר את השיא: {pr}'],
      rest: ['המנוחה נגמרה. למה מחכים?', 'עוד סט. עכשיו', 'זמן. תרים'],
      halfway: ['חצי. עכשיו מתחיל החלק האמיתי', 'באמצע. אל תרפה', 'חצי אימון. לא עוצרים'],
      lastSet: ['האחרון. זה הסט שקובע', 'סט אחרון. הכל על השולחן', 'עוד אחד. תסגור אותו חזק'],
      finish: ['סיימת. עבודה שווה משהו', 'סגור. תחזור חזק יותר', 'נעשה. הפעם הבאה גבוהה יותר'] }
  };
  var KINDS = ['start', 'exceed', 'met', 'under', 'pr', 'rest', 'halfway', 'lastSet', 'finish'];
  var DEFAULT = 'coach';

  // classify a finished set against its target: reps first, then weight. null target -> 'met' (no judgement without a target)
  function judge(target, done) {
    if (!target || !done) return 'met';
    var tw = target.w == null ? 0 : target.w, dw = done.w == null ? 0 : done.w;
    if (dw > tw || (dw === tw && done.r > target.r)) return 'exceed';
    if (dw < tw || done.r < target.r) return 'under';
    return 'met';
  }
  function pick(list, lastIndex) {
    if (!list || !list.length) return { text: '', index: -1 };
    if (list.length === 1) return { text: list[0], index: 0 };
    var i = Math.floor(Math.random() * list.length);
    if (i === lastIndex) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    return { text: list[i], index: i };
  }
  function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, function (_, k) {
      if (vars && vars[k] != null && vars[k] !== '') return String(vars[k]);
      throw new Error('missing coach variable: ' + k);
    });
  }
  // line(mode, kind, vars, lastIndex) -> {text,index}; only variants whose placeholders are available are used
  function line(mode, kind, vars, lastIndex) {
    var m = MODES[mode] || MODES[DEFAULT], all = m[kind] || [];
    var ok = all.map(function (t, i) { return { t: t, i: i }; }).filter(function (x) {
      return (x.t.match(/\{(\w+)\}/g) || []).every(function (p) { var k = p.slice(1, -1); return vars && vars[k] != null && vars[k] !== ''; });
    });
    if (!ok.length) return { text: '', index: -1 };
    var p = pick(ok.map(function (x) { return x.t; }), ok.findIndex(function (x) { return x.i === lastIndex; }));
    return { text: fill(p.text, vars), index: ok[p.index].i };
  }
  var api = { MODES: MODES, KINDS: KINDS, DEFAULT: DEFAULT, judge: judge, pick: pick, fill: fill, line: line };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WkCoach = api;
})(typeof window !== 'undefined' ? window : this);
