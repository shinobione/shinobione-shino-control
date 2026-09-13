import { deriveAll } from './derive.mjs';

function slug(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function cursorKey(project) {
  return `${project.repo}${project.repoPath ? `:${project.repoPath}` : ''}`;
}

function apiHeaders(token, etag = null, raw = false) {
  return {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'User-Agent': 'shino-control',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(etag ? { 'If-None-Match': etag } : {})
  };
}

async function conditionalJson(fetchImpl, url, token, etag = null) {
  const response = await fetchImpl(url, { headers: apiHeaders(token, etag, false) });
  const nextEtag = response.headers?.get?.('etag') || etag || null;
  if (response.status === 304) return { unchanged:true, etag:nextEtag, data:null, status:304 };
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return { unchanged:false, etag:nextEtag, data:await response.json(), status:response.status };
}

async function textFile(fetchImpl, repo, file, branch, token) {
  try {
    const clean = file.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${repo}/contents/${clean}?ref=${encodeURIComponent(branch)}`;
    const response = await fetchImpl(url, { headers: apiHeaders(token, null, true) });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function truthSummary(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(x => x.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const signals = lines.filter(l => /(NEXT|PASS|PENDING|BLOCKED|COMPLETE|ACCEPTED|DO NOT MERGE|SUPERSEDED|REAL USER|PHYSICAL|CURRENT|STATUS|VERSION)/i.test(l));
  return signals.slice(0, 12).join(' · ').slice(0, 2200) || lines.slice(0, 8).join(' · ').slice(0, 1600);
}

function replaceLiveEvidence(state, projectId, sourceTypes, rows) {
  const types = new Set(sourceTypes);
  state.evidence = (state.evidence || []).filter(e => !(e.projectId === projectId && e.liveSync === true && types.has(e.sourceType)));
  state.evidence.push(...rows);
}

function commitRows(project, commits = []) {
  return commits.slice(0, 5).map(c => ({
    id:`ghc-${slug(project.id)}-${String(c.sha || '').slice(0, 16)}`,
    projectId:project.id,
    sourceType:'github_commit',
    type:'commit',
    timestamp:c.commit?.committer?.date || c.commit?.author?.date || null,
    title:c.commit?.message?.split('\n')[0] || String(c.sha || '').slice(0, 7),
    summary:c.commit?.message || '',
    url:c.html_url || null,
    confidence:0.92,
    liveSync:true
  }));
}

function prRows(project, prs = []) {
  return prs.slice(0, 10).map(pr => {
    const text = `${pr.title || ''} ${pr.body || ''}`;
    const pending = /physical.*pending|live test|needs? test|smoke pending/i.test(text);
    return {
      id:`ghpr-${slug(project.id)}-${pr.number}`,
      projectId:project.id,
      sourceType:'github_pr',
      type:pr.merged_at ? 'merge' : 'pr',
      timestamp:pr.updated_at || pr.created_at || null,
      title:`PR #${pr.number} — ${pr.title || ''}${pr.merged_at ? ' — MERGED' : pr.draft ? ' — DRAFT' : ''}`,
      summary:(pr.body || '').slice(0, 2400),
      url:pr.html_url || null,
      confidence:0.97,
      liveSync:true,
      derivedStatusHint:pending ? 'NEEDS TEST' : undefined,
      resumeAction:pending ? `Review/test PR #${pr.number}: ${pr.title}` : undefined
    };
  });
}

function workflowRows(project, payload = {}) {
  const run = payload?.workflow_runs?.[0];
  if (!run) return [];
  return [{
    id:`ghci-${slug(project.id)}-${run.id}`,
    projectId:project.id,
    sourceType:'github_ci',
    type:'workflow',
    timestamp:run.updated_at || null,
    title:`Workflow: ${run.name || 'GitHub Actions'}`,
    summary:`${run.status || 'unknown'} / ${run.conclusion || 'pending'} on ${run.head_branch || 'unknown branch'}`,
    url:run.html_url || null,
    confidence:0.9,
    liveSync:true
  }];
}

