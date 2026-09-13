import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAll } from '../lib/derive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const LIVE_DATA = path.join(ROOT, 'data', 'state.json');
const PAGES_DATA = path.join(ROOT, 'data', 'state.pages.json');
const DIST = path.join(ROOT, 'dist');

// GitHub Pages is public. Prefer the deliberately sanitized, pre-derived snapshot when present.
// Local CONTROL continues to use data/state.json through the Node server and is not affected.
let state;
if (fs.existsSync(PAGES_DATA)) {
  state = JSON.parse(fs.readFileSync(PAGES_DATA, 'utf8'));
} else {
  const raw = JSON.parse(fs.readFileSync(LIVE_DATA, 'utf8'));
  state = deriveAll(raw);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.cpSync(PUBLIC, DIST, { recursive: true });

fs.writeFileSync(path.join(DIST, 'state.json'), JSON.stringify(state, null, 2));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

console.log(`GitHub Pages build ready: ${state.projects.length} projects, ${state.derived.length} derived states${state.settings?.publicSnapshot ? ' (sanitized public snapshot)' : ''}`);
