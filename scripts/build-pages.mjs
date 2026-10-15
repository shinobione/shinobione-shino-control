import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePagesSnapshot } from './generate-pages-snapshot.mjs';
import { PUBLIC_ARTIFACTS } from '../lib/public-artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

// Always rebuild the public snapshot from the current CONTROL state. This prevents GitHub Pages
// from serving a stale pre-derived JSON while keeping ChatGPT URLs, mapping keys and raw evidence
// out of the public artifact.
const state = generatePagesSnapshot({write:false});

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
for (const relative of PUBLIC_ARTIFACTS) {
  const source = path.join(PUBLIC, relative);
  if (!fs.existsSync(source) && ['favicon-32.png','build-info.js'].includes(relative)) continue;
  const destination = path.join(DIST, relative);
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  fs.copyFileSync(source, destination);
}

fs.writeFileSync(path.join(DIST, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

const build = state.settings?.controlBuild?.version ? `v${state.settings.controlBuild.version}` : 'unknown';
console.log(`GitHub Pages build ready: ${state.projects.length} projects, ${state.derived.length} derived states (sanitized public snapshot, build ${build})`);
