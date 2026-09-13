import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePagesSnapshot } from './generate-pages-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

// Always rebuild the public snapshot from the current CONTROL state. This prevents GitHub Pages
// from serving a stale pre-derived JSON while keeping ChatGPT URLs, mapping keys and raw evidence
// out of the public artifact.
const state = generatePagesSnapshot();

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.cpSync(PUBLIC, DIST, { recursive: true });

fs.writeFileSync(path.join(DIST, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

const build = state.settings?.controlBuild?.version ? `v${state.settings.controlBuild.version}` : 'unknown';
console.log(`GitHub Pages build ready: ${state.projects.length} projects, ${state.derived.length} derived states (sanitized public snapshot, build ${build})`);
