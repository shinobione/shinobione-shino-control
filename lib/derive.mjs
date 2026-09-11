const POSITIVE = /(real user pass|physical pass|accepted|merged|complete\b|completed\b|stable|validated|success\b|green\b)/i;
const PENDING = /(needs? test|requires? live test|live test needed|physical (gate|validation|acceptance).*pending|pending.*physical|smoke pending|next\b|scope audit required|retest|test needed|validation pending)/i;
const BLOCKED = /(blocked|blocker|cannot proceed|waiting on|requires hardware|hardware test|physical validation pending)/i;
const SUPERSEDED = /(superseded|supersedes|do not merge|no longer authorized|rejected as unnecessary|no runtime integration authorized)/i;
const DONE = /(program closeout.*complete|phase\s*\d+.*complete|done\b|final closeout)/i;

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

function statusSignal(e) {
  const text = textOf(e);
  if (!text || SUPERSEDED.test(text)) return null;
  // Trust explicit hard/terminal states, but deliberately ignore generic ACTIVE hints generated
  // from stray "pass/fixed/works" tokens inside old chat transcripts.
  if (e.derivedStatusHint === 'BLOCKED') return 'BLOCKED';
  if (e.derivedStatusHint === 'NEEDS TEST') return 'NEEDS TEST';
  if (e.derivedStatusHint === 'STABLE') return 'STABLE';
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

function resumeFor(e, fallback) {
  if (!e) return fallback;
  if (e.resumeAction && e.sourceType !== 'chatgpt_thread') return e.resumeAction;
  if (e.sourceType === 'chatgpt_thread') return `Reprendre « ${e.title || 'la conversation'} » dans ChatGPT.`;
  return fallback;
}

export function deriveProjectState(project, evidence) {
  const all = [...evidence]
    .filter(e => e.projectId === project.id && e.inventoryCurrent !== false)
    .sort((a,b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  const usable = all.filter(e => lowerEvidenceWeight(e) > 20);
  if (!usable.length) {
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

  // Temporal truth: the newest evidence carrying a state signal wins. An old blocker/test no
  // longer beats a newer pass/merge, and an old pass no longer masks a newer pending test.
  const stateEvidence = recentWindow.find(e => statusSignal(e));
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
    nextAction: resumeFor(resumeEvidence, 'Review the newest evidence and choose the next safe action.'),
    blocker: status === 'BLOCKED' ? (blockers[0]?.summary || blockers[0]?.title || null) : null,
    confidence,
    freshness: freshness(newest.timestamp),
    evidenceIds: recentWindow.slice(0, 8).map(e => e.id)
  };
}

export function deriveAll(state) {
  state.derived = state.projects
    .filter(project => project.trackState !== false && project.kind !== 'CHATGPT_CONTAINER' && project.id !== 'shino-codes')
    .map(project => deriveProjectState(project, state.evidence));
  state.derivedAt = new Date().toISOString();
  return state;
}
