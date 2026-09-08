import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const STATE = path.join(ROOT, 'data', 'state.json');

if (!fs.existsSync(STATE)) throw new Error(`state.json not found: ${STATE}`);

const CP1252_REVERSE = new Map([
  [0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02C6,0x88],[0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],[0x017D,0x8E],
  [0x2018,0x91],[0x2019,0x92],[0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02DC,0x98],[0x2122,0x99],[0x0161,0x9A],[0x203A,0x9B],[0x0153,0x9C],[0x017E,0x9E],[0x0178,0x9F]
]);

function suspiciousScore(value='') {
  const s = String(value);
  let score = 0;
  for (const token of ['Ãƒ','Ã‚','Ã','Â','â€','â€™','â€œ','â€�','â€“','â€”','â€¦','ðŸ','ï¿½']) {
    let i = 0;
    while ((i = s.indexOf(token, i)) !== -1) { score += token.length >= 3 ? 4 : 2; i += token.length; }
  }
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0xFFFD) score += 20;
    else if (cp >= 0x80 && cp <= 0x9F) score += 3;
  }
  return score;
}

function cp1252Bytes(value) {
  const out = [];
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) out.push(cp);
    else if (CP1252_REVERSE.has(cp)) out.push(CP1252_REVERSE.get(cp));
    else return null;
  }
  return Buffer.from(out);
}

function repairMojibake(value) {
  if (typeof value !== 'string' || !value) return value;
  let cur = value;
  for (let pass=0; pass<4; pass++) {
    const before = suspiciousScore(cur);
    if (!before) break;
    const bytes = cp1252Bytes(cur);
    if (!bytes) break;
    let candidate;
    try { candidate = new TextDecoder('utf-8', { fatal:true }).decode(bytes); }
    catch { break; }
    if (candidate === cur || suspiciousScore(candidate) >= before) break;
    cur = candidate;
  }
  return cur;
}

let stringsRepaired = 0;
function repairStrings(value) {
  if (typeof value === 'string') {
    const fixed = repairMojibake(value);
    if (fixed !== value) stringsRepaired++;
    return fixed;
  }
  if (Array.isArray(value)) return value.map(repairStrings);
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = repairStrings(value[key]);
  }
  return value;
}

