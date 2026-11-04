// Deploy-time only (run on the owner's explicit go): upload EXACTLY OPENROUTER_API_KEY and GROQ_API_KEY
// from .dev.vars to the Worker via `wrangler secret bulk` over stdin — no temp file, no value ever printed.
//   node scripts/upload-secrets.mjs --check    -> prints only true/false (both keys present, non-empty, clean)
//   node scripts/upload-secrets.mjs            -> uploads (wrangler output is filtered; values never shown)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WANT = ['OPENROUTER_API_KEY', 'GROQ_API_KEY'];
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars');

function pick() {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && WANT.includes(m[1])) out[m[1]] = m[2];
  }
  const ok = WANT.every((k) => typeof out[k] === 'string' && out[k].length > 0 && !/[\s"']/.test(out[k]));
  return { ok, out };
}

const { ok, out } = pick();
if (process.argv.includes('--check')) { console.log(String(ok)); process.exit(ok ? 0 : 1); }
if (!ok) { console.log('false — refusing to upload: a key is missing, empty, quoted or has spaces'); process.exit(1); }
const child = spawn('npx', ['wrangler', 'secret', 'bulk'], { cwd: path.dirname(file), shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
const mask = (s) => String(s).replace(/sk-or-[A-Za-z0-9_-]+|gsk_[A-Za-z0-9_-]+/g, '***');
child.stdout.on('data', (d) => process.stdout.write(mask(d)));
child.stderr.on('data', (d) => process.stderr.write(mask(d)));
child.stdin.end(JSON.stringify(out));                       // ONLY the two wanted keys
child.on('close', (code) => { console.log(`uploaded keys: ${Object.keys(out).join(', ')} (exit ${code})`); process.exit(code); });
