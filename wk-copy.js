// wk-copy.js - the Hebrew copy of the workout experience. ONE table: card states, coach lines, notification journey.
// Voice: a warm, respectful friend; masculine second person; short; data-driven; never guilt; emoji only where marked.
// Every list has 3+ variants. Use pick(list, lastIndex) so the same variant never shows twice in a row.
// Placeholders: {name} {day} {time} {unlock} {countdown} {last} {target} {pr} {elapsed} {duration} {sets} {setN} {exN}
//               {exTotal} {n} {mins}. Fill them from the user's OWN data only; never invent numbers.
(function (root) {
  'use strict';

  var COPY = {
    // ── the home routine card, one block per time state ──
    card: {
      far: {
        headline: ['{name} · בעוד {n} ימים', '{name} מחכה ביום {day} ב-{time}', 'האימון הבא: {name}, יום {day}'],
        line: ['בפעם שעברה: {last}', 'נעצרנו ב-{last}', 'נקודת ההתחלה: {last}']
      },
      tomorrow: {
        headline: ['מחר ב-{time} · {name}', 'מחר מתאמנים: {name}, {time}', 'מחר ב-{time}. {name}'],
        line: ['בפעם שעברה {last}', 'נקודת הפתיחה מחר: {last}', '{last} בפעם הקודמת'],
        cta: 'הכן אותי'
      },
      locked: {
        headline: ['נפתח בעוד {countdown}', 'עוד {countdown} והאימון נפתח', 'הנעילה נשברת ב-{unlock}'],
        line: ['אימון ב-{time}. בפעם שעברה {last}', 'ב-{time} · בפעם שעברה {last}', 'מתכוננים ל-{time}. נקודת הפתיחה: {last}'],
        cta: 'פתח עכשיו'
      },
      open: {
        headline: ['הגיע הזמן, אדוני', 'הכל מוכן. זמן לאמן', '{name} פתוח', 'האימון פתוח'],
        line: ['בפעם שעברה {last}', 'נקודת הפתיחה: {last}', '{last} בפעם הקודמת'],
        cta: 'התחל אימון'
      },
      inProgress: {
        headline: ['אימון בעיצומו · {elapsed}', 'באמצע: סט {setN} ממתין', 'האימון פתוח · {elapsed}'],
        line: ['תרגיל {exN} מתוך {exTotal}', 'ממשיכים מסט {setN}', '{sets} סטים כבר מאחוריך'],
        cta: 'המשך אימון'
      },
      done: {
        headline: ['הושלם · {duration} דק׳', 'כל הכבוד, אדוני. {sets} סטים', 'סגרנו אימון · {duration} דק׳'],
        linePR: ['שיא אישי: {pr}', '{pr}. שיא חדש', 'השיא נשבר: {pr}'],
        line: ['נשמר. הפעם הבאה מתחילה מ-{last}', 'הנתונים נשמרו. ההתקדמות כבר מחושבת', 'אימון סגור. היעדים הבאים מוכנים']
      }
    },

    // ── the coach, one short non-blocking line per moment during the live workout ──
    coach: {
      start: ['הסט הראשון קובע את השאר', 'הכל מוכן. הסט הראשון: {target}', 'היעד הראשון: {target}', 'מתחילים. {target} פותח את האימון'],
      afterFirstSet: ['סט ראשון בפנים. אני מחשב את השאר', 'זה הטון של האימון. ממשיכים', 'יפה. השאר מכויל לפי מה שהרמת', 'נכנס. עכשיו אותו דבר, קצת יותר קל'],
      lastSet: ['סט אחרון בתרגיל', 'עוד אחד ונסגר התרגיל', 'האחרון בתרגיל', 'כמעט שם. סט אחרון'],
      pr: ['שיא אישי: {pr}', '{pr}. שיא אישי חדש', 'שברת את הרף: {pr}', '{pr}. הנתון הכי טוב שלך'],
      finish: ['אימון סגור. {sets} סטים, {duration} דק׳', 'כל הכבוד. {sets} סטים בפנים', 'סיימת. היעדים לפעם הבאה כבר מוכנים', '{duration} דק׳ של עבודה אמיתית'],
      comebackPostponed: ['האימון הזה נדחה ובכל זאת נעשה. זה מה שבונה התמדה', 'הדחייה מאחוריך. כל הכבוד שחזרת למסלול', 'אימון שנדחה והגיע לסיום. זה שווה זהב', 'בדיוק מה שצריך: הגעת אחרי דחייה'],
      comebackGap: ['טוב שחזרת. ממשיכים משם', 'אין צורך לפצות. מתחילים מהיעד הרגיל', 'הדרך חזרה מתחילה בסט אחד', 'שמח לראות אותך חוזר. נתחיל בקלילות']
    },

    // ── the notification journey (the push server cannot see data: slow-changing facts only).
    //    Facts first, no guilt, no emoji. 2 rich variants + ONE plain fallback (always fillable) per list. ──
    notify: {
      eveningBefore: {
        title: ['מחר: {muscle}', 'אימון מחר · {time}', 'מחר מתאמנים'],
        body: ['{streak} שבועות ברצף. {hint}. הכול מוכן.', 'מחר {muscle}. {hint}', 'הכול מוכן למחר.']
      },
      morning: {
        title: ['הגיע הזמן. {muscle}', '{muscle}, {mins} דק׳', 'היום אימון'],
        body: ['פעם קודמת {exercise} {lastKg}×{lastReps}. היום היעד {targetKg}. חימום קצר ואתה בפנים.', '{muscle}, {mins} דק׳. חימום קצר ומתחילים.', 'יום אימון. חימום קצר ומתחילים.']
      },
      warmup: {
        title: ['מתחילים בעוד 45 דק׳', 'עוד מעט אימון', 'זמן להתחמם'],
        body: ['{muscle} בקרוב. אפשר להתחיל בחימום עכשיו.', 'עוד 45 דק׳. אפשר להתחיל בחימום.', 'אפשר להתחיל בחימום עכשיו.']
      },
      unlock: {
        title: ['האימון נפתח', 'הגיע הזמן', '{muscle} מחכה'],
        body: ['{muscle} מחכה. {mins} דק׳.', 'הכול מוכן. {mins} דק׳.', 'הכול מוכן. אפשר להתחיל.']
      },
      rescue: {
        title: ['עוד אפשר להספיק', 'האימון עוד פתוח', '20 דקות מספיקות'],
        body: ['{muscle} עדיין פתוח. {mins} דק׳, או רק חימום.', 'עוד אפשר. {mins} דק׳, או רק חימום.', 'עוד אפשר להתחיל, או רק חימום.']
      },
      fridayTeaser: {
        title: ['השבוע {done} מתוך {planned} אימונים', 'סיכום השבוע מוכן', 'סוף שבוע'],
        body: ['{done} מתוך {planned} אימונים השבוע.', 'סוגרים את השבוע בשבת?', 'הסיכום השבועי מוכן.']
      }
    },

    // ── labels and empty states (single strings) ──
    label: {
      readinessFull: 'מלא', readinessLight: 'קל יותר', readinessShort: 'קצר',
      historyEmpty: 'אחרי האימון הראשון תראה כאן את הסטים שלך',
      firstSessionHint: 'הכנס את הסט הראשון, ואציע את השאר'
    }
  };

  // never the same variant twice in a row: pass the previous index, get {text, index}
  function pick(list, lastIndex) {
    if (!list || !list.length) return { text: '', index: -1 };
    if (list.length === 1) return { text: list[0], index: 0 };
    var i = Math.floor(Math.random() * list.length);
    if (i === lastIndex) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    return { text: list[i], index: i };
  }

  // fill {placeholders}; an unknown or missing value is left out loudly so a bug never ships a half-filled sentence
  function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, function (_, k) {
      if (vars && vars[k] != null && vars[k] !== '') return String(vars[k]);
      throw new Error('missing copy variable: ' + k);
    });
  }

  var api = { COPY: COPY, pick: pick, fill: fill };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WkCopy = api;
})(typeof window !== 'undefined' ? window : this);