function norm(value='') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[’`']/g,' ')
    .replace(/[_/\\-]+/g,' ')
    .replace(/[^a-z0-9+ ]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

const CANONICAL = [
  { id:'control', name:'SHINO // CONTROL', universe:'SYSTEM / DEV', aliases:['SHINO // CONTROL','Project Radar','Site de suivi projets','SHINO Sync'] },
  { id:'suno-bridge', name:'SUNO BRIDGE', universe:'DEV / MUSIC', aliases:['SUNO BRIDGE','Suno Bridge'] },
  { id:'music', name:'SHINOBIWAN Music', universe:'MUSIC / ARTIST', aliases:['Music','SHINOBIWAN Music'] },
  { id:'studio', name:'STUDIO', universe:'MUSIC / PRODUCT', aliases:['STUDIO','ShinoBiWan STUDIO'] },
  { id:'shino-os', name:'SHINO-OS', universe:'SYSTEM', aliases:['Shino-OS','SHINO-OS'] },
  { id:'launchpad', name:'SHINOBIWAN LAUNCHPAD', universe:'MUSIC / PRODUCT', aliases:['LaunchPAD PWA','SHINOBIWAN LAUNCHPAD'] },
  { id:'risotools', name:'RISOTOOLS / SHINOASTEA', universe:'RISO / FIELD', aliases:['Riso','RISOTOOLS / SHINOASTEA'] },
  { id:'touch-plus', name:'TOUCH+ REVIVAL', universe:'DEV / HARDWARE', aliases:['TouchPlus','Touch Plus','TOUCH+ REVIVAL'] },
  { id:'french-tranquille', name:'FRENCH TRANQUILLE', universe:'PRODUCT', aliases:["Trân's French Teacher","Tran's French Teacher",'FRENCH TRANQUILLE','French Tranquille'] },
  { id:'naughty-share', name:'Naughty Share', universe:'PRODUCT / PRIVATE', aliases:['Naughty Share'] },
  { id:'tran-closet-pwa', name:'Trân Closet PWA', universe:'PRODUCT / PWA', aliases:['Trân Closet PWA','Tran Closet PWA'] },
  { id:'matos-informatique', name:'Matos informatique', universe:'HARDWARE / IT', aliases:['Matos informatique'] },
  { id:'analyse-ia-musique', name:'Analyse IA de musique', universe:'MUSIC / AI', aliases:['Analyse IA de musique'] },
  { id:'track-to-market-engine', name:'Track-to-Market ENGINE', universe:'MUSIC / DEV', aliases:['Track-to-Market ENGINE'] },
  { id:'lrc-maker', name:'LRC Maker', universe:'MUSIC / DEV', aliases:['LRC Maker'] },
  { id:'web-app', name:'web app', universe:'DEV / WEB', aliases:['web app'] },
  { id:'canva-spotify-gem', name:'canva spotify Gem', universe:'MUSIC / VISUAL', aliases:['canva spotify Gem'] }
];

const aliasToId = new Map();
for (const spec of CANONICAL) for (const alias of [spec.name, ...(spec.aliases||[])]) aliasToId.set(norm(alias), spec.id);

function canonicalIdForName(name='') { return aliasToId.get(norm(name)) || null; }

const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const backup = path.join(ROOT, 'data', `state.pre-utf8-repair-${stamp}.json`);
fs.copyFileSync(STATE, backup);

let state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
state = repairStrings(state);
state.settings ||= {};
state.settings.manualMappings ||= {};
state.settings.chatgptProjectMappings ||= {};
state.projects ||= [];
state.sources ||= [];
state.evidence ||= [];
state.discovered ||= [];

let projectsCreated = 0;
let projectsMerged = 0;
let sourcesMoved = 0;
let evidenceMoved = 0;
let mappingsFixed = 0;
let discoveredPromoted = 0;
let duplicateSourcesRemoved = 0;

for (const spec of CANONICAL) {
  let project = state.projects.find(p => p.id === spec.id);
  if (!project) {
    project = { id:spec.id, name:spec.name, universe:spec.universe, kind:'CHATGPT_PROJECT', repo:null, description:`Project workspace: ${spec.name}.` };
    state.projects.push(project);
    projectsCreated++;
  }
  if (spec.id === 'tran-closet-pwa') project.name = 'Trân Closet PWA';
  if (spec.id === 'french-tranquille' && /tr[aâ]n/i.test(project.name || '')) project.name = 'FRENCH TRANQUILLE';
}

const projectById = () => new Map(state.projects.map(p => [p.id,p]));

function moveProjectReferences(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  for (const s of state.sources) if (s.projectId === fromId) { s.projectId = toId; sourcesMoved++; }
  for (const e of state.evidence) if (e.projectId === fromId) { e.projectId = toId; evidenceMoved++; }
  for (const [k,v] of Object.entries(state.settings.manualMappings)) if (v === fromId) { state.settings.manualMappings[k] = toId; mappingsFixed++; }
  for (const [k,v] of Object.entries(state.settings.chatgptProjectMappings)) if (v === fromId) { state.settings.chatgptProjectMappings[k] = toId; mappingsFixed++; }
}

// Merge auto-created aliases back into their canonical CONTROL cards.
for (const p of [...state.projects]) {
  const target = canonicalIdForName(p.name);
  if (!target || target === p.id) continue;
  moveProjectReferences(p.id, target);
  state.projects = state.projects.filter(x => x.id !== p.id);
  projectsMerged++;
}

// Also collapse exact duplicate names that may remain after Unicode repair.
const seenNames = new Map();
for (const p of [...state.projects]) {
  const key = norm(p.name);
  if (!key) continue;
  if (!seenNames.has(key)) { seenNames.set(key,p); continue; }
  const prev = seenNames.get(key);
  const preferred = canonicalIdForName(p.name);
  const keep = preferred ? state.projects.find(x => x.id === preferred) || prev : (prev.repo && !p.repo ? prev : p.repo && !prev.repo ? p : prev);
  const drop = keep.id === p.id ? prev : p;
  if (drop.id !== keep.id) {
    moveProjectReferences(drop.id, keep.id);
    state.projects = state.projects.filter(x => x.id !== drop.id);
    seenNames.set(key,keep);
    projectsMerged++;
  }
}

// A real ChatGPT project title is authoritative for non-umbrella projects.
for (const s of state.sources) {
  if (s.type !== 'chatgpt_thread') continue;
  const target = canonicalIdForName(s.chatgptProjectTitle || '');
  if (!target) continue;
  if (s.projectId !== target) {
    const old = s.projectId;
    s.projectId = target;
    sourcesMoved++;
    for (const e of state.evidence) if (e.sourceId === s.id && e.projectId !== target) { e.projectId = target; evidenceMoved++; }
    console.log(`route: ${s.title || s.externalId} :: ${old} -> ${target}`);
  }
  if (s.chatgptProjectKey && state.settings.chatgptProjectMappings[s.chatgptProjectKey] !== target) {
    state.settings.chatgptProjectMappings[s.chatgptProjectKey] = target;
    mappingsFixed++;
  }
}

for (const e of state.evidence) {
  if (e.sourceType !== 'chatgpt_thread') continue;
  const target = canonicalIdForName(e.chatgptProjectTitle || '');
  if (target && e.projectId !== target) { e.projectId = target; evidenceMoved++; }
}

// Promote previously discovered threads when their ChatGPT project identity is now canonical.
const keptDiscovered = [];
for (const d of state.discovered) {
  const target = canonicalIdForName(d.chatgptProjectTitle || '');
  if (!target) { keptDiscovered.push(d); continue; }
  if (d.chatgptProjectKey && state.settings.chatgptProjectMappings[d.chatgptProjectKey] !== target) {
    state.settings.chatgptProjectMappings[d.chatgptProjectKey] = target;
    mappingsFixed++;
  }
  let source = state.sources.find(s => s.externalId && d.externalId && s.externalId === d.externalId) || state.sources.find(s => d.url && s.url === d.url);
  if (!source) {
    source = {
      id:`src-repair-${Math.random().toString(36).slice(2,10)}`,
      projectId:target,
      type:'chatgpt_thread',
      externalId:d.externalId || d.url,
      title:d.title || 'Recovered ChatGPT thread',
      url:d.url,
      lastObservedAt:d.lastObservedAt || new Date().toISOString(),
      state:'MAPPED-REPAIR',
      chatgptProjectKey:d.chatgptProjectKey || null,
      chatgptProjectTitle:d.chatgptProjectTitle || null
    };
    state.sources.push(source);
  } else source.projectId = target;
  if (!state.evidence.some(e => e.sourceId === source.id && e.type === 'chat_sync')) {
    const summary = String(d.preview || 'Recovered from a previously discovered ChatGPT thread.').slice(0,1800);
    state.evidence.push({
      id:`chat-repair-${Math.random().toString(36).slice(2,10)}`,
      projectId:target,
      sourceId:source.id,
      sourceType:'chatgpt_thread',
      type:'chat_sync',
      timestamp:d.lastObservedAt || new Date().toISOString(),
      title:d.title || 'Recovered ChatGPT thread',
      summary,
      currentStateSummary:summary.slice(0,650),
      resumeAction:'Continue in the recovered ChatGPT thread.',
      url:d.url,
      confidence:0.78,
      chatgptProjectKey:d.chatgptProjectKey || null,
      chatgptProjectTitle:d.chatgptProjectTitle || null
    });
  }
  discoveredPromoted++;
}
state.discovered = keptDiscovered;

// Drop poisoned umbrella mappings. Shino Codes is a container; its individual threads resolve by title/content.
for (const [key,value] of Object.entries(state.settings.chatgptProjectMappings)) {
  if (value === 'shino-codes') { delete state.settings.chatgptProjectMappings[key]; mappingsFixed++; }
}

// Deduplicate the same ChatGPT conversation after project merges/backfills.
const byExternal = new Map();
const dedupedSources = [];
for (const s of state.sources) {
  if (s.type !== 'chatgpt_thread' || !s.externalId) { dedupedSources.push(s); continue; }
  const prev = byExternal.get(s.externalId);
  if (!prev) { byExternal.set(s.externalId,s); dedupedSources.push(s); continue; }
  const keep = new Date(s.lastObservedAt || 0) > new Date(prev.lastObservedAt || 0) ? s : prev;
  const drop = keep === s ? prev : s;
  for (const e of state.evidence) if (e.sourceId === drop.id) { e.sourceId = keep.id; e.projectId = keep.projectId; }
  if (keep === s) {
    const i = dedupedSources.indexOf(prev);
    if (i >= 0) dedupedSources[i] = s;
    byExternal.set(s.externalId,s);
  }
  duplicateSourcesRemoved++;
}
state.sources = dedupedSources;

// Keep umbrella/personal helper records out of the project radar when the UI supports radarHidden.
for (const p of state.projects) {
  if (p.id === 'shino-codes' || p.id === 'astrid-admin') p.radarHidden = true;
}

fs.writeFileSync(STATE, JSON.stringify(state,null,2), 'utf8');

const residual = [];
function scanResidual(value, at='state') {
  if (typeof value === 'string') { if (suspiciousScore(value) > 0) residual.push(at); return; }
  if (Array.isArray(value)) return value.forEach((v,i)=>scanResidual(v,`${at}[${i}]`));
  if (value && typeof value === 'object') for (const [k,v] of Object.entries(value)) scanResidual(v,`${at}.${k}`);
}
scanResidual(state);

const chatCounts = new Map();
for (const s of state.sources.filter(s=>s.type==='chatgpt_thread')) chatCounts.set(s.projectId,(chatCounts.get(s.projectId)||0)+1);

console.log('\n=== SHINO STATE REPAIR COMPLETE ===');
console.log(`Backup                 : ${backup}`);
console.log(`Strings repaired       : ${stringsRepaired}`);
console.log(`Projects created       : ${projectsCreated}`);
console.log(`Projects merged        : ${projectsMerged}`);
console.log(`Sources moved          : ${sourcesMoved}`);
console.log(`Evidence moved         : ${evidenceMoved}`);
console.log(`Mappings fixed         : ${mappingsFixed}`);
console.log(`Discovered promoted    : ${discoveredPromoted}`);
console.log(`Duplicate chats removed: ${duplicateSourcesRemoved}`);
console.log(`Remaining discovered   : ${state.discovered.length}`);
console.log(`Residual mojibake paths: ${residual.length}`);
console.log('\nChatGPT sources by project:');
for (const [id,count] of [...chatCounts.entries()].sort((a,b)=>b[1]-a[1])) {
  const p = projectById().get(id);
  console.log(`  ${(p?.name || id).padEnd(28)} ${count}`);
}
if (residual.length) console.log('\nResidual examples:\n  ' + residual.slice(0,12).join('\n  '));