async function truthRows(fetchImpl, project, branch, token, timestamp) {
  const candidates = project.repoPath ? [`${project.repoPath}/README.md`] : ['PROJECT_STATE.md','PROJECT-STATE.md','ROADMAP.md','README.md'];
  const rows = [];
  for (const file of candidates) {
    const text = await textFile(fetchImpl, project.repo, file, branch, token);
    const summary = truthSummary(text);
    if (!summary) continue;
    rows.push({
      id:`ght-${slug(project.id)}-${slug(file)}`,
      projectId:project.id,
      sourceType:'github_truth',
      type:'truth_file',
      timestamp:timestamp || new Date().toISOString(),
      title:`${file} truth snapshot`,
      summary,
      url:`https://github.com/${project.repo}/blob/${branch}/${file}`,
      confidence:0.99,
      liveSync:true
    });
  }
  return rows;
}

async function manifestRows(fetchImpl, state, project, branch, token, timestamp) {
  const rows = [];
  const manifests = [];
  if (project.repoPath) manifests.push({ id:project.id, name:project.name, path:`${project.repoPath}/manifest.json`, componentId:null });
  for (const component of project.components || []) {
    manifests.push({
      id:component.id,
      name:component.name,
      path:component.manifest || `${component.path}/manifest.json`,
      componentId:component.id,
      componentPath:component.path
    });
  }

  for (const item of manifests) {
    const text = await textFile(fetchImpl, project.repo, item.path, branch, token);
    if (!text) continue;
    try {
      const manifest = JSON.parse(text);
      rows.push({
        id:`ghmanifest-${slug(project.id)}-${slug(item.id)}`,
        projectId:project.id,
        sourceType:item.componentId ? 'github_component' : 'github_component',
        type:item.componentId ? 'component_manifest' : 'manifest',
        timestamp:timestamp || new Date().toISOString(),
        title:`${item.name || manifest.name || project.name} v${manifest.version || '?'}`,
        summary:manifest.description || `Browser extension manifest at ${item.path}`,
        url:`https://github.com/${project.repo}/blob/${branch}/${item.path}`,
        confidence:0.99,
        liveSync:true,
        componentId:item.componentId || undefined
      });
      if (item.componentId) {
        const source = (state.sources || []).find(s => s.projectId === project.id && s.type === 'github_component' && s.componentId === item.componentId);
        if (source) {
          source.lastObservedAt = new Date().toISOString();
          source.state = `v${manifest.version || '?'} · COMPONENT`;
          source.url = `https://github.com/${project.repo}/tree/${branch}/${item.componentPath}`;
        }
      }
    } catch {}
  }
  return rows;
}

function ensureRepoSource(state, project) {
  state.sources ||= [];
  let source = state.sources.find(s => s.projectId === project.id && s.type === 'github_repo');
  if (!source) {
    source = {
      id:`src-${slug(project.id)}-repo`,
      projectId:project.id,
      type:'github_repo',
      title:project.repo,
      url:project.repoPath ? `https://github.com/${project.repo}/tree/main/${project.repoPath}` : `https://github.com/${project.repo}`,
      lastObservedAt:null
    };
    state.sources.push(source);
  }
  source.lastObservedAt = new Date().toISOString();
  return source;
}

