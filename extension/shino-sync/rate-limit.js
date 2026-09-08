(() => {
  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) !== 0;
  }

  function rateLimitStatus() {
    const candidates = [
      ...document.querySelectorAll('[role="dialog"],[aria-modal="true"],main,body')
    ].filter(visible);
    let text = '';
    for (const el of candidates) {
      const t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/too many requests|requests too quickly|temporarily limited access|please wait a few minutes/i.test(t)) {
        text = t.slice(0, 700);
        break;
      }
    }
    return { rateLimited: !!text, text };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'SHINO_RATE_LIMIT_STATUS') {
      sendResponse({ ok: true, ...rateLimitStatus() });
      return;
    }
  });
})();
