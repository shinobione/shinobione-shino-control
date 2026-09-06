async function settings() {
  return chrome.storage.local.get({
    enabled: false,
    endpoint: 'http://127.0.0.1:4177/api/ingest/chatgpt',
    token: ''
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'SHINO_POST') return;
  (async () => {
    try {
      const cfg = await settings();
      if (!cfg.enabled) throw new Error('SHINO Sync is OFF');
      if (!cfg.endpoint) throw new Error('No endpoint configured');
      const u = new URL(cfg.endpoint);
      const originPattern = `${u.protocol}//${u.host}/*`;
      const allowed = await chrome.permissions.contains({ origins: [originPattern] });
      if (!allowed && !['127.0.0.1','localhost'].includes(u.hostname)) throw new Error(`Permission required for ${u.origin}`);
      const r = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {})
        },
        body: JSON.stringify(msg.payload)
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      await chrome.storage.local.set({ lastStatus: `Synced ${new Date().toLocaleTimeString()}`, lastError: '' });
      sendResponse({ ok: true, body });
    } catch (e) {
      const error = String(e?.message || e);
      await chrome.storage.local.set({ lastStatus: 'Sync failed', lastError: error });
      sendResponse({ ok: false, error });
    }
  })();
  return true;
});
