(() => {
  let debounceTimer = null;
  let lastFingerprint = '';

  function hashKey(value) {
    let h = 2166136261;
    for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return `url-${(h >>> 0).toString(16)}`;
  }

  function conversationKey(url) {
    try {
      const u = new URL(url);
      const cMatch = u.pathname.match(/\/c\/([^/?#]+)/);
      if (cMatch) return cMatch[1];
      for (const key of ['conversationId', 'conversation', 'chatId', 'chat', 'id']) {
        const v = u.searchParams.get(key);
        if (v && v.length >= 8) return v;
      }
      const uuidish = `${u.pathname}${u.search}`.match(/[0-9a-f]{8}-[0-9a-f-]{20,}/i);
      if (uuidish) return uuidish[0];
      return hashKey(`${u.origin}${u.pathname}${u.search}`);
    } catch { return `unknown-${Date.now()}`; }
  }

  function cleanTitle() {
    return (document.title || 'ChatGPT conversation')
      .replace(/\s*[|–—-]\s*ChatGPT\s*$/i, '')
      .replace(/^ChatGPT\s*[|–—-]\s*/i, '')
      .trim();
  }

  function extractTranscript() {
    const messages = [...document.querySelectorAll('[data-message-author-role]')];
    if (messages.length) {
      return messages.map(el => {
        const role = el.getAttribute('data-message-author-role') || 'unknown';
        const text = (el.innerText || el.textContent || '').trim();
        return text ? `${role.toUpperCase()}: ${text}` : '';
      }).filter(Boolean).join('\n\n').slice(-1_000_000);
    }

    const fallback = [...document.querySelectorAll('main article')];
    if (fallback.length) {
      return fallback.map((el, i) => `MESSAGE ${i + 1}: ${(el.innerText || el.textContent || '').trim()}`)
        .filter(x => x.length > 14).join('\n\n').slice(-1_000_000);
    }
    return '';
  }

  async function capture(reason = 'auto') {
    const cfg = await chrome.storage.local.get({ enabled: false });
    if (!cfg.enabled) return { ok: false, error: 'SHINO Sync is OFF' };
    const transcript = extractTranscript();
    if (!transcript) {
      await chrome.storage.local.set({ lastStatus: 'Capture unavailable', lastError: 'No readable ChatGPT message DOM found.' });
      return { ok: false, error: 'Capture unavailable' };
    }
    const payload = {
      url: location.href,
      title: cleanTitle(),
      transcript,
      conversationKey: conversationKey(location.href),
      clientTimestamp: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      reason
    };
    const fingerprint = `${payload.url}|${transcript.length}|${transcript.slice(-180)}`;
    if (reason === 'auto' && fingerprint === lastFingerprint) return { ok: true, skipped: true };
    lastFingerprint = fingerprint;
    return chrome.runtime.sendMessage({ type: 'SHINO_POST', payload });
  }

  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => capture('auto'), 3500);
  }

  const observer = new MutationObserver(() => schedule());
  const start = () => {
    const main = document.querySelector('main') || document.body;
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'SHINO_CAPTURE_NOW') {
      capture(msg.reason || 'manual').then(sendResponse);
      return true;
    }
  });
})();
