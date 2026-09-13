import { deriveChatSummary, deriveResume } from './resume-engine.mjs';
import { classifyEvidenceStatus, explicitStatusHint } from './status-engine.mjs';

const SUPERSEDED = /(superseded|supersedes|do not merge|no longer authorized|rejected as unnecessary|no runtime integration authorized)/i;

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

  // Explicit non-ChatGPT source hints remain authoritative gates. This protects real hardware/live
  // acceptance gates from being accidentally cleared by a newer generic chat. Otherwise the newest
  // content-aware classification wins, allowing ChatGPT-only projects to become ACTIVE/STABLE/
  // NEEDS TEST/BLOCKED from their actual synced state rather than their conversation title.
  const explicitChoice = recentWindow
    .map(e => ({ evidence:e, classification:explicitStatusHint(e) }))
    .find(item => item.classification);
  const classified = classifiedEntries(recentWindow);
  const statusChoice = explicitChoice || classified[0] || null;
  const status = statusChoice?.classification?.status || 'ACTIVE';

  const blockers = classified.filter(item => item.classification.status === 'BLOCKED').map(item => item.evidence);
  const pendingCandidates = classified.filter(item => item.classification.status === 'NEEDS TEST').map(item => item.evidence);

  // Summary follows the newest useful state evidence. This lets a freshly synced ChatGPT thread
  // supersede an older GitHub summary instead of freezing the card on stale repository context.
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

export function deriveAll(state) {
  state.settings ||= {};
  state.sources ||= [];
  state.evidence ||= [];
  state.projects ||= [];

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

  const visibleProjects = state.projects
    .filter(project => project.trackState !== false && project.kind !== 'CHATGPT_CONTAINER' && project.id !== 'shino-codes');

  state.derived = visibleProjects.map(project => {
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
    return deriveProjectState(project, state.evidence, { inventoryPresent, currentChatCount });
  });

  // Legacy v0.7.2 states know the authoritative API totals but not per-project rows. Raw source-row
  // counts are not reliable because old/manual rows can coexist with the 131 API conversations.
  // Project-key coverage is reliable: metadata reconciliation stamped each API conversation with its
  // owning project key. If current sources cover at least the API conversation total, span exactly
  // API-project-count minus one distinct project keys, and CONTROL has exactly one UNSYNCED project
  // with no current ChatGPT thread, that sole project is the zero-conversation API project.
  if (inventoryProjects.length === 0) {
    const apiProjectCount = Number(inventorySummary.projectCount);
    const apiConversationCount = Number(inventorySummary.conversationCount);
    const unsyncedStates = state.derived.filter(item => item.status === 'UNSYNCED');
    const unsyncedWithoutCurrentThreads = unsyncedStates.filter(item => !currentChatCounts.has(item.projectId));
    const conservationProvesSoleEmpty =
      Number.isFinite(apiProjectCount) && apiProjectCount > 0 &&
      Number.isFinite(apiConversationCount) && apiConversationCount >= 0 &&
      currentConversationKeys.size >= apiConversationCount &&
      currentChatProjectKeys.size + 1 === apiProjectCount &&
      unsyncedWithoutCurrentThreads.length === 1;

    if (conservationProvesSoleEmpty) {
      const stateItem = unsyncedWithoutCurrentThreads[0];
      const project = visibleProjects.find(p => p.id === stateItem.projectId);
      const index = state.derived.findIndex(item => item.projectId === stateItem.projectId);
      if (project && index >= 0) {
        state.derived[index] = deriveProjectState(project, state.evidence, {
          inventoryPresent: true,
          currentChatCount: 0,
          inventoryProof: 'legacy-conservation-project-key-coverage'
        });
      }
    }
  }

  state.derivedAt = new Date().toISOString();
  return state;
}
