// Crawler for the staged site: every LOCAL file referenced by index.html, sw.js and manifest.json must exist
// in the site folder, and nothing outside the allow-list may be published.
//   node tools/check-site.mjs _site
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '_site');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const isLocal = (u) => u && !/^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(u) && !u.includes('${');
const clean = (u) => u.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
const refs = new Map();                                     // file -> where it is referenced
const add = (u, from) => { if (!isLocal(u)) return; const f = clean(u); if (f) refs.set(f, [...(refs.get(f) || []), from]); };

const html = read('index.html');
for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) add(m[1], 'index.html attr');
for (const m of html.matchAll(/navigator\.serviceWorker\.register\(\s*["']([^"']+)["']/g)) add(m[1], 'index.html sw register');
for (const m of html.matchAll(/["'](\.\/[A-Za-z0-9_.\-/]+\.(?:js|css|json|svg|png|webp|html))["']/g)) add(m[1], 'index.html string');
const sw = read('sw.js');
const st = sw.match(/const STATIC\s*=\s*\[([^\]]*)\]/);
if (st) for (const m of st[1].matchAll(/["']([^"']+)["']/g)) add(m[1], 'sw.js STATIC');
for (const m of sw.matchAll(/["'](\.\/[A-Za-z0-9_.\-/]+\.(?:js|css|json|svg|png|webp|html))["']/g)) add(m[1], 'sw.js string');
const man = JSON.parse(read('manifest.json'));
for (const i of man.icons || []) add(i.src, 'manifest icons');
if (man.start_url) add(man.start_url, 'manifest start_url');

let bad = 0;
for (const [f, from] of [...refs].sort()) {
  const ok = fs.existsSync(path.join(dir, f));
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'MISS'} ${f}  <- ${[...new Set(from)].join(', ')}`);
}
const published = fs.readdirSync(dir, { recursive: true }).map(String);
const forbidden = published.filter((p) => /^(ai-worker|tests|tools|push-worker|node_modules|\.github)([\\/]|$)|n8n-workflow\.json|\.dev\.vars|\.env/.test(p));
if (forbidden.length) { bad++; console.log('FORBIDDEN in site: ' + forbidden.join(', ')); }
console.log(`\n${refs.size} referenced local files, ${published.length} published files, ${bad ? bad + ' problem(s)' : 'all present, nothing extra'}`);
process.exit(bad ? 1 : 0);
