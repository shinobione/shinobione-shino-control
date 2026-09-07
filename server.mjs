import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAll } from './lib/derive.mjs';
import { resolveProjectDetailed } from './lib/resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data', 'state.json');
const PORT = Number(process.env.PORT || 4177);
const CONTROL_REPO = 'shinobione/shinobione-shino-control';

const SYSTEM_PROJECTS = [
  {
    id: 'control', name: 'SHINO // CONTROL', universe: 'SYSTEM / DEV', kind: 'APP', repo: CONTROL_REPO,
    components: [
      { id:'shino-sync', name:'SHINO Sync', kind:'EXTENSION', path:'extension/shino-sync', manifest:'extension/shino-sync/manifest.json' }
    ],
    description: 'Source-derived project radar and one-click resume hub for the whole SHINO ecosystem.'
  },
  {
    id: 'shino-codes', name: 'Shino Codes', universe: 'DEV / UMBRELLA', kind: 'CHATGPT_PROJECT', repo: null,
    description: 'ChatGPT project container for SHINO development work and engineering conversations.'
  },
  {
    id: 'astrid-admin', name: 'Aide avec mon ex conjointe', universe: 'PERSONAL / ADMIN', kind: 'CHATGPT_PROJECT', repo: null,
    description: 'Administrative and mediation workstream tracked from ChatGPT conversations.'
  }
];

function ensureProject(state, spec) {
  let p = state.projects.find(x => x.id === spec.id);
  if (!p) {
    p = { ...spec };
    state.projects.push(p);
  } else {
    for (const [k, v] of Object.entries(spec)) {
      if (v !== undefined && (p[k] == null || ['kind','repoPath','components'].includes(k))) p[k] = v;
    }
  }
  return p;
}

function ensureRepoSource(state, project) {
  if (!project.repo) return;
  let src = state.sources.find(s => s.projectId === project.id && s.type === 'github_repo');
  if (!src) {
    src = {
      id: `src-${project.id}-repo`, projectId: project.id, type: 'github_repo', title: project.repo,
      url: project.repoPath ? `https://github.com/${project.repo}/tree/main/${project.repoPath}` : `https://github.com/${project.repo}`,
      lastObservedAt: null
    };
    state.sources.push(src);
  }
}

function ensureComponentSources(state, project) {
  for (const component of project.components || []) {
    let src = state.sources.find(s => s.projectId === project.id && s.type === 'github_component' && s.componentId === component.id);
    if (!src) {
      src = {
        id:`src-${project.id}-component-${component.id}`,
        projectId:project.id,
        type:'github_component',
        componentId:component.id,
        title:component.name,
        url:`https://github.com/${project.repo}/tree/main/${component.path}`,
        lastObservedAt:null,
        state:'COMPONENT'
      };
      state.sources.push(src);
    }
  }
}

function mergeLegacyComponentProject(state, fromId, toId, label) {
  const legacy = state.projects.find(p => p.id === fromId);
  if (!legacy) return;
  for (const s of state.sources.filter(s => s.projectId === fromId)) {
    s.projectId = toId;
    if (s.type === 'github_repo') {
      s.type = 'github_component';
      s.componentId = fromId;
      s.title = label;
      s.state = 'COMPONENT';
    }
  }
  for (const e of state.evidence.filter(e => e.projectId === fromId)) {
    e.projectId = toId;
    if (e.title && !e.title.toLowerCase().includes(label.toLowerCase())) e.title = `${label} · ${e.title}`;
  }
  for (const [key, value] of Object.entries(state.settings.manualMappings || {})) {
    if (value === fromId) state.settings.manualMappings[key] = toId;
  }
  for (const [key, value] of Object.entries(state.settings.chatgptProjectMappings || {})) {
    if (value === fromId) state.settings.chatgptProjectMappings[key] = toId;
  }
  state.projects = state.projects.filter(p => p.id !== fromId);
}

