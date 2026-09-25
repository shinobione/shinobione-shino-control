import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestChatgptDelta } from './lib/chatgpt-delta-ingest.mjs';
import { planChatgptCatchup } from './lib/chatgpt-catchup-plan.mjs';
import { repairChatgptProjectOwnership } from './lib/chatgpt-project-ownership.mjs';
import { deriveAll } from './lib/derive.mjs';
import { syncGithubIncremental } from './lib/github-incremental-sync.mjs';
import { runtimeStatePath, writeRuntimeState } from './lib/state-store.mjs';
import { authorized, guardRequest, json } from './lib/http-security.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = runtimeStatePath();
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4177);
const TIMEOUT_RETRY_DELAYS_MS = [30 * 60 * 1000, 2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const COLLECTOR_COMPONENT = {
  id:'control-collector',
  name:'CONTROL Collector',
  kind:'EXTENSION',
  path:'extension/control-collector',
  manifest:'extension/control-collector/manifest.json'
};

function norm(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function retireLegacyShinoSync(state) {
  state.settings ||= {};
  state.settings.manualMappings ||= {};
  state.settings.chatgptProjectMappings ||= {};
  state.projects ||= [];
  state.sources ||= [];
  state.evidence ||= [];
  state.discovered ||= [];

  for (const mappings of [state.settings.manualMappings, state.settings.chatgptProjectMappings]) {
    for (const [key, value] of Object.entries(mappings)) {
      if (value === 'shino-sync') mappings[key] = 'control';
    }
  }

  const legacySourceIds = new Set(
    state.sources
      .filter(source =>
        source.projectId === 'shino-sync' ||
        source.componentId === 'shino-sync' ||
        /extension\/shino-sync/i.test(String(source.url || ''))
      )
      .map(source => source.id)
      .filter(Boolean)
  );

  state.sources = state.sources.filter(source => !legacySourceIds.has(source.id));
  state.evidence = state.evidence.filter(evidence =>
    evidence.projectId !== 'shino-sync' &&
    evidence.componentId !== 'shino-sync' &&
    !legacySourceIds.has(evidence.sourceId)
  );
  state.projects = state.projects.filter(project => project.id !== 'shino-sync');

  const control = state.projects.find(project => project.id === 'control');
  if (control) {
    control.components = [COLLECTOR_COMPONENT];
    let source = state.sources.find(item => item.projectId === 'control' && item.type === 'github_component' && item.componentId === 'control-collector');
    if (!source) {
      source = {
        id:'src-control-component-control-collector',
        projectId:'control',
        type:'github_component',
        componentId:'control-collector',
        title:'CONTROL Collector',
        url:'https://github.com/shinobione/shinobione-shino-control/tree/main/extension/control-collector',
        lastObservedAt:state.settings.lastChatgptCollector?.at || null,
        state:'COMPONENT'
      };
      state.sources.push(source);
    }
  }

  return state;
}

function restorePersonnelProject(state) {
  state.settings ||= {};
  state.settings.manualMappings ||= {};
  state.settings.chatgptProjectMappings ||= {};
  state.projects ||= [];
  state.sources ||= [];
  state.evidence ||= [];

  let personnel = state.projects.find(project => project.id === 'personnel');
  if (!personnel) {
    personnel = {
      id:'personnel',
      name:'PERSONNEL',
      universe:'PERSONAL',
      kind:'CHATGPT_PROJECT',
      repo:null,
      description:'Personal ChatGPT project: admin, purchases, everyday troubleshooting and other non-SHINO work.'
    };
    state.projects.push(personnel);
  } else {
    personnel.name = 'PERSONNEL';
    personnel.universe = 'PERSONAL';
    personnel.kind = 'CHATGPT_PROJECT';
    personnel.radarHidden = false;
  }

  const sourceIds = new Set();
  for (const source of state.sources) {
    const isPersonnelProject = norm(source.chatgptProjectTitle) === 'personnel';
    const isLegacyAstridProject = source.projectId === 'astrid-admin';
    if (!isPersonnelProject && !isLegacyAstridProject) continue;
    source.projectId = 'personnel';
    sourceIds.add(source.id);
    if (source.chatgptProjectKey) state.settings.chatgptProjectMappings[source.chatgptProjectKey] = 'personnel';
  }

  for (const evidence of state.evidence) {
    if (evidence.projectId === 'astrid-admin' || sourceIds.has(evidence.sourceId)) evidence.projectId = 'personnel';
  }
  for (const mappings of [state.settings.manualMappings, state.settings.chatgptProjectMappings]) {
    for (const [key, value] of Object.entries(mappings)) {
      if (value === 'astrid-admin') mappings[key] = 'personnel';
    }
  }

  state.projects = state.projects.filter(project => project.id !== 'astrid-admin');
  return state;
}

function normalizeState(state, { derive = false } = {}) {
  restorePersonnelProject(state);
  retireLegacyShinoSync(state);
  const ownershipRepair = repairChatgptProjectOwnership(state);
  if (derive) {
    if (ownershipRepair.projectIds.length) deriveAll(state, {dirtyProjectIds:ownershipRepair.projectIds});
    else deriveAll(state);
  }
  return state;
}

function readState({ derive = false } = {}) {
  return normalizeState(JSON.parse(fs.readFileSync(DATA, 'utf8')), { derive });
}

function writeState(state) {
  retireLegacyShinoSync(state);
  writeRuntimeState(state);
}

function scrubStateFile() {
  try {
    const before = fs.readFileSync(DATA, 'utf8');
    const state = normalizeState(JSON.parse(before));
    const after = JSON.stringify(state, null, 2);
    if (after !== before.trim()) writeRuntimeState(state);
  } catch {}
}

function catchupFailure(item = {}) {
  return {
    key:String(item.key || '').slice(0,120),
    title:String(item.title || 'Untitled conversation').replace(/\s+/g,' ').trim().slice(0,180),
    error:String(item.error || 'Unknown error').replace(/\s+/g,' ').trim().slice(0,320)
  };
}

function catchupInaccessible(item = {}) {
  return {
    ...catchupFailure(item),
    kind:'inaccessible',
    remoteUpdatedAt:item.updatedAt || item.remoteUpdatedAt || null
  };
}

function catchupTimeout(item = {}) {
  return {
    ...catchupFailure(item),
    kind:'timeout',
    remoteUpdatedAt:item.updatedAt || item.remoteUpdatedAt || null
  };
}

function isCatchupTimeout(item = {}) {
  return /CHATGPT_FETCH_TIMEOUT_\d+MS/i.test(String(item.error || ''));
}

function sameRemoteTimestamp(a, b) {
  const aMs = Date.parse(a || '');
  const bMs = Date.parse(b || '');
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) return aMs === bMs;
  return !a && !b;
}

function timeoutRetryDelayMs(attempts) {
  const index = Math.max(0, Math.min(TIMEOUT_RETRY_DELAYS_MS.length - 1, Number(attempts || 1) - 1));
  return TIMEOUT_RETRY_DELAYS_MS[index];
}

function activeTimeoutQuarantine(state, nowMs = Date.now()) {
  const items = [];
  for (const [key, item] of Object.entries(state.settings?.chatgptTimeoutQuarantine || {})) {
    const retryMs = Date.parse(item?.retryAt || '');
    if (!Number.isFinite(retryMs) || retryMs <= nowMs) continue;
    items.push({
      key,
      title:item.title || 'Untitled conversation',
      error:item.error || 'ChatGPT conversation fetch timed out',
      kind:'timeout',
      remoteUpdatedAt:item.remoteUpdatedAt || null,
      observedAt:item.observedAt || null,
      attempts:Number(item.attempts || 1),
      retryAt:item.retryAt
    });
  }
  items.sort((a,b) => Date.parse(a.retryAt || '') - Date.parse(b.retryAt || ''));
  return items;
}

{
  const state = readState({ derive:true });
  writeState(state);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 8_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (error) { reject(error); }
    });
  });
}

