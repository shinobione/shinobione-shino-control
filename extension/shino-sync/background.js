async function settings() {
  return chrome.storage.local.get({
    enabled: false,
    endpoint: 'http://127.0.0.1:4177/api/ingest/chatgpt',
    token: ''
  });
}

function stableProjectId(value = '') {
  try {
    const path = /^https?:/i.test(String(value)) ? new URL(value).pathname : String(value);
    return path.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] ||
      String(value).match(/^(g-p-[0-9a-f]{32})(?:-.+)?$/i)?.[1] || null;
  } catch { return null; }
}

function canonicalPayload(payload = {}) {
  const stable = stableProjectId(payload.projectUrl) || stableProjectId(payload.url) || stableProjectId(payload.projectKey);
  return stable ? { ...payload, projectKey: stable } : payload;
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
        body: JSON.stringify(canonicalPayload(msg.payload))
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
