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

export function snapshotCoverage(snapshot = {}) {
  return {
    projects: Array.isArray(snapshot.projects) ? snapshot.projects.length : 0,
    derived: Array.isArray(snapshot.derived) ? snapshot.derived.length : 0,
    conversations: Math.max(0, Number(snapshot.settings?.lastChatgptInventory?.conversationCount || 0))
  };
}

export function snapshotRegresses(candidate, baseline) {
  if (!baseline?.settings?.publicSnapshot) return false;
  const next = snapshotCoverage(candidate);
  const prev = snapshotCoverage(baseline);
  if (next.projects < prev.projects) return true;
  if (next.derived < prev.derived) return true;
  if (prev.conversations > 0 && next.conversations < prev.conversations) return true;
  return false;
}

function readCommittedSnapshot() {
  if (!fs.existsSync(PAGES_DATA)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(PAGES_DATA, 'utf8'));
    return value?.settings?.publicSnapshot ? value : null;
  } catch {
    return null;
  }
}

function stampPublishBuild(snapshot, { guarded = false, candidateCoverage = null } = {}) {
  snapshot.settings ||= {};
  snapshot.settings.controlBuild = {
    version: PACKAGE.version,
    sha: String(process.env.GITHUB_SHA || '').slice(0, 8) || null
  };
  if (guarded) {
    snapshot.settings.publishGuard = {
      protectedAt: new Date().toISOString(),
      reason: 'candidate-private-state-less-complete-than-committed-public-snapshot',
      candidateCoverage
    };
  } else {
    delete snapshot.settings.publishGuard;
  }
  return snapshot;
}

export function generatePagesSnapshot({ write = true, allowRegression = false } = {}) {
  const baseline = readCommittedSnapshot();
  const raw = JSON.parse(fs.readFileSync(LIVE_DATA, 'utf8'));
  const derived = deriveAll(raw);
  const candidate = buildPublicSnapshot(derived, {
    version: PACKAGE.version,
    sha: process.env.GITHUB_SHA || null,
    generatedAt: new Date().toISOString()
  });

  let snapshot = candidate;
  let guarded = false;
  if (!allowRegression && baseline && snapshotRegresses(candidate, baseline)) {
    snapshot = structuredClone(baseline);
    guarded = true;
  }
  stampPublishBuild(snapshot, {
    guarded,
    candidateCoverage: guarded ? snapshotCoverage(candidate) : null
  });

  if (write) fs.writeFileSync(PAGES_DATA, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allowRegression = process.argv.includes('--allow-regression');
  const snapshot = generatePagesSnapshot({ allowRegression });
  const guard = snapshot.settings?.publishGuard ? ' · GUARD preserved fuller committed snapshot' : '';
  const coverage = snapshotCoverage(snapshot);
  console.log(`Public Pages snapshot ready: ${coverage.projects} projects, ${coverage.derived} derived states, ${coverage.conversations} conversations, build v${PACKAGE.version}${guard}`);
}