const MANAGED_PROJECT_STATUSES = new Set(['ACTIVE','NEEDS TEST','BLOCKED','STABLE','WAITING','DONE','EMPTY','UNSYNCED']);

function cleanProjectText(value, max = 500) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function cleanProjectTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map(item => cleanProjectText(item, 32)).filter(Boolean))].slice(0, 12);
}

function cleanProjectRepo(value) {
  const repo = cleanProjectText(value, 180).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  return repo && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : null;
}

function projectSlug(value = '') {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return slug || 'project';
}

function normalizedManagedControl(existing = {}, payload = {}, now = new Date().toISOString()) {
  const statusInput = Object.prototype.hasOwnProperty.call(payload, 'statusOverride') ? payload.statusOverride : existing.statusOverride;
  const groupInput = Object.prototype.hasOwnProperty.call(payload, 'group') ? payload.group : existing.group;
  const rawStatus = cleanProjectText(statusInput ?? '', 32).toUpperCase();
  const orderInput = Object.prototype.hasOwnProperty.call(payload, 'order') ? payload.order : existing.order;
  const numericOrder = orderInput === null || orderInput === '' || orderInput === undefined ? Number.NaN : Number(orderInput);
  const archived = payload.archived === undefined ? existing.archived === true : payload.archived === true;
  const wasArchived = existing.archived === true;
  return {
    ...existing,
    group:cleanProjectText(groupInput ?? '', 80) || null,
    order:Number.isFinite(numericOrder) ? Math.max(0, Math.round(numericOrder)) : null,
    note:cleanProjectText(payload.note ?? existing.note ?? '', 4000) || null,
    tags:cleanProjectTags(payload.tags ?? existing.tags ?? []),
    statusOverride:MANAGED_PROJECT_STATUSES.has(rawStatus) ? rawStatus : null,
    pinned:payload.pinned === undefined ? existing.pinned === true : payload.pinned === true,
    archived,
    archivedAt:archived ? (wasArchived && existing.archivedAt ? existing.archivedAt : now) : null,
    updatedAt:now,
    updatedBy:'user'
  };
}

