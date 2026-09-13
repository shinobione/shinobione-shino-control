import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestChatgptDelta } from './lib/chatgpt-delta-ingest.mjs';
import { planChatgptCatchup } from './lib/chatgpt-catchup-plan.mjs';
import { deriveAll } from './lib/derive.mjs';
import { syncGithubIncremental } from './lib/github-incremental-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data', 'state.json');
const originalCreateServer = http.createServer.bind(http);
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
  if (derive) deriveAll(state);
  return state;
}

function readState({ derive = false } = {}) {
  return normalizeState(JSON.parse(fs.readFileSync(DATA, 'utf8')), { derive });
}

function writeState(state) {
  retireLegacyShinoSync(state);
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
}

function scrubStateFile() {
  try {
    const before = fs.readFileSync(DATA, 'utf8');
    const state = normalizeState(JSON.parse(before));
    const after = JSON.stringify(state, null, 2);
    if (after !== before.trim()) fs.writeFileSync(DATA, after);
  } catch {}
}

// One-time startup migration: retire SHINO Sync artifacts while preserving historical ChatGPT
// inventory coverage metadata (17 projects / 131 conversations) as read-only provenance.
{
  const state = readState({ derive:true });
  writeState(state);
}

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip.includes('::ffff:127.0.0.1');
}

function authorized(req) {
  const required = process.env.SHINO_CONTROL_TOKEN;
  if (!required) return isLoopback(req);
  return req.headers.authorization === `Bearer ${required}`;
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

http.createServer = function wrappedCreateServer(listener) {
  return originalCreateServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // Serve the normalized CONTROL state directly so the retired SHINO Sync component can never
      // be reintroduced into the dashboard by the legacy inner server model.
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, readState({ derive:true }));
      }

      // Metadata-only catch-up planner. The authenticated browser supplies the current ChatGPT
      // project/conversation metadata; CONTROL returns only conversations that are new or newer than
      // its local source/evidence timestamps. No messages are accepted or persisted on this route.
      if (req.method === 'POST' && url.pathname === '/api/chatgpt/catchup-plan') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = planChatgptCatchup(state, payload, {maxPlan:payload.maxPlan || 32});
        return json(res, 200, result);
      }

      // Small completion diagnostic used by the UI/status view. The actual project updates still go
      // through the normal delta ingest endpoint, preserving one source of truth for derivation.
      if (req.method === 'POST' && url.pathname === '/api/chatgpt/catchup-report') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        state.settings ||= {};
        state.settings.lastChatgptCatchup = {
          at:new Date().toISOString(),
          source:'control-collector-api-metadata',
          inventoryCount:Number(payload.inventoryCount || 0),
          plannedCount:Number(payload.plannedCount || 0),
          refreshedCount:Number(payload.refreshedCount || 0),
          failedCount:Number(payload.failedCount || 0),
          deferredCount:Number(payload.deferredCount || 0)
        };
        writeState(state);
        return json(res, 200, {ok:true, ...state.settings.lastChatgptCatchup});
      }

      // CONTROL Collector: authenticated browser sensor -> local CONTROL delta ingest.
      if (req.method === 'POST' && url.pathname === '/api/ingest/chatgpt-delta') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = readState();
        const result = ingestChatgptDelta(state, payload);
        // A no-change fingerprint is a genuine no-op: do not rewrite state.json.
        if (result.changed) writeState(state);
        return json(res, 200, result);
      }

      // The UI keeps the same GitHub-sync endpoint, but CONTROL uses ETag cursors and only dirties
      // projects whose GitHub feeds changed.
      if (req.method === 'POST' && url.pathname === '/api/sync/github') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const token = payload.token || process.env.GITHUB_TOKEN || '';
        const state = readState();
        const result = await syncGithubIncremental(state, token);
        writeState(state);
        return json(res, 200, {ok:true, ...result, state});
      }
    } catch (error) {
      return json(res, 500, {error:String(error?.message || error)});
    }

    // Any still-supported legacy inner-server endpoint is allowed to finish, then the on-disk state
    // is scrubbed so it cannot persist a retired SHINO Sync component/source.
    res.once('finish', scrubStateFile);
    return listener(req, res);
  });
};

await import('./server.mjs');
