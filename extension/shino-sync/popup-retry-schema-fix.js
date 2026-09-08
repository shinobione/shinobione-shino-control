// v0.6.1 — retry queue provenance guard.
// Failed-only retry is NOT the same thing as CONTROL's UNSYNCED state.
// This invalidates stale failed queues created by pre-main-anchor backfills and
// stamps new queues so Retry only replays failures from the current inventory strategy.

const SHINO_RETRY_SCHEMA = 'main-anchor-v1';

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
      ? 'No failed conversations from the latest main-anchor backfill.'
      : 'Old retry queue invalidated; run a fresh main-anchor backfill first.';
    return;
  }
  const summary = shinoRetryProjectSummary(list);
  retry.disabled = false;
  retry.textContent = `Retry ${list.length} failed only${summary ? ` · ${summary}` : ''}`;
  retry.title = 'Retries only conversations that actually failed during the latest compatible backfill. This does not target CONTROL projects merely marked UNSYNCED.';
}

// Invalidate any pre-v0.6.1 queue once. Extension storage survives version upgrades,
// which is why an old NaughtyShare failure could still appear after LRC Maker was UNSYNCED.
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
    await chrome.storage.local.set({ lastFailedBackfillSchema:SHINO_RETRY_SCHEMA });
  }
  await shinoRefreshRetryButton();
})().catch(() => {});

// Stamp all future failed queues created by the current main-anchor ingestion path.
if (typeof shinoIngestQueue === 'function') {
  const shinoIngestQueueBeforeRetrySchema = shinoIngestQueue;
  shinoIngestQueue = async function(...args) {
    const result = await shinoIngestQueueBeforeRetrySchema(...args);
    await chrome.storage.local.set({ lastFailedBackfillSchema:SHINO_RETRY_SCHEMA });
    await shinoRefreshRetryButton();
    return result;
  };
}
