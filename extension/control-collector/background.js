const DEFAULTS = {
  enabled: true,
  endpoint: 'http://127.0.0.1:4177/api/ingest/chatgpt-delta',
  token: ''
};

async function config() {
  return chrome.storage.local.get(DEFAULTS);
}

async function recordStatus(patch) {
  await chrome.storage.local.set({
    collectorLastObservedAt: new Date().toISOString(),
    ...patch
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({
    enabled: current.enabled ?? DEFAULTS.enabled,
    endpoint: current.endpoint || DEFAULTS.endpoint,
    token: current.token || ''
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CONTROL_COLLECT_DELTA') return;

  (async () => {
    try {
      const cfg = await config();
      if (!cfg.enabled) {
        await recordStatus({ collectorLastStatus:'disabled', collectorLastError:'' });
        return sendResponse({ ok:true, skipped:true, reason:'collector disabled' });
      }
      if (!cfg.endpoint) throw new Error('CONTROL Collector endpoint is not configured');

      const endpoint = new URL(cfg.endpoint);
      const response = await fetch(endpoint.href, {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          ...(cfg.token ? { Authorization:`Bearer ${cfg.token}` } : {})
        },
        body:JSON.stringify(message.payload || {})
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `CONTROL HTTP ${response.status}`);

      await recordStatus({
        collectorLastStatus: body.skipped ? 'unchanged' : body.mapped === false ? 'discovered' : 'synced',
        collectorLastError:'',
        collectorLastProjectId:body.projectId || null,
        collectorLastConversationKey:body.conversationKey || message.payload?.conversationKey || null
      });
      sendResponse({ ok:true, body });
    } catch (error) {
      const text = String(error?.message || error);
      await recordStatus({ collectorLastStatus:'error', collectorLastError:text });
      sendResponse({ ok:false, error:text });
    }
  })();

  return true;
});
