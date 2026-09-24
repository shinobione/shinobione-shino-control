function safeIso(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function publicProject(project = {}) {
  const out = {
    id: project.id,
    name: project.name,
    universe: project.universe || 'PROJECT'
  };
  for (const key of ['kind', 'repo', 'radarHidden', 'trackState']) {
    if (project[key] !== undefined) out[key] = project[key];
  }
  const presentation = {
    archived:project.control?.archived === true,
    pinned:project.control?.pinned === true,
    group:typeof project.control?.group === 'string' && project.control.group.trim() ? project.control.group.trim() : null,
    tags:Array.isArray(project.control?.tags) ? project.control.tags.slice(0, 24) : [],
    order:Number.isFinite(Number(project.control?.order)) && Number(project.control.order) > 0 ? Number(project.control.order) : null
  };
  if (presentation.archived || presentation.pinned || presentation.group || presentation.tags.length || presentation.order !== null) {
    out.control = presentation;
  }
  return out;
}

function publicGithubSource(source = {}) {
  if (!['github_repo', 'github_component'].includes(source.type) || source.control?.archived === true || !source.projectId) return null;
  const out = {
    id: source.id,
    projectId: source.projectId,
    type: source.type,
    title: source.title || source.type,
    lastObservedAt: safeIso(source.lastObservedAt)
  };
  if (typeof source.url === 'string' && /^https:\/\/github\.com\//i.test(source.url)) out.url = source.url;
  for (const key of ['state', 'componentId']) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function latestCurrentChatByProject(state) {
  const result = new Map();
  for (const source of state.sources || []) {
    if (source.type !== 'chatgpt_thread' || source.inventoryCurrent === false || source.control?.archived === true || !source.projectId) continue;
    const ts = safeIso(source.conversationUpdatedAt || source.lastObservedAt);
    const current = result.get(source.projectId);
    if (!current || new Date(ts || 0) > new Date(current.ts || 0)) result.set(source.projectId, { ts });
  }
  return result;
}

function publicDerived(item = {}) {
  const out = {
    projectId: item.projectId,
    status: item.status,
    statusSource: item.statusSource || null,
    statusReason: item.statusReason || null,
    summary: item.summary,
    lastMovementAt: safeIso(item.lastMovementAt),
    nextAction: item.nextAction,
    blocker: item.blocker || null,
    confidence: item.confidence,
    freshness: item.freshness,
    evidenceIds: [`pub-${item.projectId}`]
  };
  if (item.resumeSource) out.resumeSource = item.resumeSource;
  return out;
}

export function buildPublicSnapshot(state, build = {}) {
  const latestChats = latestCurrentChatByProject(state);
  const projects = (state.projects || []).map(publicProject);
  const projectById = new Map(projects.map(project => [project.id, project]));
  const derived = (state.derived || []).map(publicDerived);
  const derivedById = new Map(derived.map(item => [item.projectId, item]));

  const githubSources = (state.sources || []).map(publicGithubSource).filter(Boolean);
  const chatSources = [];
  for (const [projectId, chat] of latestChats.entries()) {
    if (!projectById.has(projectId)) continue;
    chatSources.push({
      id: `pub-chat-${projectId}`,
      projectId,
      type: 'chatgpt_thread',
      title: 'ChatGPT project activity',
      lastObservedAt: chat.ts || derivedById.get(projectId)?.lastMovementAt || null,
      conversationUpdatedAt: chat.ts || derivedById.get(projectId)?.lastMovementAt || null,
      inventoryCurrent: true,
      state: 'PUBLIC-SNAPSHOT'
    });
  }

  const evidence = derived.map(item => {
    const project = projectById.get(item.projectId);
    return {
      id: `pub-${item.projectId}`,
      projectId: item.projectId,
      sourceType: 'public_snapshot',
      title: project ? `${project.name} — current snapshot` : 'Latest project activity',
      summary: 'Public dashboard snapshot.',
      timestamp: item.lastMovementAt,
      confidence: item.confidence === 'HIGH' ? 0.99 : item.confidence === 'MEDIUM' ? 0.95 : 0.8,
      inventoryCurrent: true
    };
  });

  const inventory = state.settings?.lastChatgptInventory || {};
  const version = String(build.version || state.settings?.controlBuild?.version || '').trim() || null;
  const sha = String(build.sha || state.settings?.controlBuild?.sha || '').trim().slice(0, 8) || null;
  const generatedAt = safeIso(build.generatedAt) || new Date().toISOString();

  return {
    version: state.version || 1,
    derivedAt: state.derivedAt || generatedAt,
    settings: {
      githubRepos: Array.isArray(state.settings?.githubRepos) ? [...state.settings.githubRepos] : [],
      lastChatgptInventory: {
        source: inventory.source || 'chatgpt-project-api',
        observedAt: safeIso(inventory.observedAt),
        projectCount: Number(inventory.projectCount || 0),
        conversationCount: Number(inventory.conversationCount || 0)
      },
      publicSnapshot: true,
      snapshotGeneratedAt: generatedAt,
      controlBuild: { version, sha }
    },
    projects,
    sources: [...githubSources, ...chatSources],
    evidence,
    derived,
    discovered: []
  };
}
