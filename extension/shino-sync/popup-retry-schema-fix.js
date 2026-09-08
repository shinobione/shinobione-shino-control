// v0.6.3 — retry queue provenance guard for the active-tab engine.
// Failed-only retry is NOT the same thing as CONTROL's UNSYNCED state.
// Old hidden/background-worker retry queues are invalidated on upgrade.

const SHINO_RETRY_SCHEMA = 'active-tab-v1';

function shinoRetryProjectSummary(list = []) {
  const names = [...new Set((list || []).map(item => item?.projectTitle).filter(Boolean))];
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0,2).join(' + ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
}

async function shinoRefreshRetryButton() {
  const retry = document.getElementById('retry');
  if (!retry) return;
  const stored = await chrome.storage.local.get({
    lastFailedBackfill:[],
    lastFailedBackfillSchema:''
  });
  const list = stored.lastFailedBackfill || [];
  const valid = stored.lastFailedBackfillSchema === SHINO_RETRY_SCHEMA;
  if (!valid || !list.length) {
    retry.disabled = true;
    retry.textContent = 'Retry failed only';
    retry.title = valid
      ? 'No failed conversations from the latest active-tab ingestion.'
      : 'Old retry queue invalidated; use the active-tab inventory/ingestion flow first.';
    return;
  }
  const summary = shinoRetryProjectSummary(list);
  retry.disabled = false;
  retry.textContent = `Retry ${list.length} failed only${summary ? ` · ${summary}` : ''}`;
  retry.title = 'Retries only conversations that failed during the latest compatible active-tab ingestion. CONTROL UNSYNCED state is separate.';
}

(async () => {
  const stored = await chrome.storage.local.get({
    lastFailedBackfill:[],
    lastFailedBackfillSchema:''
  });
  if ((stored.lastFailedBackfill || []).length && stored.lastFailedBackfillSchema !== SHINO_RETRY_SCHEMA) {
    await chrome.storage.local.set({
      lastFailedBackfill:[],
      lastFailedBackfillSchema:SHINO_RETRY_SCHEMA,
      staleRetryQueueClearedAt:Date.now()
    });
  } else if (!stored.lastFailedBackfillSchema) {
    await chrome.storage.local.set({lastFailedBackfillSchema:SHINO_RETRY_SCHEMA});
  }
  await shinoRefreshRetryButton();
})().catch(() => {});

// Keep legacy ingestion helpers schema-compatible if one is used manually.
if (typeof shinoIngestQueue === 'function') {
  const shinoIngestQueueBeforeRetrySchema = shinoIngestQueue;
  shinoIngestQueue = async function(...args) {
    const result = await shinoIngestQueueBeforeRetrySchema(...args);
    await chrome.storage.local.set({lastFailedBackfillSchema:SHINO_RETRY_SCHEMA});
    await shinoRefreshRetryButton();
    return result;
  };
}
