(() => {
  let timer = null;
  let lastHref = location.href;
  let lastSentFingerprint = '';
  let lastObservedFingerprint = '';

  function clean(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cleanMessage(value = '') {
    return String(value || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function hash(value = '') {
    let h = 2166136261;
    for (const char of String(value || '')) {
      h ^= char.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function stableProjectKey(value = location.href) {
    try {
      const path = new URL(value).pathname;
      return path.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1]?.toLowerCase() || null;
    } catch {
      return String(value || '').match(/(g-p-[0-9a-f]{32})/i)?.[1]?.toLowerCase() || null;
    }
  }

  function conversationKey(value = location.href) {
    try {
      return new URL(value).pathname.match(/\/c\/([^/?#]+)/i)?.[1] || null;
    } catch {
      return null;
    }
  }

  function title() {
    return (document.title || 'ChatGPT conversation')
      .replace(/\s*[|–—-]\s*ChatGPT\s*$/i, '')
      .replace(/^ChatGPT\s*[|–—-]\s*/i, '')
      .trim() || 'ChatGPT conversation';
  }

  function projectContext() {
    const projectKey = stableProjectKey();
    if (!projectKey) return { projectKey:null, projectTitle:null, projectUrl:null };

    const anchors = [...document.querySelectorAll('a[href*="/g/"]')];
    const projectAnchor = anchors.find(anchor => {
      const href = anchor.href || anchor.getAttribute('href') || '';
      return stableProjectKey(href) === projectKey && !/\/c\//i.test(href);
    });
    const projectTitle = clean(projectAnchor?.innerText || projectAnchor?.textContent || projectAnchor?.getAttribute?.('aria-label') || projectAnchor?.getAttribute?.('title') || '') || null;
    return {
      projectKey,
      projectTitle:projectTitle && projectTitle.length <= 160 ? projectTitle : null,
      projectUrl:projectAnchor?.href || `${location.origin}/g/${projectKey}`
    };
  }

  function collectMessages() {
    const nodes = [...document.querySelectorAll('[data-message-author-role]')];
    if (!nodes.length) return [];

    const selected = nodes.slice(-12);
    const messages = [];
    let chars = 0;
    for (const node of selected) {
      const role = String(node.getAttribute('data-message-author-role') || 'unknown').toLowerCase();
      const text = cleanMessage(node.innerText || node.textContent || '').slice(0, 16000);
      if (!text) continue;
      if (chars + text.length > 90000) break;
      chars += text.length;
      messages.push({ role, text });
    }
    return messages;
  }

  function fingerprintFor(key, messages) {
    const tail = messages.slice(-4).map(message => `${message.role}:${message.text}`).join('\n');
    return `${key}:${messages.length}:${hash(tail)}`;
  }

  async function collect() {
    const key = conversationKey();
    if (!key) return { ok:true, skipped:true, reason:'not a conversation route' };

    const messages = collectMessages();
    if (!messages.length) return { ok:true, skipped:true, reason:'messages not rendered yet' };

    const fingerprint = fingerprintFor(key, messages);
    lastObservedFingerprint = fingerprint;
    if (fingerprint === lastSentFingerprint) return { ok:true, skipped:true, reason:'fingerprint unchanged in browser' };

    const ctx = projectContext();
    const now = new Date().toISOString();
    const payload = {
      conversationKey:key,
      url:location.href,
      title:title(),
      projectKey:ctx.projectKey,
      projectTitle:ctx.projectTitle,
      projectUrl:ctx.projectUrl,
      messages,
      messageCount:document.querySelectorAll('[data-message-author-role]').length,
      fingerprint,
      conversationUpdatedAt:now,
      clientTimestamp:now,
      collectorVersion:'0.1.1'
    };

    const response = await chrome.runtime.sendMessage({ type:'CONTROL_COLLECT_DELTA', payload });
    // Only suppress future sends after CONTROL accepted this fingerprint. A transient localhost
    // failure therefore retries automatically on the next DOM/navigation observation.
    if (response?.ok) lastSentFingerprint = fingerprint;
    return response;
  }

  function schedule(delay = 3500) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      collect().catch(() => {});
    }, delay);
  }

  function observe() {
    const root = document.querySelector('main') || document.body;
    if (!root) return schedule(1200);
    new MutationObserver(() => schedule()).observe(root, {
      subtree:true,
      childList:true,
      characterData:true
    });
    schedule(1400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe, { once:true });
  } else {
    observe();
  }

  // ChatGPT is an SPA. Route changes do not reload the extension content script.
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    lastSentFingerprint = '';
    lastObservedFingerprint = '';
    schedule(900);
  }, 700);

  // If the DOM settled while CONTROL was temporarily unavailable, retry the unsent observation.
  setInterval(() => {
    if (lastObservedFingerprint && lastObservedFingerprint !== lastSentFingerprint) schedule(0);
  }, 30000);
})();
