import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProjectDetailed } from '../lib/resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'state.json');
const APPLY = process.argv.includes('--apply');

const norm = value => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function conversationId(source) {
  const candidates = [source?.externalId, source?.url];
  for (const raw of candidates) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const direct = text.match(/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i)?.[0];
    if (direct) return direct.toLowerCase();
    try {
      const u = new URL(text);
      const id = u.pathname.match(/\/c\/([^/?#]+)/i)?.[1];
      if (id) return id.toLowerCase();
    } catch {}
  }
  return null;
}

function ts(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : 0;
}

function quality(source) {
  let score = 0;
  if (source?.url && /\/g\/g-p-[^/]+\/c\//i.test(source.url)) score += 20;
  if (source?.chatgptProjectKey) score += 10;
  if (source?.chatgptProjectTitle) score += 10;
  if (source?.state === 'SYNCED') score += 5;
  if (source?.state === 'AUTO-PROJECT') score += 3;
  return score;
}

function chooseKeeper(list) {
  return [...list].sort((a, b) => {
    const dt = ts(b.lastObservedAt) - ts(a.lastObservedAt);
    if (dt) return dt;
    return quality(b) - quality(a);
  })[0];
}

function canonicalProjectForSource(source, projects) {
  const title = String(source?.chatgptProjectTitle || '').trim();
  if (!title || norm(title) === 'shino codes') return null;
  const resolved = resolveProjectDetailed({ title:'', projectTitle:title, transcript:'' }, projects);
  if (!resolved || resolved.score < 70) return null;
  return resolved.project;
}

const state = JSON.parse(fs.readFileSync(DATA, 'utf8'));
state.settings ||= {};
state.settings.chatgptProjectMappings ||= {};
state.sources ||= [];
state.evidence ||= [];
state.projects ||= [];

const chats = state.sources.filter(s => s.type === 'chatgpt_thread');
const groups = new Map();
for (const source of chats) {
  const id = conversationId(source);
  if (!id) continue;
  const list = groups.get(id) || [];
  list.push(source);
  groups.set(id, list);
}

const duplicateGroups = [...groups.entries()].filter(([, list]) => list.length > 1);
const duplicateSourceIds = new Set();
const keeperByOldId = new Map();
const keeperByConversation = new Map();
for (const [id, list] of duplicateGroups) {
  const keeper = chooseKeeper(list);
  keeperByConversation.set(id, keeper);
  for (const source of list) {
    if (source.id === keeper.id) continue;
    duplicateSourceIds.add(source.id);
    keeperByOldId.set(source.id, keeper.id);
  }
}

const placeholderIds = new Set();
for (const source of chats) {
  if (source.url || source.externalId || source.state !== 'UNSYNCED') continue;
  const hasReal = chats.some(other => other.id !== source.id && other.projectId === source.projectId && !!other.url);
  if (hasReal) placeholderIds.add(source.id);
}

const effectiveSources = state.sources.filter(source => !duplicateSourceIds.has(source.id) && !placeholderIds.has(source.id));
const corrections = [];
const mappingCorrections = [];
for (const source of effectiveSources.filter(s => s.type === 'chatgpt_thread')) {
  const project = canonicalProjectForSource(source, state.projects);
  if (!project) continue;
  if (source.projectId !== project.id) {
    corrections.push({ sourceId:source.id, title:source.title, from:source.projectId, to:project.id, projectTitle:source.chatgptProjectTitle });
  }
  if (source.chatgptProjectKey) {
    const old = state.settings.chatgptProjectMappings[source.chatgptProjectKey] || null;
    if (old !== project.id) mappingCorrections.push({ key:source.chatgptProjectKey, from:old, to:project.id, projectTitle:source.chatgptProjectTitle });
  }
}

const representedKeys = new Set(effectiveSources.filter(s => s.type === 'chatgpt_thread').map(s => s.chatgptProjectKey).filter(Boolean));
const staleMappingKeys = Object.keys(state.settings.chatgptProjectMappings).filter(key => !representedKeys.has(key));

console.log('SHINO // CONTROL — ChatGPT state hygiene');
console.log(`Mode: ${APPLY ? 'APPLY' : 'AUDIT ONLY'}`);
console.log(`ChatGPT sources: ${chats.length}`);
console.log(`Unique conversation IDs seen: ${groups.size}`);
console.log(`Duplicate conversation groups: ${duplicateGroups.length} (${duplicateSourceIds.size} redundant sources)`);
console.log(`Legacy UNSYNCED placeholders removable: ${placeholderIds.size}`);
console.log(`Source project corrections: ${corrections.length}`);
console.log(`Project-key mapping corrections: ${mappingCorrections.length}`);
console.log(`Remembered project keys with no current source: ${staleMappingKeys.length} (reported only; NOT pruned)`);

if (corrections.length) {
  console.log('\nProject corrections:');
  for (const item of corrections.slice(0, 40)) console.log(`- ${item.title || item.sourceId}: ${item.from} -> ${item.to} [${item.projectTitle}]`);
}
if (mappingCorrections.length) {
  console.log('\nMapping corrections:');
  for (const item of mappingCorrections.slice(0, 40)) console.log(`- ${item.key}: ${item.from || 'NONE'} -> ${item.to} [${item.projectTitle}]`);
}
if (duplicateGroups.length) {
  console.log('\nDuplicate samples:');
  for (const [id, list] of duplicateGroups.slice(0, 20)) {
    const keeper = chooseKeeper(list);
    console.log(`- ${id}: keep "${keeper.title || keeper.id}" (${keeper.projectId}, ${keeper.lastObservedAt || 'no date'}), remove ${list.length - 1}`);
  }
}

if (!APPLY) {
  console.log('\nNo file changed. Run `npm run chat:repair` only after reviewing this audit.');
  process.exit(0);
}

const backupDir = path.join(ROOT, 'data', 'backups');
fs.mkdirSync(backupDir, { recursive:true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `state-before-chat-hygiene-${stamp}.json`);
fs.copyFileSync(DATA, backupPath);

// Re-point evidence from redundant sources to the chosen keeper before deleting duplicates.
for (const evidence of state.evidence) {
  const keeperId = keeperByOldId.get(evidence.sourceId);
  if (keeperId) evidence.sourceId = keeperId;
}

state.sources = state.sources.filter(source => !duplicateSourceIds.has(source.id) && !placeholderIds.has(source.id));
state.evidence = state.evidence.filter(evidence => !placeholderIds.has(evidence.sourceId));

// Apply canonical project ownership from the fresh ChatGPT project title when it is unambiguous.
for (const source of state.sources.filter(s => s.type === 'chatgpt_thread')) {
  const project = canonicalProjectForSource(source, state.projects);
  if (!project) continue;
  source.projectId = project.id;
  if (source.chatgptProjectKey) state.settings.chatgptProjectMappings[source.chatgptProjectKey] = project.id;
  for (const evidence of state.evidence.filter(e => e.sourceId === source.id)) evidence.projectId = project.id;
}

// Keep only the newest chat_sync evidence per surviving chat source; GitHub and other evidence are untouched.
const newestChatEvidence = new Map();
for (const evidence of state.evidence) {
  if (evidence.type !== 'chat_sync' || !evidence.sourceId) continue;
  const prev = newestChatEvidence.get(evidence.sourceId);
  if (!prev || ts(evidence.timestamp) > ts(prev.timestamp)) newestChatEvidence.set(evidence.sourceId, evidence);
}
state.evidence = state.evidence.filter(evidence => {
  if (evidence.type !== 'chat_sync' || !evidence.sourceId) return true;
  return newestChatEvidence.get(evidence.sourceId)?.id === evidence.id;
});

fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
console.log(`\nApplied safely. Backup: ${path.relative(ROOT, backupPath)}`);
console.log('Stale mapping keys were intentionally left untouched; this repair only removes duplicate chat sources and fixes ownership where project-title evidence is unambiguous.');
