import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAll } from './lib/derive.mjs';
import { runtimeStatePath, writeRuntimeState } from './lib/state-store.mjs';
import { authorized, json } from './lib/http-security.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA = runtimeStatePath();
const PORT = Number(process.env.PORT || 4177);

function readState() {
  const state = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  state.settings ||= {};
  state.settings.manualMappings ||= {};
  state.settings.chatgptProjectMappings ||= {};
  state.projects ||= [];
  state.sources ||= [];
  state.evidence ||= [];
  state.discovered ||= [];
  return state;
}

function saveState(state) {
  deriveAll(state);
  writeRuntimeState(state);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (error) { reject(error); }
    });
  });
}

function safeId(prefix='id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

function discoveredKey(item = {}) {
  return item.conversationKey || item.externalId || item.url || null;
}

function mapDiscoveredSource(state, discoveredId, projectId) {
  const discovered = state.discovered.find(item => item.id === discoveredId);
  const project = state.projects.find(item => item.id === projectId);
  if (!discovered || !project) return null;

  const key = discoveredKey(discovered);
  if (key) state.settings.manualMappings[key] = project.id;
  if (discovered.chatgptProjectKey) state.settings.chatgptProjectMappings[discovered.chatgptProjectKey] = project.id;

  let source = key
    ? state.sources.find(item => item.type === discovered.type && (item.externalId === key || item.url === discovered.url))
    : null;

  if (!source) {
    source = { id:safeId('src') };
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
    chatgptProjectTitle:discovered.projectTitle || discovered.chatgptProjectTitle || source.chatgptProjectTitle || null
  });

  state.discovered = state.discovered.filter(item => item.id !== discovered.id);
  return { sourceId:source.id, projectId:project.id };
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
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    // Core-owned routes (/api/state, ChatGPT delta ingest and GitHub sync) are intercepted by
    // server-entry.mjs before this compatibility/UI server is reached.
    if (req.method === 'POST' && url.pathname === '/api/remap') {
      if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
      const payload = await readBody(req);
      const state = readState();
      const mapped = mapDiscoveredSource(state, payload.discoveredId, payload.projectId);
      if (!mapped) return json(res, 404, {error:'Source/project not found'});
      saveState(state);
      return json(res, 200, {ok:true, ...mapped});
    }

    if (req.method === 'POST' && url.pathname === '/api/discovered/ignore') {
      if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
      const payload = await readBody(req);
      const state = readState();
      state.discovered = state.discovered.filter(item => item.id !== payload.id);
      saveState(state);
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