function ensureSystemProjects(state) {
  state.version ||= 1;
  state.settings ||= {};
  state.settings.githubRepos ||= [];
  state.settings.manualMappings ||= {};
  state.settings.chatgptProjectMappings ||= {};
  state.projects ||= [];
  state.sources ||= [];
  state.evidence ||= [];
  state.discovered ||= [];

  for (const spec of SYSTEM_PROJECTS) {
    const project = ensureProject(state, spec);
    ensureRepoSource(state, project);
    ensureComponentSources(state, project);
  }

  mergeLegacyComponentProject(state, 'shino-sync', 'control', 'SHINO Sync');

  const suno = state.projects.find(p => p.id === 'suno-bridge');
  if (suno) suno.kind = 'EXTENSION';
  for (const repo of state.projects.map(p => p.repo).filter(Boolean)) {
    if (!state.settings.githubRepos.includes(repo)) state.settings.githubRepos.push(repo);
  }
  return state;
}

function loadState() {
  const raw = ensureSystemProjects(JSON.parse(fs.readFileSync(DATA, 'utf8')));
  return deriveAll(raw);
}
function saveState(state) {
  ensureSystemProjects(state);
  deriveAll(state);
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
}
function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8_000_000) reject(new Error('payload too large')); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
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
function safeId(prefix='id') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

function extractChatEvidence(payload, project) {
  const text = `${payload.title || ''}\n${payload.projectTitle || ''}\n${payload.transcript || ''}`;
  const lines = text.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const important = lines.filter(l => /(pass|fail|merged|blocked|blocker|next|pending|test|validated|deployed|supersed|do not merge|resume|physical|synced|sync failed|fixed|works|working|shipped|todo|remaining)/i.test(l));
  const summary = important.slice(-5).join(' · ').slice(0, 1800) || lines.slice(-4).join(' · ').slice(0, 1800) || 'ChatGPT thread synced.';
  const next = [...important].reverse().find(l => /(next|resume|retest|needs? test|pending|physical gate|live test|todo|remaining)/i.test(l));
  let hint;
  if (/blocked|blocker/i.test(summary)) hint = 'BLOCKED';
  else if (/pending|retest|needs? test|physical gate|live test/i.test(summary)) hint = 'NEEDS TEST';
  else if (/pass|merged|complete|stable|synced|fixed|works|working|shipped/i.test(summary)) hint = 'ACTIVE';
  return {
    id: safeId('chat'), projectId: project.id, sourceType: 'chatgpt_thread', type: 'chat_sync',
    timestamp: payload.lastMessageAt || payload.clientTimestamp || new Date().toISOString(),
    title: payload.title || 'ChatGPT conversation', summary,
    url: payload.url, confidence: 0.87, derivedStatusHint: hint,
    currentStateSummary: summary.slice(0, 650), resumeAction: next || 'Continue in the synced ChatGPT thread.',
    chatgptProjectKey: payload.projectKey || null, chatgptProjectTitle: payload.projectTitle || null
  };
}

async function githubJson(url, token) {
  const r = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'shino-control', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}
