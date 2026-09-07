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
      const anchors = [...document.querySelectorAll(`[href*="/g/${projectKey}"]`)];
      const candidates = anchors
        .filter(a => !String(a.getAttribute('href') || '').includes('/c/'))
        .map(a => cleanText(a.innerText || a.textContent || a.getAttribute('aria-label') || ''))
        .filter(t => t && t.length <= 120 && !/^chatgpt$/i.test(t));
      const projectTitle = candidates[0] || null;
      const projectAnchor = anchors.find(a => !String(a.getAttribute('href') || '').includes('/c/'));
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

  function addProjectLinks(out) {
    for (const a of document.querySelectorAll('[href*="/g/g-p-"]')) {
      const href = a.href || a.getAttribute('href') || '';
      if (!href || /\/c\//.test(href)) continue;
      const m = href.match(/\/g\/(g-p-[^/?#]+)/i);
      if (!m) continue;
      const key = m[1];
      const title = cleanText(a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '');
      if (!title || title.length > 160 || /^projects?$/i.test(title)) continue;
      const absolute = new URL(href, location.origin).href;
      const prev = out.get(key);
      if (!prev || title.length < prev.title.length) out.set(key, { key, title, url: absolute });
    }
  }

  function discoverPinnedProjects() {
    const out = new Map();
    addProjectLinks(out);
    return [...out.values()];
  }

  function projectsPageUrl() {
    const anchors = [...document.querySelectorAll('a[href]')];
    const exact = anchors.find(a => /^projects$/i.test(cleanText(a.innerText || a.textContent || a.getAttribute('aria-label') || '')));
    if (exact?.href) return exact.href;
    const candidate = anchors.find(a => /projects/i.test(a.getAttribute('href') || '') && !/g-p-/i.test(a.getAttribute('href') || ''));
    return candidate?.href || `${location.origin}/projects`;
  }

  async function discoverAllProjects() {
    const out = new Map();
    let stableRounds = 0;
    let lastCount = -1;
    let lastHeight = -1;

    for (let i = 0; i < 40; i++) {
      addProjectLinks(out);
      const root = document.scrollingElement || document.documentElement;
      const height = Math.max(root.scrollHeight || 0, document.body?.scrollHeight || 0);
      const count = out.size;
      if (count === lastCount && height === lastHeight) stableRounds += 1;
      else stableRounds = 0;
      lastCount = count;
      lastHeight = height;
      if (stableRounds >= 4) break;
      window.scrollTo(0, height);
      await new Promise(resolve => setTimeout(resolve, 450));
    }

    addProjectLinks(out);
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
        const title = cleanText(a.innerText || a.textContent || a.getAttribute('aria-label') || '') || 'ChatGPT conversation';
        const key = conversationKey(href);
        if (!out.has(key)) out.set(key, { key, title: title.slice(0, 180), url: href, ...ctx });
      }
    }
    return [...out.values()].slice(0, 120);
  }

  async function capture(reason = 'auto', override = null) {
    const cfg = await chrome.storage.local.get({ enabled: false });
    if (!cfg.enabled) return { ok: false, error: 'SHINO Sync is OFF' };
    const transcript = extractTranscript();
    if (!transcript) {
      await chrome.storage.local.set({ lastStatus: 'Capture unavailable', lastError: 'No readable ChatGPT message DOM found.' });
      return { ok: false, error: 'Capture unavailable' };
    }
    const ctx = projectContext();
    const forced = override || {};
    const payload = {
      url: location.href,
      title: cleanTitle(),
      transcript,
      conversationKey: conversationKey(location.href),
      projectKey: forced.projectKey || ctx.projectKey,
      projectTitle: forced.projectTitle || ctx.projectTitle,
      projectUrl: forced.projectUrl || ctx.projectUrl,
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
      capture(msg.reason || 'manual', msg.projectContext || null).then(sendResponse);
      return true;
    }
    if (msg?.type === 'SHINO_DISCOVER_PINNED_PROJECTS') {
      sendResponse({ ok: true, projects: discoverPinnedProjects() });
      return;
    }
    if (msg?.type === 'SHINO_FIND_PROJECTS_PAGE') {
      sendResponse({ ok: true, url: projectsPageUrl() });
      return;
    }
    if (msg?.type === 'SHINO_DISCOVER_ALL_PROJECTS') {
      discoverAllProjects().then(projects => sendResponse({ ok: true, projects }));
      return true;
    }
    if (msg?.type === 'SHINO_DISCOVER_PROJECT_THREADS') {
      sendResponse({ ok: true, context: projectContext(), threads: discoverProjectThreads() });
      return;
    }
  });
})();