function updateManagedProject(state, payload = {}) {
  const projectId = cleanProjectText(payload.projectId, 160);
  const project = state.projects.find(item => item.id === projectId);
  if (!project) return null;
  const now = new Date().toISOString();
  const name = cleanProjectText(payload.name ?? project.name, 120);
  if (!name) throw new Error('Project name is required');
  project.name = name;
  project.universe = cleanProjectText(payload.universe ?? project.universe ?? 'PROJECT', 80) || 'PROJECT';
  project.description = cleanProjectText(payload.description ?? project.description ?? '', 2400) || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'repo')) project.repo = cleanProjectRepo(payload.repo);
  project.control = normalizedManagedControl(project.control || {}, payload, now);
  return project;
}

function createManagedProject(state, payload = {}) {
  const now = new Date().toISOString();
  const name = cleanProjectText(payload.name, 120);
  if (!name) throw new Error('Project name is required');
  let id = `manual-${projectSlug(name)}`;
  let n = 2;
  while (state.projects.some(item => item.id === id)) id = `manual-${projectSlug(name)}-${n++}`;
  const requestedStatus = cleanProjectText(payload.statusOverride || 'ACTIVE', 32).toUpperCase();
  const project = {
    id,
    name,
    universe:cleanProjectText(payload.universe || 'PROJECT', 80) || 'PROJECT',
    kind:'MANUAL_PROJECT',
    repo:cleanProjectRepo(payload.repo),
    description:cleanProjectText(payload.description || '', 2400) || null,
    trackState:true,
    createdAt:now,
    control:normalizedManagedControl({}, {
      ...payload,
      statusOverride:MANAGED_PROJECT_STATUSES.has(requestedStatus) ? requestedStatus : 'ACTIVE'
    }, now)
  };
  state.projects.push(project);
  return project;
}


function bulkUpdateManagedProjects(state, payload = {}) {
  const rawUpdates = Array.isArray(payload.updates)
    ? payload.updates
    : (Array.isArray(payload.projectIds) ? payload.projectIds.map(projectId => ({projectId, ...(payload.patch || {})})) : []);
  if (!rawUpdates.length) throw new Error('No projects selected');
  if (rawUpdates.length > 100) throw new Error('Too many projects selected');

  const seen = new Set();
  const projects = [];
  for (const raw of rawUpdates) {
    const projectId = cleanProjectText(raw?.projectId, 160);
    if (!projectId || seen.has(projectId)) continue;
    seen.add(projectId);
    const project = updateManagedProject(state, {...raw, projectId});
    if (!project) throw new Error(`Project not found: ${projectId}`);
    projects.push(project);
  }
  if (!projects.length) throw new Error('No valid projects selected');
  deriveAll(state, {dirtyProjectIds:projects.map(project => project.id)});
  return projects;
}

