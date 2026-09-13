import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAll } from '../lib/derive.mjs';
import { buildPublicSnapshot } from '../lib/public-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIVE_DATA = path.join(ROOT, 'data', 'state.json');
const PAGES_DATA = path.join(ROOT, 'data', 'state.pages.json');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function generatePagesSnapshot({ write = true } = {}) {
  const raw = JSON.parse(fs.readFileSync(LIVE_DATA, 'utf8'));
  const derived = deriveAll(raw);
  const snapshot = buildPublicSnapshot(derived, {
    version: PACKAGE.version,
    sha: process.env.GITHUB_SHA || null,
    generatedAt: new Date().toISOString()
  });
  if (write) fs.writeFileSync(PAGES_DATA, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const snapshot = generatePagesSnapshot();
  console.log(`Public Pages snapshot ready: ${snapshot.projects.length} projects, ${snapshot.derived.length} derived states, build v${PACKAGE.version}`);
}
