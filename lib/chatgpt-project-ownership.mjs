function norm(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function exactProjectByTitle(state, title) {
  const needle = norm(title);
  if (!needle) return null;
  const matches = (state.projects || []).filter(project => norm(project.name) === needle);
  return matches.length === 1 ? matches[0] : null;
}

export function resolveLiveChatgptProject(state, payload = {}) {
  const exact = exactProjectByTitle(state, payload.projectTitle);
  if (exact) return { project: exact, reason: 'live ChatGPT project title', authoritative: true };

  const mappedId = payload.projectKey && state.settings?.chatgptProjectMappings?.[payload.projectKey];
  if (mappedId) {
    const project = (state.projects || []).find(item => item.id === mappedId);
    if (project) return { project, reason: 'ChatGPT project-key mapping', authoritative: true };
  }

  return null;
}

export function repairChatgptProjectOwnership(state) {
  state.settings ||= {};
  state.settings.chatgptProjectMappings ||= {};
  state.sources ||= [];
  state.evidence ||= [];

  const repairedSourceIds = [];
  const affectedProjectIds = new Set();
  let mappingRepairs = 0;
  let evidenceRepairs = 0;

  for (const source of state.sources) {
    if (!['chatgpt_thread', 'chatgpt_archived'].includes(source.type)) continue;
    if (source.control?.assignment === 'MANUAL') continue;
    const project = exactProjectByTitle(state, source.chatgptProjectTitle);
    if (!project) continue;

    const previousProjectId = source.projectId || null;
    if (previousProjectId !== project.id) {
      source.projectId = project.id;
      repairedSourceIds.push(source.id);
      if (previousProjectId) affectedProjectIds.add(previousProjectId);
      affectedProjectIds.add(project.id);
    }

    // Evidence follows the authoritative conversation owner even when the source itself was already
    // repaired by a previous pass. This cleans older evidence rows left behind by historical mappings.
    for (const evidence of state.evidence) {
      if (evidence.sourceId !== source.id || evidence.projectId === project.id) continue;
      if (evidence.projectId) affectedProjectIds.add(evidence.projectId);
      affectedProjectIds.add(project.id);
      evidence.projectId = project.id;
      evidenceRepairs++;
    }

    if (source.chatgptProjectKey && state.settings.chatgptProjectMappings[source.chatgptProjectKey] !== project.id) {
      state.settings.chatgptProjectMappings[source.chatgptProjectKey] = project.id;
      mappingRepairs++;
    }
  }

  const changed = repairedSourceIds.length > 0 || mappingRepairs > 0 || evidenceRepairs > 0;
  if (changed) {
    state.settings.lastChatgptOwnershipRepair = {
      at: new Date().toISOString(),
      repairedSources: repairedSourceIds.length,
      repairedEvidence: evidenceRepairs,
      mappingRepairs,
      sourceIds: repairedSourceIds.slice(0, 50),
      projectIds: [...affectedProjectIds]
    };
  }

  return {
    changed,
    repairedSources: repairedSourceIds.length,
    repairedEvidence:evidenceRepairs,
    mappingRepairs,
    sourceIds: repairedSourceIds,
    projectIds: [...affectedProjectIds]
  };
}
