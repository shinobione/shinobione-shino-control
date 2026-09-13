function clean(value = '') {
  return String(value || '').trim();
}

function timeMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

function keyFromUrl(value = '') {
  try {
    return new URL(value).pathname.match(/\/c\/([^/?#]+)/i)?.[1] || null;
  } catch {
    return null;
  }
}

function sourceConversationKey(source = {}) {
  return clean(source.externalId) || keyFromUrl(source.url || '') || null;
}

function canonicalThread(raw = {}) {
  const key = clean(raw.key || raw.conversationKey || raw.id || keyFromUrl(raw.url || ''));
  if (!key) return null;
  return {
    key,
    title:clean(raw.title || raw.name || 'ChatGPT conversation').slice(0, 180),
    url:clean(raw.url || '') || null,
    projectKey:clean(raw.projectKey || '') || null,
    projectTitle:clean(raw.projectTitle || '') || null,
    projectUrl:clean(raw.projectUrl || '') || null,
    updatedAt:clean(raw.updatedAt || raw.update_time || raw.updated_at || '') || null,
    createdAt:clean(raw.createdAt || raw.create_time || raw.created_at || '') || null
  };
}

function latestLocalTimestamp(state, source, key) {
  let latest = 0;
  const candidates = [
    source?.conversationUpdatedAt,
    source?.collectorObservedAt,
    source?.lastObservedAt
  ];
  for (const value of candidates) latest = Math.max(latest, timeMs(value));

  for (const evidence of state.evidence || []) {
    if (evidence.inventoryCurrent === false) continue;
    const matchesSource = source?.id && evidence.sourceId === source.id;
    const matchesKey = evidence.externalId === key || keyFromUrl(evidence.url || '') === key;
    if (!matchesSource && !matchesKey) continue;
    latest = Math.max(
      latest,
      timeMs(evidence.conversationUpdatedAt),
      timeMs(evidence.timestamp)
    );
  }
  return latest;
}

export function planChatgptCatchup(state, inventory = {}, options = {}) {
  const maxPlan = Math.max(1, Math.min(100, Number(options.maxPlan || 32)));
  const toleranceMs = Math.max(0, Number(options.toleranceMs ?? 1500));
  const rawThreads = Array.isArray(inventory.threads) ? inventory.threads.slice(0, 1000) : [];
  const byKey = new Map();

  for (const raw of rawThreads) {
    const thread = canonicalThread(raw);
    if (!thread) continue;
    const previous = byKey.get(thread.key);
    if (!previous || timeMs(thread.updatedAt) >= timeMs(previous.updatedAt)) byKey.set(thread.key, thread);
  }

  const sourcesByKey = new Map();
  for (const source of state.sources || []) {
    if (!['chatgpt_thread','chatgpt_archived'].includes(source.type)) continue;
    const key = sourceConversationKey(source);
    if (key && !sourcesByKey.has(key)) sourcesByKey.set(key, source);
  }

  const changed = [];
  let unchanged = 0;
  let remoteWithoutTimestamp = 0;
  let known = 0;
  let newlyDiscovered = 0;

  for (const thread of byKey.values()) {
    const source = sourcesByKey.get(thread.key) || null;
    if (source) known++;
    const remoteAt = timeMs(thread.updatedAt);
    const localAt = latestLocalTimestamp(state, source, thread.key);

    if (!source) {
      newlyDiscovered++;
      changed.push({...thread, reason:'new-conversation', localUpdatedAt:null});
      continue;
    }

    if (!remoteAt) {
      remoteWithoutTimestamp++;
      unchanged++;
      continue;
    }

    if (remoteAt > localAt + toleranceMs) {
      changed.push({
        ...thread,
        reason:'remote-newer',
        localUpdatedAt:localAt ? new Date(localAt).toISOString() : null
      });
    } else {
      unchanged++;
    }
  }

  changed.sort((a,b) => timeMs(b.updatedAt) - timeMs(a.updatedAt));
  const plan = changed.slice(0, maxPlan);

  return {
    ok:true,
    inventoryCount:byKey.size,
    known,
    unchanged,
    remoteWithoutTimestamp,
    changedCount:changed.length,
    newCount:newlyDiscovered,
    deferredCount:Math.max(0, changed.length - plan.length),
    plan
  };
}
