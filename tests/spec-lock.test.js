// node tests/spec-lock.test.js — SPEC-LOCK: grep the source for every exact Hebrew string and fixed px size the
// Session 3 spec names. Fails if any is missing. Runs in the final gate. (String presence, not behavior.)
const fs = require('fs');
const path = require('path');
const read = (f) => { try { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); } catch (_) { return ''; } };
const SRC = ['workout-core.js', 'workout-live.js', 'wk-copy.js', 'wk-brief.js', 'wk-insights.js', 'style.css', 'index.html'].map(read).join('\n');
let bad = 0; const has = (label, needle) => { const ok = (Array.isArray(needle) ? needle.every((n) => SRC.includes(n)) : SRC.includes(needle)); if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  — missing: ' + JSON.stringify(needle)}`); };

// exact Hebrew copy (spec-fixed)
has('A3 last-set coach line', 'הסט האחרון. תן הכול, זה השיא שלך.');
has('A1 bottom row links', ['חימום', 'בדיקות', 'ערוך תוכנית']);
has('A1 ועוד N expander', 'ועוד ');
has('A1 switcher chip החלף', 'החלף');
has('A10 או התחל בחימום', 'או התחל בחימום');
has('A10 מה הלאה', 'מה הלאה');
has('A10b rest day', 'יום מנוחה');
has('A12 PR caption שיא חדש', 'שיא חדש');
has('A15 silent-switch label', 'צליל גם במצב שקט');
has('B1 empty state', 'בונים תמונה');
has('B1b add-to-brief + undo toast', ['הוסף לתדריך', 'נוסף לתדריך']);
has('B2 insights header', 'סקירת שבוע');
has('B3 weekly review copy', 'סקירת שבוע:');
has('B4 backup reminder', 'גיבוי שבועי');
has('B6 rest-end push copy', 'המנוחה הסתיימה');

// fixed px sizes (named in the spec) — present somewhere in the CSS/JS
has('char 140px (ready)', '140px');
has('char 96px (rest)', '96px');
has('char 160px (PR)', '160px');
has('char 84px (summary)', '84px');
has('CTA 62px (ready)', '62px');
has('pill 64px (סיימתי סט)', '64px');
has('number 72px (live target hero)', '72px');
has('B2 trend sparkline ~84px', '84px');

console.log(`\nSPEC-LOCK: ${bad ? 'FAIL (' + bad + ')' : 'PASS'}`); process.exit(bad ? 1 : 0);
