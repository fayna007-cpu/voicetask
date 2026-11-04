// Builds _site/ with ONLY the files the PWA serves. The ONE allow-list for GitHub Pages:
// used by .github/workflows/deploy.yml and locally (node tools/stage-site.mjs) before any merge.
// Everything else in the repo (ai-worker/, tests/, tools/, push-worker/, n8n-workflow.json, README...) stays unpublished.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_FILES = ['index.html', 'sw.js', 'style.css', 'manifest.json', 'icon.svg', 'hebrew-time.js'];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const missing = SITE_FILES.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) { console.error('stage-site: missing files: ' + missing.join(', ')); process.exit(1); }
for (const f of SITE_FILES) fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log(`stage-site: ${SITE_FILES.length} files -> _site/ (${SITE_FILES.join(', ')})`);
