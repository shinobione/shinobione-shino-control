(() => {
  let debounceTimer = null;
  let lastFingerprint = '';
  let lastLocation = location.href;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  function elementText(el) {
    return cleanText(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
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
        .map(elementText)
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

  async function waitForTranscript(timeoutMs = 18000) {
    const start = Date.now();
    let best = '';
    while (Date.now() - start < timeoutMs) {
      const transcript = extractTranscript();
      if (transcript.length > best.length) best = transcript;
      if (transcript.length >= 80) return transcript;
      await sleep(400);
    }
    return best;
  }

  function addProjectLinks(out) {
    for (const a of document.querySelectorAll('[href*="/g/g-p-"]')) {
      const href = a.href || a.getAttribute('href') || '';
      if (!href || /\/c\//.test(href)) continue;
      const m = href.match(/\/g\/(g-p-[^/?#]+)/i);
      if (!m) continue;
      const key = m[1];
      const title = elementText(a);
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
    const exact = anchors.find(a => /^projects$/i.test(elementText(a)));
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
      await sleep(450);
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

  function hasDateToken(text = '') {
    const t = cleanText(text);
    return /\b(today|yesterday)\b/i.test(t) ||
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/i.test(t) ||
      /\b\d{1,2}\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(t);
  }

  function looksLikeUi(text) {
    const t = cleanText(text);
    if (!t || t.length < 2 || t.length > 140) return true;
    if (/^(projects?|search projects|new|all|created by you|shared with you|name|modified|today|yesterday)$/i.test(t)) return true;
    if (/^(new chat|library|scheduled|plugins|more|pinned|recents)$/i.test(t)) return true;
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}$/i.test(t)) return true;
    if (/^\d{1,2}[:/]\d{1,2}([/:]\d{1,4})?$/i.test(t)) return true;
    return false;
  }

  function findProjectRowForLabel(el, title) {
    const target = cleanText(title).toLowerCase();
    let cur = el;
    for (let i = 0; cur && i < 8; i++, cur = cur.parentElement) {
      const txt = elementText(cur);
      if (!txt || txt.length > 300) continue;
      if (txt.toLowerCase().includes(target) && hasDateToken(txt)) return cur;
    }
    return null;
  }

  function clickableAncestor(el, limit = 8) {
    let cur = el;
    for (let i = 0; cur && i < limit; i++, cur = cur.parentElement) {
      const role = String(cur.getAttribute?.('role') || '').toLowerCase();
      const tag = String(cur.tagName || '').toLowerCase();
      const tabIndex = Number(cur.getAttribute?.('tabindex'));
      const cursor = getComputedStyle(cur).cursor;
      if (tag === 'a' || tag === 'button' || role === 'button' || role === 'link' || cursor === 'pointer' || Number.isFinite(tabIndex) && tabIndex >= 0 || typeof cur.onclick === 'function') return cur;
    }
    return el;
  }

  function projectLabelCandidates() {
    const main = document.querySelector('main') || document.body;
    const best = new Map();
    const nodes = [...main.querySelectorAll('span,p,div,button,[role="button"],[role="link"],[tabindex]')];

    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const title = elementText(el);
      if (looksLikeUi(title) || hasDateToken(title)) continue;
      if (title.includes('\n') || title.length > 120) continue;

      const row = findProjectRowForLabel(el, title);
      if (!row) continue;

      const rowText = elementText(row);
      if (rowText.length > 260) continue;
      const clickable = clickableAncestor(row);
      const rect = el.getBoundingClientRect();
      const score = (clickable === row ? 0 : 10) + el.querySelectorAll('*').length * 3 + Math.max(0, rect.width - 300) / 100;
      const key = title.toLowerCase();
      const prev = best.get(key);
      if (!prev || score < prev.score) best.set(key, { title, score });
    }

    return [...best.values()].sort((a, b) => a.score - b.score).map(({ title }) => ({ title }));
  }

  async function discoverProjectLabels() {
    const labels = new Map();
    let stableRounds = 0;
    let lastCount = -1;
    let lastHeight = -1;

    for (let i = 0; i < 40; i++) {
      for (const item of projectLabelCandidates()) labels.set(item.title.toLowerCase(), item);
      const root = document.scrollingElement || document.documentElement;
      const height = Math.max(root.scrollHeight || 0, document.body?.scrollHeight || 0);
      if (labels.size === lastCount && height === lastHeight) stableRounds += 1;
      else stableRounds = 0;
      lastCount = labels.size;
      lastHeight = height;
      if (stableRounds >= 4) break;
      window.scrollTo(0, height);
      await sleep(450);
    }

    return [...labels.values()].slice(0, 120);
  }

  function exactTextMatches(root, title) {
    const target = cleanText(title).toLowerCase();
    return [...root.querySelectorAll('*')]
      .filter(el => isVisible(el) && elementText(el).toLowerCase() === target)
      .sort((a, b) => {
        const ac = a.querySelectorAll('*').length;
        const bc = b.querySelectorAll('*').length;
        if (ac !== bc) return ac - bc;
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });
  }

  function dispatchRealisticClick(el) {
    const target = clickableAncestor(el);
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    const clientX = Math.max(rect.left + 2, Math.min(rect.right - 2, rect.left + rect.width / 2));
    const clientY = Math.max(rect.top + 2, Math.min(rect.bottom - 2, rect.top + rect.height / 2));
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0, buttons: 1 };
    try { target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } catch {}
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    try { target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 })); } catch {}
    target.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
    return target;
  }

  function clickVisibleProjectLabel(title) {
    const root = document.querySelector('main') || document.body;
    const matches = exactTextMatches(root, title);
    const el = matches[0];
    if (!el) return { ok: false, clicked: false, error: `Visible project label not found: ${title}` };
    const row = findProjectRowForLabel(el, title) || el;
    const target = dispatchRealisticClick(row);
    return { ok: true, clicked: true, title, targetTag: target?.tagName || null, targetRole: target?.getAttribute?.('role') || null };
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
        const title = elementText(a) || 'ChatGPT conversation';
        const key = conversationKey(href);
        if (!out.has(key)) out.set(key, { key, title: title.slice(0, 180), url: href, ...ctx });
      }
    }
    return [...out.values()].slice(0, 160);
  }

  function collectVisibleLabels(root, { exclude = [] } = {}) {
    const ignored = new Set(exclude.map(x => cleanText(x).toLowerCase()).filter(Boolean));
    const best = new Map();
    const nodes = root.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],span,p,div');
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const text = elementText(el);
      if (looksLikeUi(text) || ignored.has(text.toLowerCase())) continue;
      if (hasDateToken(text)) continue;
      const key = text.toLowerCase();
      const score = el.querySelectorAll('*').length * 5 + text.length / 1000;
      const prev = best.get(key);
      if (!prev || score < prev.score) best.set(key, { title: text, score });
    }
    return [...best.values()].sort((a, b) => a.score - b.score).map(x => ({ title: x.title }));
  }

  function discoverThreadLabels() {
    const ctx = projectContext();
    const main = document.querySelector('main') || document.body;
    const exclude = [ctx.projectTitle, 'Files', 'Instructions', 'Project instructions', 'Add files', 'New chat'];
    return collectVisibleLabels(main, { exclude }).slice(0, 120);
  }

  function clickVisibleThreadLabel(title) {
    const root = document.querySelector('main') || document.body;
    const el = exactTextMatches(root, title)[0];
    if (!el) return { ok: false, clicked: false, error: `Visible thread label not found: ${title}` };
    const target = dispatchRealisticClick(el);
    return { ok: true, clicked: true, title, targetTag: target?.tagName || null };
  }

  async function capture(reason = 'auto', override = null) {
    const cfg = await chrome.storage.local.get({ enabled: false });
    if (!cfg.enabled) return { ok: false, error: 'SHINO Sync is OFF' };

    const transcript = reason === 'auto' ? extractTranscript() : await waitForTranscript(18000);
    if (!transcript) {
      if (reason !== 'auto') await chrome.storage.local.set({ lastStatus: 'Capture unavailable', lastError: 'No readable ChatGPT message DOM found after waiting for the thread to render.' });
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

  function schedule(delay = 3500) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => capture('auto'), delay);
  }

  const observer = new MutationObserver(() => schedule());
  const start = () => {
    const main = document.querySelector('main') || document.body;
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();

  setInterval(() => {
    if (location.href === lastLocation) return;
    lastLocation = location.href;
    lastFingerprint = '';
    schedule(1200);
  }, 700);

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
      sendResponse(clickVisibleProjectLabel(msg.title || ''));
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
      sendResponse(clickVisibleThreadLabel(msg.title || ''));
      return;
    }
  });
})();