function reorderManagedProjects(state, payload = {}) {
  const projectId = cleanProjectText(payload.projectId, 160);
  const project = state.projects.find(item => item.id === projectId);
  if (!project) return null;

  const patch = payload.patch && typeof payload.patch === 'object' && !Array.isArray(payload.patch) ? payload.patch : {};
  updateManagedProject(state, {projectId, ...patch});

  const requested = Array.isArray(payload.projectIds) ? payload.projectIds : [];
  const orderedIds = [...new Set(requested.map(id => cleanProjectText(id, 160)).filter(Boolean))]
    .filter(id => state.projects.some(project => project.id === id));
  if (!orderedIds.includes(projectId)) orderedIds.push(projectId);

  const now = new Date().toISOString();
  const touched = [];
  orderedIds.forEach((id, index) => {
    const item = state.projects.find(project => project.id === id);
    if (!item) return;
    item.control = {
      ...(item.control || {}),
      order:(index + 1) * 100,
      updatedAt:now,
      updatedBy:'user'
    };
    touched.push(item);
  });

  deriveAll(state, {dirtyProjectIds:[projectId]});
  return {project, projects:touched};
}


function managedSourceKey(source = {}) {
  const explicit = cleanProjectText(source.externalId || '', 220);
  if (explicit) return explicit;
  try { return new URL(source.url || '').pathname.match(/\/c\/([^/?#]+)/i)?.[1] || null; }
  catch { return null; }
}

function managedSourceRepo(source = {}) {
  const titleRepo = cleanProjectRepo(source.title || '');
  if (titleRepo) return titleRepo;
  try {
    const url = new URL(source.url || '');
    if (!/github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? cleanProjectRepo(`${parts[0]}/${parts[1]}`) : null;
  } catch {
    return null;
  }
}

function sourceIsGithubBundle(source = {}) {
  return source.type === 'github_repo';
}

function sourceAffectedEvidence(state, source, previousProjectId = null) {
  const direct = (state.evidence || []).filter(item => item.sourceId === source.id);
  if (!sourceIsGithubBundle(source) || !previousProjectId) return direct;
  const repo = managedSourceRepo(source);
  const oldProject = (state.projects || []).find(item => item.id === previousProjectId);
  if (!repo || (oldProject?.repo !== repo && source.control?.repo !== repo)) return direct;
  const bundle = (state.evidence || []).filter(item =>
    item.projectId === previousProjectId &&
    item.liveSync === true &&
    /^github_/.test(String(item.sourceType || ''))
  );
  return [...new Map([...direct, ...bundle].map(item => [item.id, item])).values()];
}

function moveManagedSource(state, payload = {}) {
  state.settings ||= {};
  state.settings.manualMappings ||= {};
  state.sources ||= [];
  state.evidence ||= [];
  state.projects ||= [];

  const sourceId = cleanProjectText(payload.sourceId, 220);
  const source = state.sources.find(item => item.id === sourceId);
  if (!source) return null;
  if (!['chatgpt_thread','chatgpt_archived','github_repo'].includes(source.type)) throw new Error('This source is managed automatically and cannot be moved manually');

  const requestedProjectId = cleanProjectText(payload.projectId || '', 180) || null;
  const target = requestedProjectId ? state.projects.find(item => item.id === requestedProjectId) : null;
  if (requestedProjectId && !target) throw new Error('Target project not found');

  const previousProjectId = source.projectId || null;
  const previousProject = previousProjectId ? state.projects.find(item => item.id === previousProjectId) : null;
  const now = new Date().toISOString();
  const repo = sourceIsGithubBundle(source) ? managedSourceRepo(source) : null;

  if (repo && target?.repo && target.repo !== repo) {
    throw new Error(`Target project already uses GitHub repo ${target.repo}`);
  }

  const affectedEvidence = sourceAffectedEvidence(state, source, previousProjectId);
  for (const evidence of affectedEvidence) {
    evidence.projectId = target?.id || null;
    evidence.controlExcluded = source.control?.archived === true || !target;
  }

  if (repo) {
    if (previousProject && previousProject.id !== target?.id && previousProject.repo === repo) previousProject.repo = null;
    if (target) target.repo = repo;
  }

  source.projectId = target?.id || null;
  source.state = target ? 'MAPPED' : 'DETACHED';
  source.control = {
    ...(source.control || {}),
    assignment:'MANUAL',
    projectId:target?.id || null,
    detached:!target,
    updatedAt:now,
    updatedBy:'user'
  };

  const key = managedSourceKey(source);
  if (key && ['chatgpt_thread','chatgpt_archived'].includes(source.type)) {
    if (target) state.settings.manualMappings[key] = target.id;
    else delete state.settings.manualMappings[key];
  }

  const dirtyProjectIds = [...new Set([previousProjectId, target?.id].filter(Boolean))];
  deriveAll(state, {dirtyProjectIds});
  return {source, previousProjectId, projectId:target?.id || null, dirtyProjectIds};
}

function archiveManagedSource(state, payload = {}) {
  state.sources ||= [];
  state.evidence ||= [];
  state.projects ||= [];

  const sourceId = cleanProjectText(payload.sourceId, 220);
  const source = state.sources.find(item => item.id === sourceId);
  if (!source) return null;
  if (!['chatgpt_thread','chatgpt_archived','github_repo'].includes(source.type)) throw new Error('This source is managed automatically and cannot be archived manually');

  const archived = payload.archived === true;
  const now = new Date().toISOString();
  const projectId = source.projectId || null;
  const project = projectId ? state.projects.find(item => item.id === projectId) : null;
  const repo = sourceIsGithubBundle(source) ? managedSourceRepo(source) : null;
  const affectedEvidence = sourceAffectedEvidence(state, source, projectId);

  source.control = {
    ...(source.control || {}),
    archived,
    archivedAt:archived ? (source.control?.archivedAt || now) : null,
    updatedAt:now,
    updatedBy:'user'
  };

  for (const evidence of affectedEvidence) evidence.controlExcluded = archived || !source.projectId;

  if (repo && project) {
    if (archived && project.repo === repo) {
      source.control.repo = repo;
      project.repo = null;
    } else if (!archived && !project.repo) {
      project.repo = source.control?.repo || repo;
    } else if (!archived && project.repo && project.repo !== repo) {
      throw new Error(`Project already uses GitHub repo ${project.repo}`);
    }
  }

  if (projectId) deriveAll(state, {dirtyProjectIds:[projectId]});
  return {source, projectId, archived};
}

function assignDiscoveredManaged(state, payload = {}) {
  state.settings ||= {};
  state.settings.manualMappings ||= {};
  state.sources ||= [];
  state.evidence ||= [];
  state.discovered ||= [];
  state.projects ||= [];

  const discoveredId = cleanProjectText(payload.discoveredId, 220);
  const discovered = state.discovered.find(item => item.id === discoveredId);
  if (!discovered) return null;

  let project = null;
  const requestedProjectId = cleanProjectText(payload.projectId || '', 180);
  if (requestedProjectId) project = state.projects.find(item => item.id === requestedProjectId) || null;
  if (!project && payload.createProjectName) {
    project = createManagedProject(state, {
      name:cleanProjectText(payload.createProjectName, 120),
      universe:cleanProjectText(payload.universe || discovered.projectTitle || 'PROJECT', 80) || 'PROJECT',
      statusOverride:'ACTIVE'
    });
  }
  if (!project) throw new Error('Project not found');

  const key = cleanProjectText(discovered.conversationKey || discovered.externalId || discovered.url || '', 300) || null;
  let source = key
    ? state.sources.find(item => ['chatgpt_thread','chatgpt_archived'].includes(item.type) && (item.externalId === key || item.url === discovered.url))
    : null;

  if (!source) {
    const base = projectSlug(discovered.title || 'source');
    source = { id:`src-manual-${base}-${Date.now().toString(36)}` };
    state.sources.push(source);
  }

  Object.assign(source, {
    projectId:project.id,
    type:discovered.type || 'chatgpt_thread',
    externalId:key,
    title:discovered.title || source.title || 'Mapped source',
    url:discovered.url || source.url || null,
    lastObservedAt:discovered.observedAt || discovered.lastObservedAt || new Date().toISOString(),
    state:'MAPPED',
    chatgptProjectKey:discovered.chatgptProjectKey || source.chatgptProjectKey || null,
    chatgptProjectTitle:discovered.projectTitle || discovered.chatgptProjectTitle || source.chatgptProjectTitle || null,
    control:{
      ...(source.control || {}),
      assignment:'MANUAL',
      projectId:project.id,
      detached:false,
      updatedAt:new Date().toISOString(),
      updatedBy:'user'
    }
  });

  if (key) state.settings.manualMappings[key] = project.id;
  state.discovered = state.discovered.filter(item => item.id !== discovered.id);
  deriveAll(state, {dirtyProjectIds:[project.id]});
  return {source, project};
}

function serveStatic(url, res) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return json(res, 400, {error:'Invalid path'}); }

  const relative = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(PUBLIC, `.${relative}`);
  const publicPrefix = `${path.resolve(PUBLIC)}${path.sep}`;
  if (!file.startsWith(publicPrefix) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store'});
    return res.end('Not found');
  }

  const types = {
    '.html':'text/html; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.svg':'image/svg+xml',
    '.png':'image/png',
    '.ico':'image/x-icon'
  };
  res.writeHead(200, {
    'Content-Type':types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control':'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
      if (!guardRequest(req, res)) return;
      if (req.method === 'OPTIONS') return json(res, 204, {});
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/api/state') {
        if (process.env.SHINO_CONTROL_TOKEN && !authorized(req)) return json(res, 401, {error:'Unauthorized'});
        return json(res, 200, readState({ derive:true }));
      }

      if (req.method === 'POST' && url.pathname === '/api/projects/update') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const project = updateManagedProject(state, payload);
        if (!project) return json(res, 404, {error:'Project not found'});
        deriveAll(state, {dirtyProjectIds:[project.id]});
        writeState(state);
        return json(res, 200, {ok:true, project, state});
      }

      if (req.method === 'POST' && url.pathname === '/api/projects/create') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const project = createManagedProject(state, payload);
        deriveAll(state, {dirtyProjectIds:[project.id]});
        writeState(state);
        return json(res, 201, {ok:true, project, state});
      }

      if (req.method === 'POST' && url.pathname === '/api/projects/bulk') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const projects = bulkUpdateManagedProjects(state, payload);
        writeState(state);
        return json(res, 200, {ok:true, projects, state});
      }

      if (req.method === 'POST' && url.pathname === '/api/projects/reorder') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = reorderManagedProjects(state, payload);
        if (!result) return json(res, 404, {error:'Project not found'});
        writeState(state);
        return json(res, 200, {ok:true, ...result, state});
      }

      if (req.method === 'POST' && url.pathname === '/api/sources/move') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = moveManagedSource(state, payload);
        if (!result) return json(res, 404, {error:'Source not found'});
        writeState(state);
        return json(res, 200, {ok:true, ...result, state});
      }

      if (req.method === 'POST' && url.pathname === '/api/sources/archive') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = archiveManagedSource(state, payload);
        if (!result) return json(res, 404, {error:'Source not found'});
        writeState(state);
        return json(res, 200, {ok:true, ...result, state});
      }

      if (req.method === 'POST' && url.pathname === '/api/discovered/assign') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = assignDiscoveredManaged(state, payload);
        if (!result) return json(res, 404, {error:'Discovered source not found'});
        writeState(state);
        return json(res, 200, {ok:true, ...result, state});
      }

      if (req.method === 'POST' && url.pathname === '/api/control/restart') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        json(res, 200, {ok:true, restarting:true});
        setTimeout(() => process.exit(0), 250);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/chatgpt/catchup-plan') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = planChatgptCatchup(state, payload, {maxPlan:payload.maxPlan || 32});
        return json(res, 200, result);
      }

      if (req.method === 'POST' && url.pathname === '/api/chatgpt/catchup-report') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        state.settings ||= {};
        state.settings.chatgptInaccessible ||= {};
        state.settings.chatgptTimeoutQuarantine ||= {};
        const rawFailures = Array.isArray(payload.failures) ? payload.failures.slice(0,10) : [];
        const failures = rawFailures.map(catchupFailure);
        const inaccessible = Array.isArray(payload.inaccessible) ? payload.inaccessible.slice(0,20).map(catchupInaccessible) : [];
        const observedAt = new Date().toISOString();
        const observedMs = Date.parse(observedAt);

        for (const item of inaccessible) {
          if (!item.key) continue;
          state.settings.chatgptInaccessible[item.key] = {
            title:item.title,
            error:item.error,
            remoteUpdatedAt:item.remoteUpdatedAt,
            observedAt
          };
        }

        for (const raw of rawFailures) {
          if (!isCatchupTimeout(raw)) continue;
          const item = catchupTimeout(raw);
          if (!item.key) continue;
          const previous = state.settings.chatgptTimeoutQuarantine[item.key] || null;
          const attempts = previous && sameRemoteTimestamp(previous.remoteUpdatedAt, item.remoteUpdatedAt)
            ? Number(previous.attempts || 0) + 1
            : 1;
          state.settings.chatgptTimeoutQuarantine[item.key] = {
            title:item.title,
            error:item.error,
            remoteUpdatedAt:item.remoteUpdatedAt,
            observedAt,
            attempts,
            retryAt:new Date(observedMs + timeoutRetryDelayMs(attempts)).toISOString()
          };
        }

        const quarantined = activeTimeoutQuarantine(state, observedMs);
        const failedCount = Number(payload.failedCount || 0);
        const deferredCount = Number(payload.deferredCount || 0);
        state.settings.lastChatgptCatchup = {
          at:observedAt,
          source:'control-collector-api-metadata',
          inventoryCount:Number(payload.inventoryCount || 0),
          knownCount:Number(payload.knownCount || 0),
          unchangedCount:Number(payload.unchangedCount || 0),
          changedCount:Number(payload.changedCount || 0),
          newCount:Number(payload.newCount || 0),
          baselineMissingCount:Number(payload.baselineMissingCount || 0),
          inaccessibleCount:Number(payload.inaccessibleCount || 0),
          quarantinedCount:quarantined.length,
          plannedCount:Number(payload.plannedCount || 0),
          refreshedCount:Number(payload.refreshedCount || 0),
          skippedCount:Number(payload.skippedCount || 0),
          failedCount,
          deferredCount,
          status:failedCount > 0 || deferredCount > 0 ? 'PARTIAL' : 'HEALTHY',
          failures,
          inaccessible,
          quarantined:quarantined.slice(0,20)
        };
        writeState(state);
        return json(res, 200, {ok:true, ...state.settings.lastChatgptCatchup});
      }

      if (req.method === 'POST' && url.pathname === '/api/ingest/chatgpt-delta') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = ingestChatgptDelta(state, payload);
        const conversationKey = String(payload.conversationKey || '').trim();
        let quarantineCleared = false;
        if (conversationKey && state.settings?.chatgptTimeoutQuarantine?.[conversationKey]) {
          delete state.settings.chatgptTimeoutQuarantine[conversationKey];
          quarantineCleared = true;
        }
        if (result.changed || quarantineCleared) writeState(state);
        return json(res, 200, {...result, timeoutQuarantineCleared:quarantineCleared});
      }

      if (req.method === 'POST' && url.pathname === '/api/sync/github') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const token = payload.token || process.env.GITHUB_TOKEN || '';
        const state = readState();
        const result = await syncGithubIncremental(state, token);
        writeState(state);
        return json(res, 200, {ok:true, ...result, state});
      }

      res.once('finish', scrubStateFile);

      if (req.method === 'POST' && url.pathname === '/api/remap') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const mapped = assignDiscoveredManaged(state, payload);
        if (!mapped) return json(res, 404, {error:'Source/project not found'});
        writeState(state);
        return json(res, 200, {ok:true, sourceId:mapped.source.id, projectId:mapped.project.id});
      }

      if (req.method === 'POST' && url.pathname === '/api/discovered/ignore') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        state.discovered = state.discovered.filter(item => item.id !== payload.id);
        deriveAll(state);
        writeState(state);
        return json(res, 200, {ok:true});
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, {error:'Unknown CONTROL API route'});
      return serveStatic(url, res);
    } catch (error) {
      return json(res, 500, {error:String(error?.message || error)});
    }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SHINO // CONTROL → http://127.0.0.1:${PORT}`);
});