async function githubTextFile(repo, file, branch, token) {
  try {
    const clean = file.split('/').map(encodeURIComponent).join('/');
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${clean}?ref=${encodeURIComponent(branch)}`, { headers: { 'Accept':'application/vnd.github.raw+json','User-Agent':'shino-control', ...(token ? { Authorization:`Bearer ${token}` } : {}) } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}
function truthSummary(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(x => x.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const signals = lines.filter(l => /(NEXT|PASS|PENDING|BLOCKED|COMPLETE|ACCEPTED|DO NOT MERGE|SUPERSEDED|REAL USER|PHYSICAL|CURRENT|STATUS|VERSION)/i.test(l));
  return signals.slice(0, 12).join(' · ').slice(0, 2200) || lines.slice(0, 8).join(' · ').slice(0, 1600);
}

async function syncGithub(state, token) {
  const results = [];
  for (const project of state.projects.filter(p => p.repo)) {
    try {
      const meta = await githubJson(`https://api.github.com/repos/${project.repo}`, token);
      const pathQuery = project.repoPath ? `&path=${encodeURIComponent(project.repoPath)}` : '';
      const [commits, prs, runs] = await Promise.all([
        githubJson(`https://api.github.com/repos/${project.repo}/commits?per_page=8${pathQuery}`, token).catch(()=>[]),
        project.repoPath ? Promise.resolve([]) : githubJson(`https://api.github.com/repos/${project.repo}/pulls?state=all&sort=updated&direction=desc&per_page=15`, token).catch(()=>[]),
        project.repoPath ? Promise.resolve({workflow_runs:[]}) : githubJson(`https://api.github.com/repos/${project.repo}/actions/runs?per_page=8`, token).catch(()=>({workflow_runs:[]}))
      ]);

      state.evidence = state.evidence.filter(e => !(e.projectId === project.id && e.liveSync === true));
      for (const c of commits.slice(0,5)) state.evidence.push({
        id: safeId('ghc'), projectId: project.id, sourceType:'github_commit', type:'commit', timestamp:c.commit?.committer?.date || c.commit?.author?.date || meta.pushed_at,
        title:c.commit?.message?.split('\n')[0] || c.sha.slice(0,7), summary:c.commit?.message || '', url:c.html_url, confidence:0.92, liveSync:true
      });
      for (const pr of prs.slice(0,10)) {
        const t = `${pr.title || ''} ${pr.body || ''}`;
        state.evidence.push({
          id:safeId('ghpr'), projectId:project.id, sourceType:'github_pr', type:pr.merged_at?'merge':'pr', timestamp:pr.updated_at || pr.created_at,
          title:`PR #${pr.number} — ${pr.title}${pr.merged_at?' — MERGED':pr.draft?' — DRAFT':''}`,
          summary:(pr.body || '').slice(0,2400), url:pr.html_url, confidence:0.97, liveSync:true,
          derivedStatusHint: /physical.*pending|live test|needs? test|smoke pending/i.test(t) ? 'NEEDS TEST' : undefined,
          resumeAction: /physical.*pending|live test|needs? test|smoke pending/i.test(t) ? `Review/test PR #${pr.number}: ${pr.title}` : undefined
        });
      }

      const truthCandidates = project.repoPath
        ? [`${project.repoPath}/README.md`]
        : ['PROJECT_STATE.md','PROJECT-STATE.md','ROADMAP.md','README.md'];
      for (const f of truthCandidates) {
        const txt = await githubTextFile(project.repo, f, meta.default_branch, token);
        const summary = truthSummary(txt);
        if (summary) state.evidence.push({ id:safeId('ght'), projectId:project.id, sourceType:'github_truth', type:'truth_file', timestamp:commits[0]?.commit?.committer?.date || meta.pushed_at || new Date().toISOString(), title:`${f} truth snapshot`, summary, url:`https://github.com/${project.repo}/blob/${meta.default_branch}/${f}`, confidence:0.99, liveSync:true });
      }

      if (project.repoPath) {
        const manifestPath = `${project.repoPath}/manifest.json`;
        const manifestText = await githubTextFile(project.repo, manifestPath, meta.default_branch, token);
        if (manifestText) {
          try {
            const m = JSON.parse(manifestText);
            state.evidence.push({
              id:safeId('ghmanifest'), projectId:project.id, sourceType:'github_component', type:'manifest',
              timestamp:commits[0]?.commit?.committer?.date || meta.pushed_at || new Date().toISOString(),
              title:`${m.name || project.name} v${m.version || '?'}`,
              summary:m.description || `Browser extension manifest at ${manifestPath}`,
              url:`https://github.com/${project.repo}/blob/${meta.default_branch}/${manifestPath}`,
              confidence:0.99, liveSync:true, derivedStatusHint:'ACTIVE'
            });
          } catch {}
        }
      }

      for (const component of project.components || []) {
        const manifestPath = component.manifest || `${component.path}/manifest.json`;
        const manifestText = await githubTextFile(project.repo, manifestPath, meta.default_branch, token);
        if (!manifestText) continue;
        try {
          const m = JSON.parse(manifestText);
          state.evidence.push({
            id:safeId('ghcomponent'), projectId:project.id, sourceType:'github_component', type:'component_manifest',
            timestamp:commits[0]?.commit?.committer?.date || meta.pushed_at || new Date().toISOString(),
            title:`${component.name} v${m.version || '?'}`,
            summary:m.description || `${component.name} component manifest`,
            url:`https://github.com/${project.repo}/blob/${meta.default_branch}/${manifestPath}`,
            confidence:0.99, liveSync:true, componentId:component.id
          });
          const src = state.sources.find(s => s.projectId === project.id && s.type === 'github_component' && s.componentId === component.id);
          if (src) {
            src.lastObservedAt = new Date().toISOString();
            src.state = `v${m.version || '?'} · COMPONENT`;
            src.url = `https://github.com/${project.repo}/tree/${meta.default_branch}/${component.path}`;
          }
        } catch {}
      }

      if (runs.workflow_runs?.length) {
        const run = runs.workflow_runs[0];
        state.evidence.push({ id:safeId('ghci'), projectId:project.id, sourceType:'github_ci', type:'workflow', timestamp:run.updated_at, title:`Workflow: ${run.name}`, summary:`${run.status} / ${run.conclusion || 'pending'} on ${run.head_branch || 'unknown branch'}`, url:run.html_url, confidence:0.9, liveSync:true });
      }
      let src = state.sources.find(s => s.projectId === project.id && s.type === 'github_repo');
      if (!src) {
        src = { id:safeId('src'), projectId:project.id, type:'github_repo', title:project.repo, url:`https://github.com/${project.repo}`, lastObservedAt:new Date().toISOString() };
        state.sources.push(src);
      } else src.lastObservedAt = new Date().toISOString();
      results.push({ repo:project.repo, path:project.repoPath || null, projectId:project.id, ok:true });
    } catch (e) {
      results.push({ repo:project.repo, path:project.repoPath || null, projectId:project.id, ok:false, error:String(e.message || e) });
    }
  }
  deriveAll(state); saveState(state); return results;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, loadState());

    if (req.method === 'POST' && url.pathname === '/api/ingest/chatgpt') {
      if (!authorized(req)) return json(res, 401, { error:'Unauthorized. For remote use set SHINO_SYNC_TOKEN.' });
      const payload = await body(req);
      if (!payload.url || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(payload.url)) return json(res, 400, { error:'Invalid ChatGPT URL' });
      const state = loadState();
      const key = payload.conversationKey || payload.url;
      let source = state.sources.find(s => s.externalId === key);
      const manualId = state.settings.manualMappings?.[key];
      const projectMapId = payload.projectKey ? state.settings.chatgptProjectMappings?.[payload.projectKey] : null;
      const resolved = resolveProjectDetailed({ title: payload.title || '', projectTitle: payload.projectTitle || '', transcript: payload.transcript || '' }, state.projects);
      const titleResolved = resolveProjectDetailed({ title: payload.title || '', projectTitle: '', transcript: '' }, state.projects);
      let project = manualId ? state.projects.find(p => p.id === manualId) : null;
      if (!project && projectMapId) project = state.projects.find(p => p.id === projectMapId) || null;

      if (!project && source) {
        const existing = state.projects.find(p => p.id === source.projectId) || null;
        if (titleResolved && titleResolved.titleScore >= 110 && titleResolved.project.id !== existing?.id) project = titleResolved.project;
        else project = existing || resolved?.project || null;
      }
      if (!project) project = resolved?.project || null;

      if (!project) {
        state.discovered = state.discovered.filter(d => d.externalId !== key);
        state.discovered.unshift({
          id:safeId('disc'), externalId:key, type:'chatgpt_thread', title:payload.title || 'ChatGPT thread', url:payload.url,
          lastObservedAt:new Date().toISOString(), preview:(payload.transcript || '').slice(0,1200),
          chatgptProjectKey:payload.projectKey || null, chatgptProjectTitle:payload.projectTitle || null
        });
        saveState(state);
        return json(res, 202, { mapped:false, discovered:true });
      }

      if (payload.projectKey) {
        const existingMap = state.settings.chatgptProjectMappings[payload.projectKey];
        const strongEnough = manualId || projectMapId || source || (resolved && resolved.project.id === project.id && resolved.score >= 55);
        if (!existingMap && strongEnough) state.settings.chatgptProjectMappings[payload.projectKey] = project.id;
        else if (manualId) state.settings.chatgptProjectMappings[payload.projectKey] = project.id;
      }

      state.discovered = state.discovered.filter(d => d.externalId !== key);
      if (!source) {
        source = {
          id:safeId('src'), projectId:project.id, type:'chatgpt_thread', externalId:key, title:payload.title, url:payload.url,
          lastObservedAt:new Date().toISOString(), state:'SYNCED', chatgptProjectKey:payload.projectKey || null,
          chatgptProjectTitle:payload.projectTitle || null, chatgptProjectUrl:payload.projectUrl || null
        };
        state.sources.push(source);
      } else {
        source.projectId = project.id;
        source.title = payload.title;
        source.url = payload.url;
        source.lastObservedAt = new Date().toISOString();
        source.state = manualId ? 'MAPPED' : projectMapId ? 'AUTO-PROJECT' : 'SYNCED';
        source.chatgptProjectKey = payload.projectKey || source.chatgptProjectKey || null;
        source.chatgptProjectTitle = payload.projectTitle || source.chatgptProjectTitle || null;
        source.chatgptProjectUrl = payload.projectUrl || source.chatgptProjectUrl || null;
      }
      state.evidence = state.evidence.filter(e => !(e.sourceId === source.id && e.type === 'chat_sync'));
      const ev = extractChatEvidence(payload, project); ev.sourceId = source.id; state.evidence.push(ev);
      saveState(state);
      return json(res, 200, {
        mapped:true,
        projectId:project.id,
        mapping: projectMapId ? 'project-key' : manualId ? 'manual' : 'resolver',
        resolution: resolved ? { score:resolved.score, titleScore:resolved.titleScore, reason:resolved.reason } : null,
        derived:loadState().derived.find(d => d.projectId === project.id)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/remap') {
      if (!authorized(req)) return json(res, 401, { error:'Unauthorized' });
      const payload = await body(req); const state = loadState();
      const d = state.discovered.find(x => x.id === payload.discoveredId);
      const p = state.projects.find(x => x.id === payload.projectId);
      if (!d || !p) return json(res, 404, { error:'Source/project not found' });
      state.settings.manualMappings[d.externalId || d.url] = p.id;
      if (d.chatgptProjectKey) state.settings.chatgptProjectMappings[d.chatgptProjectKey] = p.id;
      state.sources.push({ id:safeId('src'), projectId:p.id, type:d.type, externalId:d.externalId, title:d.title, url:d.url, lastObservedAt:d.lastObservedAt, state:'MAPPED', chatgptProjectKey:d.chatgptProjectKey || null, chatgptProjectTitle:d.chatgptProjectTitle || null });
      state.discovered = state.discovered.filter(x => x.id !== d.id);
      saveState(state); return json(res, 200, { ok:true });
    }

    if (req.method === 'POST' && url.pathname === '/api/discovered/ignore') {
      if (!authorized(req)) return json(res, 401, { error:'Unauthorized' });
      const payload = await body(req); const state = loadState();
      state.discovered = state.discovered.filter(x => x.id !== payload.id); saveState(state); return json(res,200,{ok:true});
    }

    if (req.method === 'POST' && url.pathname === '/api/sync/github') {
      if (!authorized(req)) return json(res, 401, { error:'Unauthorized' });
      const payload = await body(req); const token = payload.token || process.env.GITHUB_TOKEN || '';
      const state = loadState(); const results = await syncGithub(state, token); return json(res,200,{ok:true, results, state:loadState()});
    }

    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    rel = path.normalize(rel).replace(/^([.][.][/\\])+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200, {'Content-Type':types[ext] || 'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(res);
  } catch (e) { json(res,500,{error:String(e.message || e)}); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`SHINO // CONTROL → http://127.0.0.1:${PORT}`));