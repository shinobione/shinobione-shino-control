import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestChatgptDelta } from './lib/chatgpt-delta-ingest.mjs';
import { planChatgptCatchup } from './lib/chatgpt-catchup-plan.mjs';
import { repairChatgptProjectOwnership } from './lib/chatgpt-project-ownership.mjs';
import { deriveAll } from './lib/derive.mjs';
import { syncGithubIncremental } from './lib/github-incremental-sync.mjs';
import { runtimeStatePath } from './lib/state-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = runtimeStatePath();
const originalCreateServer = http.createServer.bind(http);
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

      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, readState({ derive:true }));
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
    } catch (error) {
      return json(res, 500, {error:String(error?.message || error)});
    }

    res.once('finish', scrubStateFile);
    return listener(req, res);
  });
};

await import('./server.mjs');
