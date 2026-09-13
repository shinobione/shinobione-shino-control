import { deriveAll } from './derive.mjs';
import { resolveProjectDetailed } from './resolver.mjs';

function hashKey(value = '') {
  let h = 2166136261;
  for (const ch of String(value || '')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function norm(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value = '') {
  return String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
}

function conversationKey(payload = {}) {
  const explicit = String(payload.conversationKey || '').trim();
  if (explicit) return explicit;
  try {
    return new URL(payload.url || '').pathname.match(/\/c\/([^/?#]+)/i)?.[1] || null;
  } catch {
    return null;
  }
}

function canonicalMessages(payload = {}) {
  const source = Array.isArray(payload.messages) ? payload.messages : [];
  const out = [];
  let total = 0;
  for (const item of source.slice(-12)) {
    const role = String(item?.role || 'unknown').toLowerCase().slice(0, 32);
    const text = cleanText(item?.text || '').slice(0, 16000);
    if (!text) continue;
    total += text.length;
    if (total > 90000) break;
    out.push({ role, text });
  }
  return out;
}

function transcriptOf(messages = []) {
  return messages.map(message => `${message.role.toUpperCase()}: ${message.text}`).join('\n\n');
}

function isNoiseLine(value = '') {
  const text = cleanText(value);
  if (!text || text.length > 480) return true;
  if (/^```/.test(text) || /^`{3}$/.test(text) || /^powershell$/i.test(text)) return true;
  if (/^(?:PS\s+[A-Z]:\\|>>|>>>|\$[A-Za-z_]\w*\s*=|Write-Host\b|Get-\w+\b|Set-\w+\b|Where-Object\b|Sort-Object\b|Select-Object\b|Format-(?:List|Table)\b|Test-Path\b|Copy-Item\b|Set-Location\b|npm(?:\s|$)|node(?:\s|$)|git(?:\s|$)|cd\s+["']?[A-Z]:\\|chrome:\/\/)/i.test(text)) return true;
  if (/(?:ConvertFrom-Json|ForegroundColor|collectorFingerprint|Get-Content|Join-Path|Format-List|Where-Object|Sort-Object|Select-Object)/i.test(text)) return true;
  if ((text.match(/[{};$|]/g) || []).length >= 5) return true;
  return false;
}

function semanticLines(messages = []) {
  const out = [];
  for (const message of messages) {
    const role = String(message?.role || 'unknown').toLowerCase();
    for (const raw of String(message?.text || '').split(/\n+/)) {
      const text = cleanText(raw);
      if (isNoiseLine(text)) continue;
      out.push({ role, text });
    }
  }
  return out;
}

const SUMMARY_SIGNAL = /(pass|fail|merged|blocked|blocker|next|pending|test|validated|deployed|supersed|do not merge|resume|physical|synced|fixed|works|working|shipped|todo|remaining|complete|done|wait|verify|check|install|configure|build|implement|review|send|reply)/i;
const ACTION_SIGNAL = /(next|resume|retest|needs? test|pending|physical gate|live test|todo|remaining|needs? to|should|must|verify|validate|\btest\b|run|open|implement|build|fix|update|send|reply|review)/i;

function signalLines(messages = []) {
  return semanticLines(messages).filter(item => SUMMARY_SIGNAL.test(item.text));
}

function summarize(messages = []) {
  const semantic = semanticLines(messages);
  const signals = signalLines(messages);
  const summary = signals.slice(-5).map(item => `${item.role.toUpperCase()}: ${item.text}`).join(' · ').slice(0, 1800) ||
    semantic.slice(-4).map(item => `${item.role.toUpperCase()}: ${item.text}`).join(' · ').slice(0, 1800) ||
    'ChatGPT delta collected.';

  const reversed = [...signals].reverse();
  const explicit = reversed.find(item => item.role === 'assistant' && /^(?:NEXT|TODO|ACTION|RESUME)\s*[:—-]/i.test(item.text));
  const natural = reversed.find(item => item.role === 'assistant' && item.text.length <= 360 && ACTION_SIGNAL.test(item.text));
  const next = explicit || natural || null;

  return {
    summary,
    currentStateSummary:summary.slice(0, 700),
    resumeAction:(next?.text || '')
      .replace(/^\s*(?:NEXT|TODO|ACTION|RESUME)\s*[:—-]\s*/i, '')
      .slice(0, 700) || 'Continue in the synced ChatGPT thread.'
  };
}

function findExistingSource(state, key, url) {
  return (state.sources || []).find(source => {
    if (!['chatgpt_thread','chatgpt_archived'].includes(source.type)) return false;
    if (source.externalId && String(source.externalId) === key) return true;
    try {
      const sourceKey = new URL(source.url || '').pathname.match(/\/c\/([^/?#]+)/i)?.[1];
      if (sourceKey && sourceKey === key) return true;
    } catch {}
    return url && source.url === url;
  }) || null;
}

function exactProjectByTitle(state, title) {
  const needle = norm(title);
  if (!needle) return null;
  const matches = (state.projects || []).filter(project => norm(project.name) === needle);
  return matches.length === 1 ? matches[0] : null;
}

function resolveProject(state, payload, key, messages, existingSource) {
  if (existingSource?.projectId) {
    const project = (state.projects || []).find(item => item.id === existingSource.projectId);
    if (project) return { project, reason:'existing conversation source' };
  }

  const mappedId = payload.projectKey && state.settings?.chatgptProjectMappings?.[payload.projectKey];
  if (mappedId) {
    const project = (state.projects || []).find(item => item.id === mappedId);
    if (project) return { project, reason:'ChatGPT project-key mapping' };
  }

  const exact = exactProjectByTitle(state, payload.projectTitle);
  if (exact) return { project:exact, reason:'exact project title' };

  const transcript = transcriptOf(messages);
  const resolved = resolveProjectDetailed(
    { title:payload.title || '', projectTitle:payload.projectTitle || '', transcript },
    state.projects || [],
    state.settings?.manualMappings || {},
    key
  );
  return resolved ? { project:resolved.project, reason:resolved.reason, score:resolved.score } : null;
}

function upsertDiscovered(state, payload, key, messages) {
  state.discovered ||= [];
  const id = `discovered-chat-${hashKey(key)}`;
  const existing = state.discovered.find(item => item.id === id);
  const row = {
    id,
    type:'chatgpt_thread',
    title:payload.title || 'ChatGPT conversation',
    url:payload.url || null,
    preview:semanticLines(messages).slice(-4).map(item => item.text).join(' · ').slice(-500),
    observedAt:new Date().toISOString(),
    conversationKey:key,
    projectTitle:payload.projectTitle || null
  };
  if (existing) Object.assign(existing, row);
  else state.discovered.push(row);
  return row;
}

function removeDiscovered(state, key) {
  const id = `discovered-chat-${hashKey(key)}`;
  state.discovered = (state.discovered || []).filter(item => item.id !== id);
}

export function ingestChatgptDelta(state, payload = {}) {
  state.settings ||= {};
  state.settings.chatgptProjectMappings ||= {};
  state.projects ||= [];
  state.sources ||= [];
  state.evidence ||= [];
  state.discovered ||= [];

  const key = conversationKey(payload);
  if (!key) throw new Error('ChatGPT delta is missing a conversation key/URL');
  const messages = canonicalMessages(payload);
  if (!messages.length) throw new Error('ChatGPT delta contains no readable messages');

  const fingerprint = String(payload.fingerprint || hashKey(`${key}|${payload.messageCount || messages.length}|${transcriptOf(messages)}`));
  const existingSource = findExistingSource(state, key, payload.url || null);
  if (existingSource?.collectorFingerprint === fingerprint) {
    return {
      ok:true,
      changed:false,
      skipped:true,
      projectId:existingSource.projectId || null,
      conversationKey:key,
      reason:'fingerprint unchanged',
      derivation:null
    };
  }

  const resolved = resolveProject(state, payload, key, messages, existingSource);
  if (!resolved?.project) {
    const discovered = upsertDiscovered(state, payload, key, messages);
    return {
      ok:true,
      changed:true,
      mapped:false,
      discovered:true,
      discoveredId:discovered.id,
      conversationKey:key,
      derivation:null
    };
  }

  const project = resolved.project;
  const now = new Date().toISOString();
  const observedAt = payload.conversationUpdatedAt || payload.clientTimestamp || now;
  const sourceId = existingSource?.id || `src-chat-${hashKey(key)}`;
  const source = existingSource || { id:sourceId };
  Object.assign(source, {
    id:sourceId,
    projectId:project.id,
    type:'chatgpt_thread',
    title:payload.title || source.title || 'ChatGPT conversation',
    url:payload.url || source.url || null,
    externalId:key,
    state:'COLLECTED',
    inventoryCurrent:true,
    lastObservedAt:now,
    conversationUpdatedAt:observedAt,
    conversationCreatedAt:payload.conversationCreatedAt || source.conversationCreatedAt || null,
    chatgptProjectKey:payload.projectKey || source.chatgptProjectKey || null,
    chatgptProjectTitle:payload.projectTitle || source.chatgptProjectTitle || null,
    chatgptProjectUrl:payload.projectUrl || source.chatgptProjectUrl || null,
    collectorFingerprint:fingerprint,
    collectorMessageCount:Number(payload.messageCount || messages.length),
    collectorObservedAt:now
  });
  if (!existingSource) state.sources.push(source);
  if (payload.projectKey) state.settings.chatgptProjectMappings[payload.projectKey] = project.id;
  removeDiscovered(state, key);

  const extracted = summarize(messages);
  const evidenceId = `chat-current-${hashKey(key)}`;
  const evidence = state.evidence.find(item => item.id === evidenceId) || { id:evidenceId };
  Object.assign(evidence, {
    id:evidenceId,
    projectId:project.id,
    sourceId,
    sourceType:'chatgpt_thread',
    type:'chat_delta',
    timestamp:observedAt,
    title:payload.title || 'ChatGPT conversation',
    summary:extracted.summary,
    currentStateSummary:extracted.currentStateSummary,
    resumeAction:extracted.resumeAction,
    url:payload.url || null,
    confidence:0.9,
    inventoryCurrent:true,
    conversationUpdatedAt:observedAt,
    chatgptProjectKey:payload.projectKey || null,
    chatgptProjectTitle:payload.projectTitle || null,
    collectorFingerprint:fingerprint
  });
  if (!state.evidence.some(item => item.id === evidenceId)) state.evidence.push(evidence);

  deriveAll(state, { dirtyProjectIds:[project.id] });
  state.settings.lastChatgptCollector = {
    at:now,
    projectId:project.id,
    conversationKey:key,
    messageCount:Number(payload.messageCount || messages.length),
    reason:resolved.reason || 'resolved'
  };

  return {
    ok:true,
    changed:true,
    mapped:true,
    projectId:project.id,
    conversationKey:key,
    sourceId,
    evidenceId,
    reason:resolved.reason || 'resolved',
    derivation:state.settings.lastDerivation || null
  };
}
