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
        line: ['בפעם שעברה {last}. מחר מעלים', 'היעד מחר: לעבור את {last}', '{last} זה הרף. מחר מזיזים אותו'],
        cta: 'הכן אותי'
      },
      locked: {
        headline: ['נפתח בעוד {countdown}', 'עוד {countdown} והאימון נפתח', 'הנעילה נשברת ב-{unlock}'],
        line: ['אימון ב-{time}. {last} מחכה לך', 'ב-{time} · בפעם שעברה {last}', 'מתכוננים ל-{time}. היעד: לעבור את {last}'],
        cta: 'פתח עכשיו'
      },
      open: {
        headline: ['הגיע הזמן, אדוני', 'הכל מוכן. זמן לאמן', '{name} פתוח. בוא נתחיל', 'המשקולות מחכות'],
        line: ['בפעם שעברה {last}. היום מעלים', 'היעד להיום: לעבור את {last}', '{last} היה הרף. הוא עומד להישבר'],
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
      start: ['בוא נתחיל. הסט הראשון כבד, והוא קובע את השאר', 'הכל מוכן. הסט הראשון: {target}', 'היעד הראשון: {target}. לך על זה', 'מתחילים. {target} פותח את האימון'],
      afterFirstSet: ['סט ראשון בפנים. אני מחשב את השאר', 'זה הטון של האימון. ממשיכים', 'יפה. השאר מכויל לפי מה שהרמת', 'נכנס. עכשיו אותו דבר, קצת יותר קל'],
      lastSet: ['סט אחרון. תן הכל', 'עוד אחד ונסגר התרגיל', 'האחרון בתרגיל. אל תחסוך', 'כמעט שם. סט אחרון'],
      pr: ['שיא אישי! {pr}', 'זה חדש: {pr}. תזכור את התחושה', 'שבר את הרף: {pr}', '{pr}. הנתון הכי טוב שלך'],
      finish: ['אימון סגור. {sets} סטים, {duration} דק׳', 'כל הכבוד. {sets} סטים בפנים', 'נעשה. הפעם הבאה כבר מוכנה', '{duration} דק׳ של עבודה אמיתית'],
      comebackPostponed: ['האימון הזה נדחה ובכל זאת נעשה. זה מה שבונה התמדה', 'הדחייה מאחוריך. כל הכבוד שחזרת למסלול', 'אימון שנדחה והגיע לסיום. זה שווה זהב', 'בדיוק מה שצריך: הגעת אחרי דחייה'],
      comebackGap: ['טוב שחזרת. ממשיכים משם', 'אין צורך לפצות. מתחילים מהיעד הרגיל', 'הדרך חזרה מתחילה בסט אחד', 'שמח לראות אותך חוזר. נתחיל בקלילות']
    },

    // ── the notification journey (the push server cannot see data: slow-changing facts only) ──
    notify: {
      eveningBefore: {
        title: ['מחר ב-{time}: {name}', 'אימון מחר · {time}', 'מחר מתאמנים'],
        body: ['בפעם שעברה {last}. הכל מוכן?', 'היעד: לעבור את {last}. שינה טובה', '{last} זה הרף. נתראה מחר']
      },
      morning: {
        title: ['היום אימון ב-{time}', '{name} היום', 'היום זה היום'],
        body: ['שתה מים וארגן ציוד. {last} מחכה', 'הציוד בתיק? בפעם שעברה {last}', 'עוד כמה שעות. {last} הרף להיום']
      },
      warmup: {
        title: ['עוד מעט אימון', 'זמן להתחמם', 'האימון מתקרב'],
        body: ['האימון ב-{time}. זמן להתחמם קצת', 'חימום קל עכשיו, ובשעה {time} מתחילים', 'עוד מעט {time}. מתחממים?']
      },
      unlock: {
        title: ['הגיע הזמן', 'האימון נפתח', '🔓 הגיע הזמן'],
        body: ['{name} מחכה. {last} הרף, היום עוברים אותו', 'לחץ והתחל. הסט הראשון כבר מחושב', 'הכל מוכן, אדוני. אפשר להתחיל']
      },
      rescue: {
        title: ['עדיין אפשר', '20 דקות מספיקות', 'האימון עוד פתוח'],
        body: ['אימון מקוצר של 20 דקות עכשיו, או דחייה למחר. מה נוח לך?', 'אין צורך בהכל. 20 דקות שומרות על הקצב', 'אפשר להתחיל מקוצר או לדחות למחר ב-{time}']
      },
      fridayTeaser: {
        title: ['סיכום השבוע מוכן', 'השבוע בשלוש שורות', 'מה השתפר השבוע?'],
        body: ['{n} אימונים השבוע. הנה מה שהתקדם', 'מה התקדם השבוע? הסיכום מחכה', 'הנתונים של השבוע מסודרים. מוכן לראות?']
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
