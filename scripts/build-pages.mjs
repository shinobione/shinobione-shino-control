import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAll } from '../lib/derive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data', 'state.json');
const DIST = path.join(ROOT, 'dist');

const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const state = deriveAll(raw);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.cpSync(PUBLIC, DIST, { recursive: true });

fs.writeFileSync(path.join(DIST, 'state.json'), JSON.stringify(state, null, 2));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

console.log(`GitHub Pages build ready: ${state.projects.length} projects, ${state.derived.length} derived states`);
