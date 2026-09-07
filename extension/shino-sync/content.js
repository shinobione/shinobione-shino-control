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

  function cleanText(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function cleanTitle() {
    return (document.title || 'ChatGPT conversation')
      .replace(/\s*[|–—-]\s*ChatGPT\s*$/i, '')
      .replace(/^ChatGPT\s*[|–—-]\s*/i, '')
      .trim();
  }

  function projectContext(url = location.href) {
    try {
      const u = new URL(url);
      const match = u.pathname.match(/\/g\/(g-p-[^/?#]+)/i);
      if (!match) return { projectKey: null, projectTitle: null, projectUrl: null };
      const projectKey = match[1];
      const candidates = [...document.querySelectorAll(`a[href*="/g/${projectKey}"]`)]
        .filter(a => !String(a.getAttribute('href') || '').includes('/c/'))
        .map(a => cleanText(a.innerText || a.textContent || ''))
        .filter(t => t && t.length <= 100 && !/^chatgpt$/i.test(t));
      const projectTitle = candidates[0] || null;
      const projectAnchor = [...document.querySelectorAll(`a[href*="/g/${projectKey}"]`)]
        .find(a => !String(a.getAttribute('href') || '').includes('/c/'));
      const projectUrl = projectAnchor?.href || `${u.origin}/g/${projectKey}`;
      return { projectKey, projectTitle, projectUrl };
    } catch { return { projectKey: null, projectTitle: null, projectUrl: null }; }
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

  function discoverPinnedProjects() {
    const out = new Map();
    for (const a of document.querySelectorAll('a[href*="/g/g-p-"]')) {
      const href = a.href || '';
      if (!href || /\/c\//.test(href)) continue;
      const m = href.match(/\/g\/(g-p-[^/?#]+)/i);
      if (!m) continue;
      const key = m[1];
      const title = cleanText(a.innerText || a.textContent || '');
      if (!title || title.length > 120) continue;
      const prev = out.get(key);
      if (!prev || title.length < prev.title.length) out.set(key, { key, title, url: href });
    }
    return [...out.values()];
  }

  function discoverProjectThreads() {
    const ctx = projectContext();
    const out = new Map();
    const selectors = ctx.projectKey
      ? [`a[href*="/g/${ctx.projectKey}/c/"]`, 'a[href*="/c/"]']
      : ['a[href*="/c/"]'];
    for (const selector of selectors) {
      for (const a of document.querySelectorAll(selector)) {
        const href = a.href || '';
        if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(href)) continue;
        if (ctx.projectKey && href.includes('/g/g-p-') && !href.includes(`/g/${ctx.projectKey}/`)) continue;
        const title = cleanText(a.innerText || a.textContent || '') || 'ChatGPT conversation';
        const key = conversationKey(href);
        if (!out.has(key)) out.set(key, { key, title: title.slice(0, 180), url: href, ...ctx });
      }
    }
    return [...out.values()].slice(0, 80);
  }

  async function capture(reason = 'auto') {
    const cfg = await chrome.storage.local.get({ enabled: false });
    if (!cfg.enabled) return { ok: false, error: 'SHINO Sync is OFF' };
    const transcript = extractTranscript();
    if (!transcript) {
      await chrome.storage.local.set({ lastStatus: 'Capture unavailable', lastError: 'No readable ChatGPT message DOM found.' });
      return { ok: false, error: 'Capture unavailable' };
    }
    const ctx = projectContext();
    const payload = {
      url: location.href,
      title: cleanTitle(),
      transcript,
      conversationKey: conversationKey(location.href),
      projectKey: ctx.projectKey,
      projectTitle: ctx.projectTitle,
      projectUrl: ctx.projectUrl,
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
    if (msg?.type === 'SHINO_DISCOVER_PINNED_PROJECTS') {
      sendResponse({ ok: true, projects: discoverPinnedProjects() });
      return;
    }
    if (msg?.type === 'SHINO_DISCOVER_PROJECT_THREADS') {
      sendResponse({ ok: true, context: projectContext(), threads: discoverProjectThreads() });
      return;
    }
  });
})();
