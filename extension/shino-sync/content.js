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

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function looksLikeDateOrUi(text) {
    const t = cleanText(text);
    if (!t || t.length < 2 || t.length > 160) return true;
    if (/^(projects?|search projects|new|all|created by you|shared with you|name|modified|today|yesterday)$/i.test(t)) return true;
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}$/i.test(t)) return true;
    if (/^\d{1,2}[:/]\d{1,2}([/:]\d{1,4})?$/i.test(t)) return true;
    if (/^(new chat|library|scheduled|plugins|more|pinned|recents)$/i.test(t)) return true;
    return false;
  }

  function collectVisibleLabels(root, { exclude = [] } = {}) {
    const ignored = new Set(exclude.map(x => cleanText(x).toLowerCase()).filter(Boolean));
    const best = new Map();
    const nodes = root.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],span,p,div');
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const text = cleanText(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (looksLikeDateOrUi(text) || ignored.has(text.toLowerCase())) continue;
      if (/\b(today|yesterday)\b/i.test(text) && text.split(/\s+/).length > 1) continue;
      if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i.test(text) && text.split(/\s+/).length > 2) continue;
      const childText = [...el.children].map(c => cleanText(c.innerText || c.textContent || '')).filter(Boolean);
      const nestedExact = childText.some(t => t === text);
      const score = (nestedExact ? 50 : 0) + el.children.length * 5 + text.length / 1000;
      const key = text.toLowerCase();
      const prev = best.get(key);
      if (!prev || score < prev.score) best.set(key, { title: text, score });
    }
    return [...best.values()].sort((a, b) => a.score - b.score).map(x => ({ title: x.title }));
  }

  async function discoverProjectLabels() {
    let stableRounds = 0;
    let lastCount = -1;
    let lastHeight = -1;
    const labels = new Map();

    for (let i = 0; i < 40; i++) {
      const main = document.querySelector('main') || document.body;
      for (const item of collectVisibleLabels(main)) labels.set(item.title.toLowerCase(), item);
      const root = document.scrollingElement || document.documentElement;
      const height = Math.max(root.scrollHeight || 0, document.body?.scrollHeight || 0);
      if (labels.size === lastCount && height === lastHeight) stableRounds += 1;
      else stableRounds = 0;
      lastCount = labels.size;
      lastHeight = height;
      if (stableRounds >= 4) break;
      window.scrollTo(0, height);
      await new Promise(resolve => setTimeout(resolve, 450));
    }

    return [...labels.values()].slice(0, 120);
  }

  function clickVisibleLabel(title) {
    const target = cleanText(title).toLowerCase();
    const root = document.querySelector('main') || document.body;
    const matches = [...root.querySelectorAll('*')]
      .filter(el => isVisible(el) && cleanText(el.innerText || el.textContent || el.getAttribute('aria-label') || '')?.toLowerCase() === target)
      .sort((a, b) => {
        const ac = a.querySelectorAll('*').length;
        const bc = b.querySelectorAll('*').length;
        if (ac !== bc) return ac - bc;
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });
    const el = matches[0];
    if (!el) return { ok: false, clicked: false, error: `Visible label not found: ${title}` };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.click();
    return { ok: true, clicked: true, title };
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

  function discoverThreadLabels() {
    const ctx = projectContext();
    const main = document.querySelector('main') || document.body;
    const exclude = [ctx.projectTitle, 'Files', 'Instructions', 'Project instructions', 'Add files', 'New chat'];
    return collectVisibleLabels(main, { exclude }).slice(0, 120);
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
    if (msg?.type === 'SHINO_DISCOVER_PROJECT_LABELS') {
      discoverProjectLabels().then(labels => sendResponse({ ok: true, labels }));
      return true;
    }
    if (msg?.type === 'SHINO_CLICK_PROJECT_LABEL') {
      sendResponse(clickVisibleLabel(msg.title || ''));
      return;
    }
    if (msg?.type === 'SHINO_DISCOVER_PROJECT_THREADS') {
      sendResponse({ ok: true, context: projectContext(), threads: discoverProjectThreads() });
      return;
    }
    if (msg?.type === 'SHINO_DISCOVER_THREAD_LABELS') {
      sendResponse({ ok: true, context: projectContext(), labels: discoverThreadLabels() });
      return;
    }
    if (msg?.type === 'SHINO_CLICK_THREAD_LABEL') {
      sendResponse(clickVisibleLabel(msg.title || ''));
      return;
    }
  });
})();
