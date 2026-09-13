import { deriveChatSummary, deriveResume } from './resume-engine.mjs';
import { classifyEvidenceStatus, explicitStatusHint } from './status-engine.mjs';

const SUPERSEDED = /(superseded|supersedes|do not merge|no longer authorized|rejected as unnecessary|no runtime integration authorized)/i;
export const DERIVATION_ENGINE_VERSION = 2;

function textOf(e) {
  return `${e?.title || ''} ${e?.summary || ''}`.trim();
}

function lowerEvidenceWeight(e) {
  const text = textOf(e);
  let w = Number(e.confidence ?? 0.7) * 100;
  if (e.sourceType === 'github_truth') w += 25;
  if (e.sourceType === 'github_pr') w += 15;
  if (e.sourceType === 'github_commit') w += 10;
  if (e.sourceType === 'chatgpt_thread') w += 18;
  if (SUPERSEDED.test(text)) w -= 70;
  return w;
}

function freshness(ts) {
  const t = new Date(ts || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return 'UNKNOWN';
  const days = (Date.now() - t) / 86400000;
  if (days <= 3) return 'FRESH';
  if (days <= 14) return 'RECENT';
  if (days <= 60) return 'AGING';
  return 'STALE';
}

function summaryFor(e) {
  if (!e) return 'État non résumé.';
  if (e.sourceType === 'chatgpt_thread') return deriveChatSummary(e);
  return e.currentStateSummary || e.summary || e.title || 'État non résumé.';
}

function normalizedName(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function conversationKey(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(text)) return text.toLowerCase();
  try {
    return new URL(text).pathname.match(/\/c\/([^/?#]+)/i)?.[1]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

function canResumeFrom(e) {
  if (!e || SUPERSEDED.test(textOf(e))) return false;
  if (e.sourceType === 'chatgpt_thread') return true;
  return !!e.resumeAction;
}

function classifiedEntries(evidence) {
  return evidence
    .map(e => ({ evidence:e, classification:classifyEvidenceStatus(e) }))
    .filter(item => item.classification);
}

function hashString(value = '') {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function evidenceFingerprintShape(e = {}) {
  return {
    id: e.id || null,
    sourceId: e.sourceId || null,
    sourceType: e.sourceType || null,
    type: e.type || null,
    timestamp: e.timestamp || null,
    title: e.title || '',
    summary: e.summary || '',
    currentStateSummary: e.currentStateSummary || '',
    resumeAction: e.resumeAction || '',
    derivedStatusHint: e.derivedStatusHint || null,
    confidence: Number(e.confidence ?? 0.7),
    inventoryCurrent: e.inventoryCurrent !== false
  };
}

function projectDerivationFingerprint(project, projectEvidence, context) {
  const evidence = [...projectEvidence]
    .filter(e => e.inventoryCurrent !== false)
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
    .map(evidenceFingerprintShape);
  const latestTimestamp = evidence
    .map(e => e.timestamp)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const payload = {
    engine: DERIVATION_ENGINE_VERSION,
    project: {
      id: project.id,
      name: project.name,
      kind: project.kind || null,
      trackState: project.trackState !== false
    },
    context: {
      inventoryPresent: context.inventoryPresent === true,
      currentChatCount: Number(context.currentChatCount || 0),
      inventoryProof: context.inventoryProof || null
    },
    freshness: freshness(latestTimestamp),
    evidence
  };
  return hashString(JSON.stringify(payload));
}

export function deriveProjectState(project, evidence, context = {}) {
  const all = [...evidence]
    .filter(e => e.projectId === project.id && e.inventoryCurrent !== false)
    .sort((a,b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  const usable = all.filter(e => lowerEvidenceWeight(e) > 20);
  if (!usable.length) {
    const apiConfirmedEmpty = context.inventoryPresent === true && Number(context.currentChatCount || 0) === 0;
    if (apiConfirmedEmpty) {
      return {
        projectId: project.id,
        status: 'EMPTY',
        statusSource: 'inventory',
        statusEvidenceId: null,
        statusReason: 'ChatGPT inventory confirms that this mapped project currently has zero conversations.',
        summary: 'Projet ChatGPT confirmé par l’inventaire API, mais aucune conversation n’existe actuellement dans ce projet.',
        lastMovementAt: null,
        nextAction: `Créer la première conversation dans ${project.name} lorsqu’un vrai chantier doit y être suivi.`,
        resumeSource: 'empty_project',
        resumeEvidenceId: null,
        blocker: null,
        confidence: 'HIGH',
        freshness: 'UNKNOWN',
        evidenceIds: []
      };
    }
    return {
      projectId: project.id,
      status: 'UNSYNCED',
      statusSource: 'no_evidence',
      statusEvidenceId: null,
      statusReason: 'No usable current evidence exists for this project.',
      summary: 'No source evidence has been ingested for this project yet.',
      lastMovementAt: null,
      nextAction: 'Run ChatGPT project backfill and/or GitHub sync to reconstruct the real current state.',
      resumeSource: 'unsynced',
      resumeEvidenceId: null,
      blocker: null,
      confidence: 'NONE',
      freshness: 'UNKNOWN',
      evidenceIds: []
    };
  }

  const newest = usable[0];
  const recentWindow = usable.filter(e => {
    const age = new Date(newest.timestamp) - new Date(e.timestamp);
    return age <= 45 * 86400000;
  });

  const explicitChoice = recentWindow
    .map(e => ({ evidence:e, classification:explicitStatusHint(e) }))
    .find(item => item.classification);
  const classified = classifiedEntries(recentWindow);
  const statusChoice = explicitChoice || classified[0] || null;
  const status = statusChoice?.classification?.status || 'ACTIVE';

  const blockers = classified.filter(item => item.classification.status === 'BLOCKED').map(item => item.evidence);
  const pendingCandidates = classified.filter(item => item.classification.status === 'NEEDS TEST').map(item => item.evidence);

  const summaryEvidence = recentWindow.find(e =>
    !SUPERSEDED.test(textOf(e)) &&
    (e.currentStateSummary || e.summary || e.sourceType === 'chatgpt_thread')
  ) || newest;

  let resumeEvidence = null;
  if (status === 'BLOCKED') resumeEvidence = blockers[0] || statusChoice?.evidence;
  else if (status === 'NEEDS TEST') resumeEvidence = pendingCandidates[0] || statusChoice?.evidence;
  else resumeEvidence = recentWindow.find(canResumeFrom) || newest;

  const resume = deriveResume(project, resumeEvidence, 'Review the newest evidence and choose the next safe action.');
  const nextAction = status === 'STABLE' && resume.source === 'title_heuristic'
    ? 'Aucune action immédiate — état stable. Reprendre uniquement lorsqu’un nouveau chantier apparaît.'
    : resume.action;
  const confidenceScore = Math.max(...recentWindow.map(lowerEvidenceWeight));
  const sourceKinds = new Set(recentWindow.map(e => e.sourceType));
  const confidence = confidenceScore >= 105 && sourceKinds.size >= 2 ? 'HIGH' : confidenceScore >= 90 ? 'MEDIUM' : 'LOW';
  return {
    projectId: project.id,
    status,
    statusSource: statusChoice?.classification?.source || 'default_active',
    statusEvidenceId: statusChoice?.evidence?.id || null,
    statusReason: statusChoice?.classification?.reason || 'Recent usable evidence exists with no stronger status signal.',
    summary: summaryFor(summaryEvidence),
    lastMovementAt: newest.timestamp,
    nextAction,
    resumeSource: resume.source,
    resumeEvidenceId: resumeEvidence?.id || null,
    blocker: status === 'BLOCKED' ? (blockers[0]?.summary || blockers[0]?.title || null) : null,
    confidence,
    freshness: freshness(newest.timestamp),
    evidenceIds: recentWindow.slice(0, 8).map(e => e.id)
  };
}

function inventoryContextForProject(project, projectMappings, inventoryByKey, inventoryByName, currentChatCounts) {
  let inventoryProject = null;
  for (const [projectKey, projectId] of Object.entries(projectMappings)) {
    if (projectId !== project.id) continue;
    const hit = inventoryByKey.get(projectKey);
    if (hit) { inventoryProject = hit; break; }
  }
  if (!inventoryProject) {
    const exact = inventoryByName.get(normalizedName(project.name)) || [];
    if (exact.length === 1) inventoryProject = exact[0];
  }
  const inventoryPresent = !!inventoryProject;
  const currentChatCount = inventoryPresent
    ? Math.max(0, Number(inventoryProject.conversationCount ?? inventoryProject.total ?? 0) || 0)
    : (currentChatCounts.get(project.id) || 0);
  return { inventoryPresent, currentChatCount };
}

export function deriveAll(state, options = {}) {
  state.settings ||= {};
  state.sources ||= [];
  state.evidence ||= [];
  state.projects ||= [];
  state.derived ||= [];

  const projectMappings = state.settings.chatgptProjectMappings || {};
  const inventorySummary = state.settings.lastChatgptInventory || {};
  const inventoryProjects = Array.isArray(inventorySummary.projects) ? inventorySummary.projects : [];
  const inventoryByKey = new Map(inventoryProjects.filter(p => p?.key).map(p => [p.key, p]));
  const inventoryByName = new Map();
  for (const apiProject of inventoryProjects) {
    const key = normalizedName(apiProject?.title);
    if (!key) continue;
    const list = inventoryByName.get(key) || [];
    list.push(apiProject);
    inventoryByName.set(key, list);
  }

  const currentChatProjectKeys = new Set();
  const currentConversationKeys = new Set();
  const conversationKeysByProject = new Map();
  for (const source of state.sources) {
    if (source.type !== 'chatgpt_thread' || source.inventoryCurrent === false || !source.projectId) continue;
    const key = conversationKey(source.externalId) || conversationKey(source.url) || `source:${source.id}`;
    currentConversationKeys.add(key);
    if (source.chatgptProjectKey) currentChatProjectKeys.add(source.chatgptProjectKey);
    const perProject = conversationKeysByProject.get(source.projectId) || new Set();
    perProject.add(key);
    conversationKeysByProject.set(source.projectId, perProject);
  }
  const currentChatCounts = new Map(
    [...conversationKeysByProject.entries()].map(([projectId, keys]) => [projectId, keys.size])
  );

  const evidenceByProject = new Map();
  for (const evidence of state.evidence) {
    if (!evidence?.projectId) continue;
    const list = evidenceByProject.get(evidence.projectId) || [];
    list.push(evidence);
    evidenceByProject.set(evidence.projectId, list);
  }

  const visibleProjects = state.projects
    .filter(project => project.trackState !== false && project.kind !== 'CHATGPT_CONTAINER' && project.id !== 'shino-codes');
  const visibleIds = new Set(visibleProjects.map(project => project.id));
  const previousByProject = new Map((state.derived || []).filter(item => visibleIds.has(item?.projectId)).map(item => [item.projectId, item]));
  const previousCache = state.settings.derivationCache || {};
  const previousFingerprints = previousCache.fingerprints || {};
  const explicitDirty = new Set(Array.isArray(options.dirtyProjectIds) ? options.dirtyProjectIds.filter(Boolean) : []);
  const engineChanged = Number(previousCache.version || 0) !== DERIVATION_ENGINE_VERSION;
  const forceAll = options.force === true || engineChanged;
  const now = new Date().toISOString();
  const nextFingerprints = {};
  const recalculatedIds = [];
  const reusedIds = [];

  const apiProjectCount = Number(inventorySummary.projectCount);
  const apiConversationCount = Number(inventorySummary.conversationCount);
  const legacyConservationBase =
    inventoryProjects.length === 0 &&
    Number.isFinite(apiProjectCount) && apiProjectCount > 0 &&
    Number.isFinite(apiConversationCount) && apiConversationCount >= 0 &&
    currentConversationKeys.size >= apiConversationCount &&
    currentChatProjectKeys.size + 1 === apiProjectCount;
  let legacyEmptyProjectId = null;
  const cachedLegacyEmptyProjectId = previousCache.legacyEmptyProjectId || null;
  if (
    legacyConservationBase &&
    cachedLegacyEmptyProjectId &&
    visibleIds.has(cachedLegacyEmptyProjectId) &&
    !currentChatCounts.has(cachedLegacyEmptyProjectId)
  ) {
    legacyEmptyProjectId = cachedLegacyEmptyProjectId;
  }

  state.derived = visibleProjects.map(project => {
    let context = inventoryContextForProject(project, projectMappings, inventoryByKey, inventoryByName, currentChatCounts);
    if (legacyEmptyProjectId === project.id) {
      context = {
        inventoryPresent: true,
        currentChatCount: 0,
        inventoryProof: 'legacy-conservation-project-key-coverage'
      };
    }
    const projectEvidence = evidenceByProject.get(project.id) || [];
    const fingerprint = projectDerivationFingerprint(project, projectEvidence, context);
    nextFingerprints[project.id] = fingerprint;
    const previous = previousByProject.get(project.id);
    const dirty = forceAll || explicitDirty.has(project.id) || !previous || previousFingerprints[project.id] !== fingerprint;
    if (!dirty) {
      reusedIds.push(project.id);
      return previous;
    }
    recalculatedIds.push(project.id);
    return {
      ...deriveProjectState(project, projectEvidence, context),
      derivedAt: now
    };
  });

  // Legacy API snapshots may know only the global 17/131 totals rather than per-project rows.
  // Keep the conservation proof as a compatibility bridge. Once proven, persist the project id in
  // the private derivation cache so subsequent unchanged reads use the same fingerprint context.
  if (legacyConservationBase && !legacyEmptyProjectId) {
    const unsyncedStates = state.derived.filter(item => item.status === 'UNSYNCED');
    const unsyncedWithoutCurrentThreads = unsyncedStates.filter(item => !currentChatCounts.has(item.projectId));
    const conservationProvesSoleEmpty = unsyncedWithoutCurrentThreads.length === 1;

    if (conservationProvesSoleEmpty) {
      const stateItem = unsyncedWithoutCurrentThreads[0];
      const project = visibleProjects.find(p => p.id === stateItem.projectId);
      const index = state.derived.findIndex(item => item.projectId === stateItem.projectId);
      if (project && index >= 0) {
        const projectEvidence = evidenceByProject.get(project.id) || [];
        const proofContext = {
          inventoryPresent: true,
          currentChatCount: 0,
          inventoryProof: 'legacy-conservation-project-key-coverage'
        };
        state.derived[index] = {
          ...deriveProjectState(project, projectEvidence, proofContext),
          derivedAt: now
        };
        legacyEmptyProjectId = project.id;
        if (!recalculatedIds.includes(project.id)) recalculatedIds.push(project.id);
        const reusedIndex = reusedIds.indexOf(project.id);
        if (reusedIndex >= 0) reusedIds.splice(reusedIndex, 1);
        nextFingerprints[project.id] = projectDerivationFingerprint(project, projectEvidence, proofContext);
      }
    }
  }

  state.settings.derivationCache = {
    version: DERIVATION_ENGINE_VERSION,
    fingerprints: nextFingerprints,
    legacyEmptyProjectId
  };

  if (recalculatedIds.length) state.derivedAt = now;
  state.settings.lastDerivation = {
    at: recalculatedIds.length ? now : (state.settings.lastDerivation?.at || state.derivedAt || now),
    mode: forceAll ? 'full' : explicitDirty.size ? 'dirty' : 'fingerprint',
    recalculated: recalculatedIds.length,
    reused: reusedIds.length,
    projectIds: recalculatedIds
  };
  return state;
}
