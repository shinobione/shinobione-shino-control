function conversationKey(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(text)) return text.toLowerCase();
  try {
    return new URL(text).pathname.match(/\/c\/([^/?#]+)/i)?.[1]?.toLowerCase() || null;
  } catch { return null; }
}

function validIso(value) {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

export function applyChatgptInventoryMetadata(state, payload = {}) {
  state.settings ||= {};
  state.sources ||= [];
  state.evidence ||= [];

  const threads = Array.isArray(payload.threads) ? payload.threads : [];
  const now = new Date().toISOString();
  const currentIds = new Set();
  let refreshed = 0;
  let missing = 0;
  let restored = 0;

  for (const thread of threads) {
    const key = conversationKey(thread?.key) || conversationKey(thread?.url);
    if (!key) continue;
    currentIds.add(key);

    const source = state.sources.find(s => conversationKey(s.externalId) === key || conversationKey(s.url) === key);
    if (!source) { missing++; continue; }

    if (source.type === 'chatgpt_archived') {
      source.type = 'chatgpt_thread';
      restored++;
    }
    source.inventoryCurrent = true;
    source.inventoryObservedAt = now;
    source.state = source.state === 'ARCHIVED-INVENTORY' ? 'SYNCED' : (source.state || 'SYNCED');
    source.title = thread.title || source.title;
    source.url = thread.url || source.url;
    source.chatgptProjectKey = thread.projectKey || source.chatgptProjectKey || null;
    source.chatgptProjectTitle = thread.projectTitle || source.chatgptProjectTitle || null;
    source.chatgptProjectUrl = thread.projectUrl || source.chatgptProjectUrl || null;
    source.conversationUpdatedAt = validIso(thread.updatedAt) || source.conversationUpdatedAt || null;
    source.conversationCreatedAt = validIso(thread.createdAt) || source.conversationCreatedAt || null;

    for (const evidence of state.evidence.filter(e => e.sourceId === source.id && e.type === 'chat_sync')) {
      evidence.inventoryCurrent = true;
      evidence.conversationUpdatedAt = source.conversationUpdatedAt || evidence.conversationUpdatedAt || null;
      if (source.conversationUpdatedAt) evidence.timestamp = source.conversationUpdatedAt;
    }
    refreshed++;
  }

  let archived = 0;
  for (const source of state.sources) {
    if (source.type !== 'chatgpt_thread' && source.type !== 'chatgpt_archived') continue;
    const key = conversationKey(source.externalId) || conversationKey(source.url);
    const placeholder = !key && source.state === 'UNSYNCED';
    const projectScoped = !!source.chatgptProjectKey;
    const stale = (key && projectScoped && !currentIds.has(key)) || placeholder;
    if (!stale) continue;

    source.type = 'chatgpt_archived';
    source.inventoryCurrent = false;
    source.inventoryObservedAt = now;
    source.state = 'ARCHIVED-INVENTORY';
    for (const evidence of state.evidence.filter(e => e.sourceId === source.id && e.type === 'chat_sync')) evidence.inventoryCurrent = false;
    archived++;
  }

  state.settings.lastChatgptInventory = {
    source: payload.source || 'chatgpt-project-api',
    observedAt: now,
    projectCount: Number(payload.projectCount || 0),
    conversationCount: currentIds.size
  };

  return { refreshed, archived, restored, missing, current: currentIds.size };
}
