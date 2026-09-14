import { deriveAll } from './derive.mjs';
import { resolveProjectDetailed } from './resolver.mjs';
import { resolveLiveChatgptProject } from './chatgpt-project-ownership.mjs';

function hashKey(value = '') {
  let h = 2166136261;
  for (const ch of String(value || '')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
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

function resolveProject(state, payload, key, messages, existingSource) {
  // Live ChatGPT project metadata is authoritative. Never let an old state.json source assignment
  // override the project that ChatGPT currently says owns this conversation.
  const live = resolveLiveChatgptProject(state, payload);
  if (live?.project) return live;

  if (existingSource?.projectId) {
    const project = (state.projects || []).find(item => item.id === existingSource.projectId);
    if (project) return { project, reason:'existing conversation source', authoritative:false };
  }

  const transcript = transcriptOf(messages);
  const resolved = resolveProjectDetailed(
    { title:payload.title || '', projectTitle:payload.projectTitle || '', transcript },
    state.projects || [],
    state.settings?.manualMappings || {},
    key
  );
  return resolved ? { project:resolved.project, reason:resolved.reason, score:resolved.score, authoritative:false } : null;
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
  const resolved = resolveProject(state, payload, key, messages, existingSource);

  // A matching fingerprint is a true no-op only when ownership is also unchanged. If live ChatGPT
  // metadata says this conversation belongs elsewhere, we must repair the source/evidence even if
  // its text did not change.
  if (existingSource?.collectorFingerprint === fingerprint && resolved?.project?.id === existingSource.projectId) {
    return {
      ok:true,
      changed:false,
      skipped:true,
      projectId:existingSource.projectId || null,
      conversationKey:key,
      reason:'fingerprint and project ownership unchanged',
      derivation:null
    };
  }

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
  const previousProjectId = existingSource?.projectId || null;
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

  // Learn/repair project-key mappings only from authoritative live project metadata, never from an
  // inherited source assignment or transcript guess.
  if (payload.projectKey && resolved.authoritative) {
    state.settings.chatgptProjectMappings[payload.projectKey] = project.id;
  }
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

  // When ownership changed, recalculate both projects: the destination gains the evidence and the
  // old project must immediately lose it from Status/Resume/Focus.
  const dirtyProjectIds = [...new Set([project.id, previousProjectId].filter(Boolean))];
  deriveAll(state, { dirtyProjectIds });
  state.settings.lastChatgptCollector = {
    at:now,
    projectId:project.id,
    previousProjectId:previousProjectId !== project.id ? previousProjectId : null,
    conversationKey:key,
    messageCount:Number(payload.messageCount || messages.length),
    reason:resolved.reason || 'resolved'
  };

  return {
    ok:true,
    changed:true,
    mapped:true,
    ownershipChanged:Boolean(previousProjectId && previousProjectId !== project.id),
    previousProjectId:previousProjectId !== project.id ? previousProjectId : null,
    projectId:project.id,
    conversationKey:key,
    sourceId,
    evidenceId,
    reason:resolved.reason || 'resolved',
    derivation:state.settings.lastDerivation || null
  };
}