async function syncProject(state, project, token, fetchImpl) {
  state.settings.githubCursors ||= {};
  const key = cursorKey(project);
  const previous = state.settings.githubCursors[key] || {};
  const repoUrl = `https://api.github.com/repos/${project.repo}`;
  const metaResult = await conditionalJson(fetchImpl, repoUrl, token, previous.metaEtag || null);
  const meta = metaResult.data || {
    default_branch:previous.defaultBranch || 'main',
    pushed_at:previous.pushedAt || null
  };
  const branch = meta.default_branch || previous.defaultBranch || 'main';
  const pathQuery = project.repoPath ? `&path=${encodeURIComponent(project.repoPath)}` : '';

  const [commitsResult, prsResult, runsResult] = await Promise.all([
    conditionalJson(fetchImpl, `https://api.github.com/repos/${project.repo}/commits?per_page=8${pathQuery}`, token, previous.commitsEtag || null),
    project.repoPath
      ? Promise.resolve({ unchanged:true, etag:previous.prsEtag || null, data:null, status:304 })
      : conditionalJson(fetchImpl, `https://api.github.com/repos/${project.repo}/pulls?state=all&sort=updated&direction=desc&per_page=15`, token, previous.prsEtag || null),
    project.repoPath
      ? Promise.resolve({ unchanged:true, etag:previous.runsEtag || null, data:null, status:304 })
      : conditionalJson(fetchImpl, `https://api.github.com/repos/${project.repo}/actions/runs?per_page=8`, token, previous.runsEtag || null)
  ]);

  const changedKinds = [];
  if (!commitsResult.unchanged) {
    replaceLiveEvidence(state, project.id, ['github_commit'], commitRows(project, commitsResult.data || []));
    const timestamp = commitsResult.data?.[0]?.commit?.committer?.date || meta.pushed_at || new Date().toISOString();
    const truths = await truthRows(fetchImpl, project, branch, token, timestamp);
    replaceLiveEvidence(state, project.id, ['github_truth'], truths);
    const manifests = await manifestRows(fetchImpl, state, project, branch, token, timestamp);
    replaceLiveEvidence(state, project.id, ['github_component'], manifests);
    changedKinds.push('commits');
  }
  if (!prsResult.unchanged) {
    replaceLiveEvidence(state, project.id, ['github_pr'], prRows(project, prsResult.data || []));
    changedKinds.push('prs');
  }
  if (!runsResult.unchanged) {
    replaceLiveEvidence(state, project.id, ['github_ci'], workflowRows(project, runsResult.data || {}));
    changedKinds.push('workflows');
  }

  ensureRepoSource(state, project);
  state.settings.githubCursors[key] = {
    repo:project.repo,
    path:project.repoPath || null,
    defaultBranch:branch,
    pushedAt:meta.pushed_at || previous.pushedAt || null,
    metaEtag:metaResult.etag || null,
    commitsEtag:commitsResult.etag || null,
    prsEtag:prsResult.etag || null,
    runsEtag:runsResult.etag || null,
    headSha:commitsResult.data?.[0]?.sha || previous.headSha || null,
    latestPrUpdatedAt:prsResult.data?.[0]?.updated_at || previous.latestPrUpdatedAt || null,
    latestWorkflowUpdatedAt:runsResult.data?.workflow_runs?.[0]?.updated_at || previous.latestWorkflowUpdatedAt || null,
    observedAt:new Date().toISOString()
  };

  return {
    repo:project.repo,
    path:project.repoPath || null,
    projectId:project.id,
    ok:true,
    changed:changedKinds.length > 0,
    changedKinds,
    conditionalHits:[
      commitsResult.unchanged ? 'commits' : null,
      prsResult.unchanged && !project.repoPath ? 'prs' : null,
      runsResult.unchanged && !project.repoPath ? 'workflows' : null
    ].filter(Boolean)
  };
}

export async function syncGithubIncremental(state, token = '', options = {}) {
  state.settings ||= {};
  state.sources ||= [];
  state.evidence ||= [];
  state.settings.githubCursors ||= {};
  const fetchImpl = options.fetchImpl || fetch;
  const projects = (state.projects || []).filter(project => project.repo);

  const settled = await Promise.all(projects.map(async project => {
    try {
      return await syncProject(state, project, token, fetchImpl);
    } catch (error) {
      return {
        repo:project.repo,
        path:project.repoPath || null,
        projectId:project.id,
        ok:false,
        changed:false,
        changedKinds:[],
        error:String(error?.message || error)
      };
    }
  }));

  const dirtyProjectIds = [...new Set(settled.filter(result => result.ok && result.changed).map(result => result.projectId))];
  if (dirtyProjectIds.length) deriveAll(state, { dirtyProjectIds });

  state.settings.lastGithubSync = {
    at:new Date().toISOString(),
    mode:'incremental-etag',
    checked:projects.length,
    changed:dirtyProjectIds.length,
    unchanged:settled.filter(result => result.ok && !result.changed).length,
    failed:settled.filter(result => !result.ok).length,
    dirtyProjectIds
  };

  return {
    results:settled,
    dirtyProjectIds,
    derivation:dirtyProjectIds.length ? state.settings.lastDerivation || null : null,
    summary:state.settings.lastGithubSync
  };
}
