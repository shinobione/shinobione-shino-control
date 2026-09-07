const POSITIVE = /(real user pass|physical pass|accepted|merged|complete\b|completed\b|stable|validated|success\b|green\b)/i;
const PENDING = /(needs? test|requires? live test|live test needed|physical (gate|validation|acceptance).*pending|pending.*physical|smoke pending|next\b|scope audit required|retest|test needed|validation pending)/i;
const BLOCKED = /(blocked|blocker|cannot proceed|waiting on|requires hardware|hardware test|physical validation pending)/i;
const SUPERSEDED = /(superseded|supersedes|do not merge|no longer authorized|rejected as unnecessary|no runtime integration authorized)/i;
const DONE = /(program closeout.*complete|phase\s*\d+.*complete|done\b|final closeout)/i;

function lowerEvidenceWeight(e) {
  const text = `${e.title || ''} ${e.summary || ''}`;
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

export function deriveProjectState(project, evidence) {
  const all = [...evidence]
    .filter(e => e.projectId === project.id)
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
  const combined = recentWindow.map(e => `${e.title || ''} ${e.summary || ''}`).join(' | ');
  const pendingCandidates = recentWindow.filter(e => !SUPERSEDED.test(`${e.title} ${e.summary}`) && PENDING.test(`${e.title} ${e.summary}`));
  const blockers = recentWindow.filter(e => !SUPERSEDED.test(`${e.title} ${e.summary}`) && BLOCKED.test(`${e.title} ${e.summary}`));
  const completed = recentWindow.filter(e => POSITIVE.test(`${e.title} ${e.summary}`));

  let status = 'ACTIVE';
  if (blockers.length) status = 'BLOCKED';
  else if (pendingCandidates.length) status = 'NEEDS TEST';
  else if (DONE.test(combined) || (completed.length && !pendingCandidates.length)) status = 'STABLE';

  const explicit = recentWindow.find(e => e.derivedStatusHint && !SUPERSEDED.test(`${e.title} ${e.summary}`));
  if (explicit) status = explicit.derivedStatusHint;

  const resume = recentWindow.find(e => e.resumeAction && !SUPERSEDED.test(`${e.title} ${e.summary}`));
  const summaryEvidence = recentWindow.find(e => e.currentStateSummary && !SUPERSEDED.test(`${e.title} ${e.summary}`)) || newest;
  const confidenceScore = Math.max(...recentWindow.map(lowerEvidenceWeight));
  const sourceKinds = new Set(recentWindow.map(e => e.sourceType));
  const confidence = confidenceScore >= 105 && sourceKinds.size >= 2 ? 'HIGH' : confidenceScore >= 90 ? 'MEDIUM' : 'LOW';

  return {
    projectId: project.id,
    status,
    summary: summaryEvidence.currentStateSummary || summaryEvidence.summary || summaryEvidence.title,
    lastMovementAt: newest.timestamp,
    nextAction: resume?.resumeAction || pendingCandidates[0]?.resumeAction || 'Review the newest evidence and choose the next safe action.',
    blocker: blockers[0]?.summary || null,
    confidence,
    freshness: freshness(newest.timestamp),
    evidenceIds: recentWindow.slice(0, 8).map(e => e.id)
  };
}

export function deriveAll(state) {
  state.derived = state.projects.map(project => deriveProjectState(project, state.evidence));
  state.derivedAt = new Date().toISOString();
  return state;
}
