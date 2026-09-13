const SUPERSEDED = /(superseded|supersedes|do not merge|no longer authorized|rejected as unnecessary|no runtime integration authorized)/i;
const BLOCKED = /\b(blocked|blocker|cannot proceed|can't proceed|stuck|waiting on|waiting for|requires? .{0,80} before|dependency missing|access missing)\b/i;
const RESOLVED_BLOCK = /\b(no longer|not|isn't|is not)\s+(?:blocked|stuck|waiting)|\bblocker\s+(?:cleared|resolved|removed)\b/i;
const TEST = /\b(needs? (?:a )?(?:live|physical|hardware|real user|smoke)?\s*test|retest|test needed|validation pending|needs? validation|verify|validate|run (?:the )?.{0,50}\btest|physical gate|live test|smoke test|compatibility test|acceptance test)\b/i;
const CLOSED = /\b(done|complete|completed|closed|merged|accepted|validated|resolved|fixed|working|works|shipped|green|passed|pass)\b/i;
const NO_REMAINING = /\b(no remaining work|nothing left|no further action|no action required|fully complete|closeout complete|finished)\b/i;
const OPEN = /\b(next|next step|todo|to-do|remaining|still needs?|needs? to|must|should|continue|implement|build|fix|update|create|finish|send|reply|compare|choose|review|audit|install|configure|calibrate|scan|sync|deploy|merge|open|run|launch)\b/i;
const GENERIC = /^(?:continue|resume) in the synced chatgpt thread\.?$|^chatgpt thread synced\.?$|^review the newest evidence and choose the next safe action\.?$/i;
const POSITIVE_GITHUB = /(real user pass|physical pass|accepted|merged|complete\b|completed\b|stable|validated|success\b|green\b)/i;
const PENDING_GITHUB = /(needs? test|requires? (?:a )?(?:live|physical|hardware)?\s*test|live test needed|physical (gate|validation|acceptance).*pending|pending.*physical|smoke pending|scope audit required|retest|test needed|validation pending|still needs? to\b|needs? to (?:be )?(?:load|run|verify|validate|test|pass|check)\b|physical gate\b|unresolved .*validation)/i;
const BLOCKED_GITHUB = /(blocked|blocker|cannot proceed|waiting on|requires hardware|hardware test|physical validation pending|unresolved gate|unresolved .*physical)/i;
const DONE_GITHUB = /(program closeout.*complete|phase\s*\d+.*complete|done\b|final closeout)/i;

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function textOf(e) {
  return `${e?.title || ''} ${e?.summary || ''}`.trim();
}

function usefulResume(value = '') {
  const text = clean(value);
  return !!text && !GENERIC.test(text) && text.length <= 700;
}

function unresolvedBlock(value = '') {
  const text = clean(value);
  return BLOCKED.test(text) && !RESOLVED_BLOCK.test(text);
}

export function explicitStatusHint(e) {
  if (!e || e.sourceType === 'chatgpt_thread') return null;
  if (e.derivedStatusHint === 'BLOCKED') return { status:'BLOCKED', source:'explicit_hint', reason:'Authoritative source explicitly marks the work blocked.' };
  if (e.derivedStatusHint === 'NEEDS TEST') return { status:'NEEDS TEST', source:'explicit_hint', reason:'Authoritative source explicitly requires validation/testing.' };
  if (e.derivedStatusHint === 'STABLE') return { status:'STABLE', source:'explicit_hint', reason:'Authoritative source explicitly marks the state stable.' };
  return null;
}

function classifyChat(e) {
  const resume = clean(e?.resumeAction);
  const current = clean(e?.currentStateSummary);
  const summary = clean(e?.summary);
  const title = clean(e?.title);
  const stateText = `${current} ${summary}`.trim();
  const full = `${resume} ${stateText} ${title}`.trim();
  if (!full || SUPERSEDED.test(full)) return null;

  // The explicit next action is the strongest signal for ChatGPT work. A completed sub-step does
  // not make a project STABLE when the same thread clearly says what still needs doing next.
  if (usefulResume(resume)) {
    if (unresolvedBlock(resume)) return { status:'BLOCKED', source:'chat_resume_action', reason:'The current ChatGPT resume action is blocked by an unresolved dependency.' };
    if (TEST.test(resume)) return { status:'NEEDS TEST', source:'chat_resume_action', reason:'The current ChatGPT resume action is a validation/test.' };
    return { status:'ACTIVE', source:'chat_resume_action', reason:'The current ChatGPT thread contains a concrete non-test next action.' };
  }

  if (unresolvedBlock(stateText)) return { status:'BLOCKED', source:'chat_state_summary', reason:'The current ChatGPT state summary contains an unresolved blocker.' };
  if (TEST.test(stateText) && !NO_REMAINING.test(stateText)) return { status:'NEEDS TEST', source:'chat_state_summary', reason:'The current ChatGPT state summary says validation/testing is still required.' };

  const hasOpenWork = OPEN.test(stateText);
  if ((NO_REMAINING.test(stateText) || CLOSED.test(stateText)) && !hasOpenWork) {
    return { status:'STABLE', source:'chat_state_summary', reason:'The current ChatGPT state is explicitly closed/validated with no open action detected.' };
  }

  return { status:'ACTIVE', source:'chat_activity', reason:'Recent ChatGPT activity exists and no explicit blocker, test gate, or closeout was detected.' };
}

function classifyGithubLike(e) {
  const full = textOf(e);
  const resume = clean(e?.resumeAction);
  if (!full || SUPERSEDED.test(full)) return null;
  const hint = explicitStatusHint(e);
  if (hint) return hint;

  // A source may describe a completed sub-step while also carrying the authoritative next action.
  // In that case the project is ACTIVE unless the next action itself is a blocker/test gate.
  if (usefulResume(resume)) {
    if (unresolvedBlock(resume)) return { status:'BLOCKED', source:'source_resume_action', reason:'The source resume action is blocked by an unresolved dependency.' };
    if (TEST.test(resume)) return { status:'NEEDS TEST', source:'source_resume_action', reason:'The source resume action is an explicit validation/test.' };
    return { status:'ACTIVE', source:'source_resume_action', reason:'The source contains a concrete next action after the current completed work.' };
  }

  if (BLOCKED_GITHUB.test(full) && !RESOLVED_BLOCK.test(full)) return { status:'BLOCKED', source:'source_text', reason:'Source text contains an unresolved blocker.' };
  if (PENDING_GITHUB.test(full)) return { status:'NEEDS TEST', source:'source_text', reason:'Source text contains an explicit pending validation/test signal.' };
  if (DONE_GITHUB.test(full) || POSITIVE_GITHUB.test(full)) return { status:'STABLE', source:'source_text', reason:'Source text contains an explicit accepted/complete signal.' };
  return null;
}

export function classifyEvidenceStatus(e) {
  if (!e || e.inventoryCurrent === false) return null;
  if (e.sourceType === 'chatgpt_thread') return classifyChat(e);
  return classifyGithubLike(e);
}

export function statusIs(e, status) {
  return classifyEvidenceStatus(e)?.status === status;
}
