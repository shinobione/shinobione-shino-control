const GENERIC_ACTION = /Continue in the synced ChatGPT thread|Review the newest evidence and choose the next safe action|Ouvrir la source la plus récente/i;
const NOISY_ACTION = /\b(USER|ASSISTANT):|powershell|ExecutionPolicy|PS [A-Z]:\\|```|\bSet-[A-Z]|\bGet-[A-Z]/i;
const EXTERNAL_WAIT = /\b(wait|waiting|await|awaiting|pending response|pending reply|attendre|attente|en attente|réponse attendue|reponse attendue|until)\b/i;

function actionableText(value = '') {
  const text = String(value || '').trim();
  return text && text.length <= 700 && !GENERIC_ACTION.test(text) && !NOISY_ACTION.test(text) ? text : '';
}

function freshnessBonus(freshness = '') {
  return ({FRESH:45, RECENT:32, AGING:8, STALE:-25, UNKNOWN:0})[String(freshness).toUpperCase()] ?? 0;
}

function confidenceBonus(confidence = '') {
  const value = String(confidence || '').toLowerCase();
  if (value.includes('high')) return 12;
  if (value.includes('medium')) return 5;
  return 0;
}

function recencyBonus(timestamp, now) {
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(time)) return 0;
  const days = Math.max(0, (now - time) / 86400000);
  if (days <= 1) return 30;
  if (days <= 3) return 24;
  if (days <= 7) return 18;
  if (days <= 14) return 10;
  if (days <= 30) return 4;
  return 0;
}

function scoreStatus(status, hasAction, waitsExternally) {
  switch (status) {
    case 'NEEDS TEST': return 620;
    case 'BLOCKED': return hasAction && !waitsExternally ? 570 : 300;
    case 'ACTIVE': return 510;
    case 'WAITING': return 220;
    case 'STABLE': return 90;
    default: return 0;
  }
}

function focusReason(status, hasAction, waitsExternally) {
  if (status === 'NEEDS TEST') return 'Un test ou une validation concrète est explicitement en attente.';
  if (status === 'BLOCKED' && hasAction && !waitsExternally) return 'Un blocage existe, mais CONTROL a une action concrète pour le lever.';
  if (status === 'ACTIVE' && hasAction) return 'Le projet est actif et possède une prochaine action exploitable maintenant.';
  if (status === 'ACTIVE') return 'Le projet est actif et fait partie des travaux les plus récents.';
  if (status === 'BLOCKED') return 'Le projet est bloqué, mais reste prioritaire à surveiller.';
  if (status === 'WAITING') return 'Le projet attend une suite et reste le meilleur candidat disponible.';
  return 'C’est le meilleur candidat disponible selon l’état actuel des preuves.';
}

function latestEvidenceFor(state, projectId) {
  return (state.evidence || [])
    .filter(item => item.projectId === projectId && item.inventoryCurrent !== false)
    .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))[0] || null;
}

export function selectFocusProject(state, now = Date.now()) {
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const derived = Array.isArray(state?.derived) ? state.derived : [];
  const byId = new Map(derived.map(item => [item.projectId, item]));
  const candidates = [];

  for (const project of projects) {
    if (project?.radarHidden) continue;
    const d = byId.get(project.id);
    if (!d || ['EMPTY','UNSYNCED','DONE'].includes(d.status)) continue;

    const action = actionableText(d.nextAction);
    const waitsExternally = EXTERNAL_WAIT.test(action || d.summary || '');
    const evidence = latestEvidenceFor(state, project.id);
    let score = scoreStatus(d.status, Boolean(action), waitsExternally);
    score += freshnessBonus(d.freshness);
    score += confidenceBonus(d.confidence);
    score += recencyBonus(d.lastMovementAt || evidence?.timestamp, now);
    if (action) score += 35;

    candidates.push({
      project,
      derived: d,
      evidence,
      action: action || '',
      waitsExternally,
      score,
      reason: focusReason(d.status, Boolean(action), waitsExternally)
    });
  }

  const actionable = candidates.filter(item => item.derived.status !== 'STABLE');
  const pool = actionable.length ? actionable : candidates;
  pool.sort((a, b) => b.score - a.score || Date.parse(b.derived.lastMovementAt || b.evidence?.timestamp || 0) - Date.parse(a.derived.lastMovementAt || a.evidence?.timestamp || 0));
  return pool[0] || null;
}
