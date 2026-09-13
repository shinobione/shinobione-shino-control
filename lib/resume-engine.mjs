const GENERIC = /^(?:continue|resume) in the synced chatgpt thread\.?$|^chatgpt thread synced\.?$|^review the newest evidence and choose the next safe action\.?$/i;
const NOISY = /```|powershell|executionpolicy|\bps [a-z]:\\|traceback|exception:|stack trace|\bget-[a-z]|\bset-[a-z]|project api count|active-tab|no_api_inventory_result/i;
const ACTION = /\b(next|todo|to-do|remaining|resume|retest|verify|validate|test|check|open|run|launch|fix|correct|continue|finish|complete|build|implement|wire|merge|deploy|send|reply|compare|choose|select|review|audit|wait|monitor|install|configure|calibrate|measure|try|retry|reproduce|confirm|create|write|update|remove|replace|add|move|connect|scan|sync)\b/i;
const OPEN_STATE = /\b(pending|blocked|remaining|still needs?|not done|not finished|waiting|next step|to do|todo|retest|required|needs? to|must|should)\b/i;
const CLOSED_ONLY = /^.*\b(done|complete|completed|merged|fixed|validated|working|works|shipped|green|pass(?:ed)?)\b[.!]?$/i;

function cleanText(value = '') {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/^\s*(?:USER|ASSISTANT|SYSTEM)\s*:\s*/i, '')
    .replace(/^\s*(?:NEXT|TODO|TO-DO|RESUME|ACTION)\s*[:—-]\s*/i, '')
    .replace(/^\s*[-*•]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUseful(value = '') {
  const text = cleanText(value);
  if (!text || text.length < 5 || text.length > 700) return false;
  if (GENERIC.test(text) || NOISY.test(text)) return false;
  if (/^https?:\/\/\S+$/i.test(text)) return false;
  return true;
}

function splitCandidates(value = '') {
  return String(value || '')
    .split(/\n+|\s+·\s+|(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý0-9])/)
    .map(cleanText)
    .filter(Boolean);
}

function actionScore(text = '') {
  let score = 0;
  if (ACTION.test(text)) score += 4;
  if (OPEN_STATE.test(text)) score += 3;
  if (/^(open|run|launch|verify|validate|test|check|fix|continue|finish|build|implement|deploy|send|compare|choose|review|audit|install|configure|create|update|remove|add|scan|sync)\b/i.test(text)) score += 3;
  if (/\b(next step|next|todo|to-do|remaining|resume)\b/i.test(text)) score += 4;
  if (CLOSED_ONLY.test(text) && !OPEN_STATE.test(text)) score -= 5;
  if (text.length > 360) score -= 2;
  return score;
}

function bestAction(value = '') {
  const parts = splitCandidates(value).filter(isUseful);
  if (!parts.length) return null;
  const ranked = parts
    .map((text, index) => ({ text, index, score: actionScore(text) }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  if (ranked[0]?.score > 0) return ranked[0].text;
  return null;
}

function titleFallback(project, evidence) {
  const title = cleanText(evidence?.title || 'la conversation');
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

function conciseAction(title, action) {
  const clean = cleanText(action).replace(/[.;]+$/, '');
  if (!clean) return null;
  return `Reprendre « ${cleanText(title)} » — ${clean}.`;
}

export function deriveChatSummary(evidence) {
  const values = [evidence?.currentStateSummary, evidence?.summary];
  for (const value of values) {
    if (!isUseful(value)) continue;
    const parts = splitCandidates(value).filter(isUseful);
    if (!parts.length) continue;
    const selected = parts.slice(-2).join(' · ');
    if (selected && !GENERIC.test(selected)) return selected.slice(0, 420);
  }
  return `Dernière activité ChatGPT : ${cleanText(evidence?.title || 'conversation sans titre')}.`;
}

export function deriveResume(project, evidence, fallback = 'Review the newest evidence and choose the next safe action.') {
  if (!evidence) return { action: fallback, source: 'fallback' };

  if (evidence.sourceType !== 'chatgpt_thread') {
    if (isUseful(evidence.resumeAction)) {
      return { action: cleanText(evidence.resumeAction), source: 'explicit_resume_action' };
    }
    return { action: fallback, source: 'fallback' };
  }

  const explicit = bestAction(evidence.resumeAction);
  if (explicit) {
    return {
      action: conciseAction(evidence.title || project?.name || 'la conversation', explicit),
      source: 'chat_resume_action'
    };
  }

  const stateAction = bestAction(evidence.currentStateSummary) || bestAction(evidence.summary);
  if (stateAction) {
    return {
      action: conciseAction(evidence.title || project?.name || 'la conversation', stateAction),
      source: 'chat_state_summary'
    };
  }

  return { action: titleFallback(project, evidence), source: 'title_heuristic' };
}

export function resumeTextIsUseful(value = '') {
  return isUseful(value);
}
