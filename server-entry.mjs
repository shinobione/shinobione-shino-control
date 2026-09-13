import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChatgptInventoryMetadata } from './lib/chatgpt-inventory.mjs';
import { ingestChatgptDelta } from './lib/chatgpt-delta-ingest.mjs';
import { deriveAll } from './lib/derive.mjs';
import { syncGithubIncremental } from './lib/github-incremental-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data', 'state.json');
const originalCreateServer = http.createServer.bind(http);

function norm(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function restorePersonnelProject() {
  const state = JSON.parse(fs.readFileSync(DATA, 'utf8'));
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
  for (const [key, value] of Object.entries(state.settings.manualMappings)) {
    if (value === 'astrid-admin') state.settings.manualMappings[key] = 'personnel';
  }
  for (const [key, value] of Object.entries(state.settings.chatgptProjectMappings)) {
    if (value === 'astrid-admin') state.settings.chatgptProjectMappings[key] = 'personnel';
  }

  // "Aide avec mon ex conjointe" was mistakenly modeled as a project. It is a conversation
  // inside PERSONNEL, not a standalone CONTROL project.
  state.projects = state.projects.filter(project => project.id !== 'astrid-admin');

  // Seed/persist the per-project derivation fingerprints at startup. Normal dashboard reads can
  // then reuse unchanged cards instead of rebuilding every project from scratch.
  deriveAll(state);
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
}

restorePersonnelProject();

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
  const required = process.env.SHINO_SYNC_TOKEN;
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

      // CONTROL Collector: tiny authenticated-browser sensor -> local CONTROL delta ingest.
      // The collector sends only the current conversation tail plus identifiers/timestamps. All
      // mapping, deduplication, cursors and project derivation stay in CONTROL Core.
      if (req.method === 'POST' && url.pathname === '/api/ingest/chatgpt-delta') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        const result = ingestChatgptDelta(state, payload);
        // A no-change fingerprint is a genuine no-op: do not rewrite state.json just because the
        // browser observed the same rendered conversation again.
        if (result.changed) fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
        return json(res, 200, result);
      }

      // Legacy inventory endpoint stays temporarily available during migration. The new Collector
      // never calls it; this can disappear together with extension/shino-sync after live validation.
      if (req.method === 'POST' && url.pathname === '/api/ingest/chatgpt-inventory') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        const result = applyChatgptInventoryMetadata(state, payload);
        deriveAll(state);
        fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
        return json(res, 200, {ok:true, ...result, derivation:state.settings?.lastDerivation || null});
      }

      // Intercept the legacy sync route before server.mjs. The UI keeps the same button/endpoint,
      // but CONTROL now uses ETag cursors and only dirties projects whose GitHub feeds changed.
      if (req.method === 'POST' && url.pathname === '/api/sync/github') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const token = payload.token || process.env.GITHUB_TOKEN || '';
        const state = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        const result = await syncGithubIncremental(state, token);
        fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
        return json(res, 200, {ok:true, ...result, state});
      }
    } catch (error) {
      return json(res, 500, {error:String(error?.message || error)});
    }
    return listener(req, res);
  });
};

await import('./server.mjs');
