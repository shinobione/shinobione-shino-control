import { deriveAll } from './derive.mjs';
import { resolveProjectDetailed } from './resolver.mjs';
import { resolveLiveChatgptProject } from './chatgpt-project-ownership.mjs';
import { CHATGPT_STATE_SCHEMA_VERSION, extractLatestChatState, semanticChatLines } from './chatgpt-tail-state.mjs';

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
  try { return new URL(payload.url || '').pathname.match(/\/c\/([^/?#]+)/i)?.[1] || null; }
  catch { return null; }
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
  const live = resolveLiveChatgptProject(state, payload);
  if (live?.project) return live;

  if (existingSource?.projectId) {
    const project = (state.projects || []).find(item => item.id === existingSource.projectId);
    if (project) return { project, reason:'existing conversation source', authoritative:false };
  }

  const resolved = resolveProjectDetailed(
    { title:payload.title || '', projectTitle:payload.projectTitle || '', transcript:transcriptOf(messages) },
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
    preview:semanticChatLines(messages).slice(-4).map(item => item.text).join(' · ').slice(-500),
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
  const stateSchemaCurrent = Number(existingSource?.chatgptStateSchemaVersion || 0) === CHATGPT_STATE_SCHEMA_VERSION;

  if (existingSource?.collectorFingerprint === fingerprint && resolved?.project?.id === existingSource.projectId && stateSchemaCurrent) {
    return {
      ok:true,
      changed:false,
      skipped:true,
      projectId:existingSource.projectId || null,
      conversationKey:key,
      reason:'fingerprint, ownership and state schema unchanged',
      derivation:null
    };
  }

  if (!resolved?.project) {
    const discovered = upsertDiscovered(state, payload, key, messages);
    return {ok:true, changed:true, mapped:false, discovered:true, discoveredId:discovered.id, conversationKey:key, derivation:null};
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
    collectorObservedAt:now,
    chatgptStateSchemaVersion:CHATGPT_STATE_SCHEMA_VERSION
  });
  if (!existingSource) state.sources.push(source);

  if (payload.projectKey && resolved.authoritative) state.settings.chatgptProjectMappings[payload.projectKey] = project.id;
  removeDiscovered(state, key);

  const extracted = extractLatestChatState(messages);
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
    collectorFingerprint:fingerprint,
    chatgptStateSchemaVersion:CHATGPT_STATE_SCHEMA_VERSION
  });
  if (!state.evidence.some(item => item.id === evidenceId)) state.evidence.push(evidence);

  const dirtyProjectIds = [...new Set([project.id, previousProjectId].filter(Boolean))];
  deriveAll(state, { dirtyProjectIds });
  state.settings.lastChatgptCollector = {
    at:now,
    projectId:project.id,
    previousProjectId:previousProjectId !== project.id ? previousProjectId : null,
    conversationKey:key,
    messageCount:Number(payload.messageCount || messages.length),
    reason:stateSchemaCurrent ? (resolved.reason || 'resolved') : 'latest-state-schema-upgrade'
  };

  return {
    ok:true,
    changed:true,
    mapped:true,
    ownershipChanged:Boolean(previousProjectId && previousProjectId !== project.id),
    stateSchemaUpgraded:!stateSchemaCurrent,
    previousProjectId:previousProjectId !== project.id ? previousProjectId : null,
    projectId:project.id,
    conversationKey:key,
    sourceId,
    evidenceId,
    reason:stateSchemaCurrent ? (resolved.reason || 'resolved') : 'latest-state-schema-upgrade',
    derivation:state.settings.lastDerivation || null
  };
}
