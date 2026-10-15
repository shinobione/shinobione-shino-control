function safeIso(value) {
  if (typeof value !== 'string') return null;
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
const publicText = (value, fallback = null) => typeof value === 'string' ? value : fallback;

function publicProject(project = {}) {
  const out = {
    id: publicText(project.id),
    name: publicText(project.name),
    universe: publicText(project.universe, 'PROJECT')
  };
  for (const key of ['kind', 'repo', 'radarHidden', 'trackState']) {
    if (key === 'radarHidden' && typeof project[key] === 'boolean') out[key] = project[key];
    else if (key !== 'radarHidden' && typeof project[key] === 'string') out[key] = project[key];
  }
  const presentation = {
    archived:project.control?.archived === true,
    pinned:project.control?.pinned === true,
    group:typeof project.control?.group === 'string' && project.control.group.trim() ? project.control.group.trim() : null,
    tags:Array.isArray(project.control?.tags) ? project.control.tags.filter(tag=>typeof tag === 'string').slice(0, 24) : [],
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
    id: publicText(source.id),
    projectId: publicText(source.projectId),
    type: source.type,
    title: publicText(source.title, source.type),
    lastObservedAt: safeIso(source.lastObservedAt)
  };
  if (typeof source.url === 'string' && /^https:\/\/github\.com\//i.test(source.url)) out.url = source.url;
  for (const key of ['state', 'componentId']) {
    if (typeof source[key] === 'string') out[key] = source[key];
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
    projectId: publicText(item.projectId),
    status: publicText(item.status),
    statusSource: publicText(item.statusSource),
    statusReason: publicText(item.statusReason),
    summary: publicText(item.summary),
    lastMovementAt: safeIso(item.lastMovementAt),
    nextAction: publicText(item.nextAction),
    blocker: publicText(item.blocker),
    confidence: publicText(item.confidence),
    freshness: publicText(item.freshness),
    evidenceIds: [`pub-${item.projectId}`]
  };
  if (typeof item.resumeSource === 'string') out.resumeSource = item.resumeSource;
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
    version: Number.isSafeInteger(state.version) ? state.version : 1,
    derivedAt: safeIso(state.derivedAt) || generatedAt,
    settings: {
      githubRepos: Array.isArray(state.settings?.githubRepos) ? state.settings.githubRepos.filter(repo=>typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo)) : [],
      lastChatgptInventory: {
        source: publicText(inventory.source, 'chatgpt-project-api'),
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
