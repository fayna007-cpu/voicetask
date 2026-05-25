# Claude Proj — מפת התיקייה

תיקייה זו מכילה את **אפליקציית Alfred** (PWA) וגם פרויקטי צד. הנה מה נמצא איפה:

---

## 📱 שורש התיקייה = אפליקציית Alfred

> ⚠️ **אסור להזיז את הקבצים האלה מהשורש** — GitHub Pages מגיש אותם מהשורש,
> והעברה תשבור את הקישור החי וה-PWA המותקן.

| קובץ | תפקיד |
|------|-------|
| `index.html` | כל לוגיקת האפליקציה + ה-UI |
| `style.css` | העיצוב המלא (פלטת Alfred) |
| `sw.js` | Service Worker (cache + פוש) |
| `manifest.json` | הגדרות ה-PWA (שם, אייקון, צבעים) |
| `icon.svg` | אייקון האפליקציה (כדור Alfred) |
| `.impeccable.md` | קונטקסט העיצוב והמותג |
| `push-worker/` | שרת הפוש (Cloudflare Worker) |
| `n8n-workflow.json` | אוטומציה ב-n8n (מיילים) |
| `deploy.bat` / `update.bat` | סקריפטי פריסה |
| `.github/workflows/` | פריסה אוטומטית ל-GitHub Pages |

**כתובת חיה:** https://fayna007-cpu.github.io/voicetask/
**פריסה:** כל `git push` ל-`master` מפרסם אוטומטית.

---

## 🤖 `agents/` — פרויקטי הסוכנים

| תיקייה | מה זה |
|--------|-------|
| `agent-template/` | תבנית בסיס לסוכן חדש |
| `ai-agents/` | סוכני ה-AI |
| `my-wa-agent/` | סוכן WhatsApp |
| `business analyst/` | חומרי אנליסט |
| `deploy-vps.sh` / `upload-to-vps.sh` | פריסת סוכנים ל-VPS |

---

## 🗂️ `misc/` — קבצי עזר ותוכן

| פריט | מה זה |
|------|-------|
| `Insta/` | תמונות + ספר Naval (תוכן) |
| `alfred-app.tgz` | גיבוי ארוז של האפליקציה |
| `client_secret_*.json` | מפתח OAuth של גוגל (🔒 לא לפרסם) |
| `task-example.json` / `workflow.json` | דוגמאות ישנות |

---

## 🔧 OpenClaw — לא כאן (במכוון)

OpenClaw יושב ב-`C:\Users\fayna\.openclaw` ו**חייב להישאר שם** —
הוא מקודד קשיח לנתיב הזה (gateway, credentials, service).
העברה תשבור אותו, לכן הוא לא הועבר.

---

*עודכן אוטומטית ע"י Claude — מפת ארגון התיקייה.*
