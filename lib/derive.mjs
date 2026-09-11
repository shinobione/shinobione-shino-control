const POSITIVE = /(real user pass|physical pass|accepted|merged|complete\b|completed\b|stable|validated|success\b|green\b)/i;
const PENDING = /(needs? test|requires? (?:a )?(?:live|physical|hardware)?\s*test|live test needed|physical (gate|validation|acceptance).*pending|pending.*physical|smoke pending|next\b|scope audit required|retest|test needed|validation pending|still needs? to\b|needs? to (?:be )?(?:load|run|verify|validate|test|pass|check)\b|physical gate\b|unresolved .*validation)/i;
const BLOCKED = /(blocked|blocker|cannot proceed|waiting on|requires hardware|hardware test|physical validation pending|unresolved gate|unresolved .*physical)/i;
const SUPERSEDED = /(superseded|supersedes|do not merge|no longer authorized|rejected as unnecessary|no runtime integration authorized)/i;
const DONE = /(program closeout.*complete|phase\s*\d+.*complete|done\b|final closeout)/i;

function textOf(e) {
  return `${e?.title || ''} ${e?.summary || ''}`.trim();
}

function statusText(e) {
  if (!e) return '';
  if (e.sourceType === 'chatgpt_thread') return String(e.title || '').trim();
  return textOf(e);
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

function explicitHint(e) {
  if (!e || e.sourceType === 'chatgpt_thread') return null;
  if (e.derivedStatusHint === 'BLOCKED') return 'BLOCKED';
  if (e.derivedStatusHint === 'NEEDS TEST') return 'NEEDS TEST';
  if (e.derivedStatusHint === 'STABLE') return 'STABLE';
  return null;
}

function statusSignal(e) {
  const full = textOf(e);
  const text = statusText(e);
  if (!text || SUPERSEDED.test(full)) return null;
  const hint = explicitHint(e);
  if (hint) return hint;
  if (BLOCKED.test(text)) return 'BLOCKED';
  if (PENDING.test(text)) return 'NEEDS TEST';
  if (DONE.test(text) || POSITIVE.test(text)) return 'STABLE';
  return null;
}

function chatSummary(e) {
  return `Dernière activité ChatGPT : ${e?.title || 'conversation sans titre'}.`;
}

function summaryFor(e) {
  if (!e) return 'État non résumé.';
  if (e.sourceType === 'chatgpt_thread') return chatSummary(e);
  return e.currentStateSummary || e.summary || e.title || 'État non résumé.';
}

function cleanTitle(value = '') {
  return String(value || 'la conversation').replace(/\s+/g, ' ').trim();
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

function chatResume(project, e) {
  const title = cleanTitle(e?.title);
  const low = title.toLowerCase();
  const projectName = project?.name || 'ce projet';
  if (/todo|to-do|roadmap|checklist|liste de tâches|liste de taches/.test(low)) {
    return `Reprendre la roadmap ${projectName} depuis « ${title} » et traiter le prochain élément ouvert.`;
  }
  if (/test|tester|validation|smoke|compatibilit|essai/.test(low)) {
    return `Reprendre « ${title} » et exécuter la prochaine validation encore ouverte.`;
  }
  if (/install|installation|setup|configur|pilote|driver/.test(low)) {
    return `Reprendre « ${title} » et poursuivre l’installation/configuration depuis le dernier point validé.`;
  }
  if (/bug|erreur|fail|ko\b|dépann|depann|probl[eè]me|fix|corrig/.test(low)) {
    return `Reprendre le diagnostic « ${title} » depuis le dernier constat confirmé.`;
  }
  if (/proposition|lyrics|cover|titre|soundcloud|spotify|suno|musique|music|canvas|canva/.test(low)) {
    return `Reprendre « ${title} » depuis le dernier choix créatif validé et poursuivre l’étape suivante.`;
  }
  if (project?.id === 'personnel') {
    return `Reprendre le sujet PERSONNEL « ${title} » et continuer depuis le dernier échange utile.`;
  }
  return `Reprendre « ${title} » et continuer depuis le dernier échange confirmé.`;
}

function resumeFor(project, e, fallback) {
  if (!e) return fallback;
  if (e.resumeAction && e.sourceType !== 'chatgpt_thread') return e.resumeAction;
  if (e.sourceType === 'chatgpt_thread') return chatResume(project, e);
  return fallback;
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
        summary: 'Projet ChatGPT confirmé par l’inventaire API, mais aucune conversation n’existe actuellement dans ce projet.',
        lastMovementAt: null,
        nextAction: `Créer la première conversation dans ${project.name} lorsqu’un vrai chantier doit y être suivi.`,
        blocker: null,
        confidence: 'HIGH',
        freshness: 'UNKNOWN',
        evidenceIds: []
      };
    }
    return {
      projectId: project.id,
      status: 'UNSYNCED',
      summary: 'No source evidence has been ingested for this project yet.',
      lastMovementAt: null,
      nextAction: 'Run ChatGPT project backfill and/or GitHub sync to reconstruct the real current state.',
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
  const hintedEvidence = recentWindow.find(e => explicitHint(e));
  const stateEvidence = hintedEvidence || recentWindow.find(e => statusSignal(e));
  const status = stateEvidence ? statusSignal(stateEvidence) : 'ACTIVE';
  const blockers = recentWindow.filter(e => statusSignal(e) === 'BLOCKED');
  const pendingCandidates = recentWindow.filter(e => statusSignal(e) === 'NEEDS TEST');
  const authoritativeSummary = recentWindow.find(e =>
    e.sourceType !== 'chatgpt_thread' &&
    e.currentStateSummary &&
    !SUPERSEDED.test(textOf(e))
  );
  const summaryEvidence = authoritativeSummary || newest;
  let resumeEvidence = null;
  if (status === 'BLOCKED') resumeEvidence = blockers[0] || stateEvidence;
  else if (status === 'NEEDS TEST') resumeEvidence = pendingCandidates[0] || stateEvidence;
  else resumeEvidence = recentWindow.find(e => e.resumeAction && e.sourceType !== 'chatgpt_thread' && !SUPERSEDED.test(textOf(e))) || newest;
  const confidenceScore = Math.max(...recentWindow.map(lowerEvidenceWeight));
  const sourceKinds = new Set(recentWindow.map(e => e.sourceType));
  const confidence = confidenceScore >= 105 && sourceKinds.size >= 2 ? 'HIGH' : confidenceScore >= 90 ? 'MEDIUM' : 'LOW';
  return {
    projectId: project.id,
    status,
    summary: summaryFor(summaryEvidence),
    lastMovementAt: newest.timestamp,
    nextAction: resumeFor(project, resumeEvidence, 'Review the newest evidence and choose the next safe action.'),
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
