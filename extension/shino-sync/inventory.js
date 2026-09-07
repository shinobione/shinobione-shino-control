(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function clean(value = '') {
    return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function norm(value = '') {
    return clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }
  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) !== 0;
  }

  const DATE_PARTS = [
    /\b(today|yesterday)\b/gi,
    /\b(aujourd['’]hui|hier)\b/gi,
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/gi,
    /\b\d{1,2}\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi,
    /\b(janv(?:ier)?|fevr(?:ier)?|f[eé]vr(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[eé]c(?:embre)?)\.?\s+\d{1,2}\b/gi,
    /\b\d{1,2}\s+(janv(?:ier)?|fevr(?:ier)?|f[eé]vr(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[eé]c(?:embre)?)\b/gi
  ];

  function dateCount(text = '') {
    let count = 0;
    for (const rx of DATE_PARTS) {
      rx.lastIndex = 0;
      count += [...String(text).matchAll(rx)].length;
    }
    return count;
  }
  function removeDate(text = '') {
    let out = String(text);
    for (const rx of DATE_PARTS) {
      rx.lastIndex = 0;
      out = out.replace(rx, ' ');
    }
    return clean(out.replace(/\b(modified|modifi[eé])\b/gi, ' '));
  }
  function uiText(text = '') {
    const t = norm(text);
    if (!t || t.length < 2 || t.length > 140) return true;
    return /^(projects?|search projects|new|all|created by you|shared with you|name|modified|new chat|library|scheduled|plugins|more|pinned|recents)$/i.test(t);
  }
  function rawText(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  function projectRowsNow() {
    const main = document.querySelector('main') || document.body;
    const selectors = 'tr,li,a,button,[role="row"],[role="link"],[role="button"],[tabindex],div';
    const best = new Map();

    for (const el of main.querySelectorAll(selectors)) {
      if (!visible(el)) continue;
      const raw = rawText(el);
      if (!raw || raw.length > 260) continue;
      if (dateCount(raw) !== 1) continue;

      const title = removeDate(raw);
      if (uiText(title) || title.length > 120) continue;
      if (/\b(created by you|shared with you|search projects)\b/i.test(title)) continue;

      const r = el.getBoundingClientRect();
      if (r.height > 150) continue;
      const descendants = el.querySelectorAll('*').length;
      const clickableBonus = (() => {
        const role = String(el.getAttribute?.('role') || '').toLowerCase();
        const tag = String(el.tagName || '').toLowerCase();
        const cursor = getComputedStyle(el).cursor;
        return tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || cursor === 'pointer' ? -25 : 0;
      })();
      const score = descendants * 3 + r.height / 5 + Math.max(0, title.length - 45) / 4 + clickableBonus;
      const key = norm(title);
      const prev = best.get(key);
      if (!prev || score < prev.score) best.set(key, { title, score, rowText: clean(raw) });
    }
    return [...best.values()].sort((a, b) => a.score - b.score);
  }

  function scrollRoot() {
    const main = document.querySelector('main') || document.body;
    let winner = null;
    let delta = 0;
    for (const el of [main, ...main.querySelectorAll('div,section')]) {
      if (!visible(el)) continue;
      const d = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (d <= delta + 40) continue;
      const oy = getComputedStyle(el).overflowY;
      if (el === main || oy === 'auto' || oy === 'scroll') { winner = el; delta = d; }
    }
    return winner || document.scrollingElement || document.documentElement;
  }

  async function discoverProjectRows() {
    const found = new Map();
    const root = scrollRoot();
    const isDoc = root === document.scrollingElement || root === document.documentElement || root === document.body;
    const original = isDoc ? window.scrollY : root.scrollTop;

    try {
      if (isDoc) window.scrollTo(0, 0); else root.scrollTop = 0;
      await sleep(250);
      let stable = 0;
      let lastCount = -1;
      for (let i = 0; i < 45; i++) {
        for (const row of projectRowsNow()) found.set(norm(row.title), { title: row.title, rowText: row.rowText });
        const max = isDoc
          ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
          : root.scrollHeight;
        const pos = isDoc ? window.scrollY : root.scrollTop;
        const viewport = isDoc ? window.innerHeight : root.clientHeight;
        if (found.size === lastCount) stable++; else stable = 0;
        lastCount = found.size;
        if (pos + viewport >= max - 12 && stable >= 2) break;
        const next = Math.min(max, pos + Math.max(260, viewport * 0.78));
        if (isDoc) window.scrollTo(0, next); else root.scrollTop = next;
        await sleep(320);
      }
    } finally {
      if (isDoc) window.scrollTo(0, original); else root.scrollTop = original;
    }

    return [...found.values()].slice(0, 160);
  }

  function findProjectRow(title) {
    const target = norm(title);
    const main = document.querySelector('main') || document.body;
    let best = null;
    for (const el of main.querySelectorAll('tr,li,a,button,[role="row"],[role="link"],[role="button"],[tabindex],div')) {
      if (!visible(el)) continue;
      const raw = rawText(el);
      if (!raw || raw.length > 260 || dateCount(raw) !== 1) continue;
      const derived = removeDate(raw);
      if (norm(derived) !== target) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 150) continue;
      const score = el.querySelectorAll('*').length * 3 + r.height / 5;
      if (!best || score < best.score) best = { el, score };
    }
    return best?.el || null;
  }

  function clickable(el) {
    let cur = el;
    for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) {
      const txt = rawText(cur);
      if (dateCount(txt) > 1 || txt.length > 320) break;
      const role = String(cur.getAttribute?.('role') || '').toLowerCase();
      const tag = String(cur.tagName || '').toLowerCase();
      const cursor = getComputedStyle(cur).cursor;
      const tabindex = cur.getAttribute?.('tabindex');
      if (tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || cursor === 'pointer' || (tabindex != null && Number(tabindex) >= 0)) return cur;
    }
    return el;
  }

  function realClick(el) {
    const target = clickable(el);
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = target.getBoundingClientRect();
    const x = r.left + Math.max(2, r.width / 2);
    const y = r.top + Math.max(2, r.height / 2);
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    try { target.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 })); } catch {}
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    try { target.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 })); } catch {}
    target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    return target;
  }

  function clickProjectRow(title) {
    const row = findProjectRow(title);
    if (!row) return { ok: false, clicked: false, error: `Project row not found: ${title}` };
    const target = realClick(row);
    return { ok: true, clicked: true, title, tag: target.tagName, role: target.getAttribute?.('role') || null };
  }

  function threadCandidatesNow(projectTitle = '') {
    const main = document.querySelector('main') || document.body;
    const exclude = new Set([
      norm(projectTitle), 'files', 'instructions', 'project instructions', 'add files', 'new chat', 'search', 'share', 'more'
    ]);
    const best = new Map();
    const nodes = main.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],div,span,p');
    for (const el of nodes) {
      if (!visible(el)) continue;
      const t = clean(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '');
      const k = norm(t);
      if (!k || exclude.has(k) || t.length < 2 || t.length > 170 || dateCount(t)) continue;
      if (/^(chatgpt|projects?|library|scheduled|plugins|more|pinned|recents)$/i.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 130) continue;
      const role = String(el.getAttribute?.('role') || '').toLowerCase();
      const tag = String(el.tagName || '').toLowerCase();
      const cursor = getComputedStyle(el).cursor;
      const clickableScore = tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || cursor === 'pointer' ? -20 : 0;
      const score = el.querySelectorAll('*').length * 4 + r.height / 4 + clickableScore;
      const prev = best.get(k);
      if (!prev || score < prev.score) best.set(k, { title: t, score });
    }
    return [...best.values()].sort((a, b) => a.score - b.score).slice(0, 140).map(x => ({ title: x.title }));
  }

  function clickThread(title) {
    const targetNorm = norm(title);
    const main = document.querySelector('main') || document.body;
    const candidates = [...main.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],div,span,p')]
      .filter(el => visible(el) && norm(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '') === targetNorm)
      .sort((a,b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    if (!candidates.length) return { ok:false, clicked:false, error:`Thread row not found: ${title}` };
    realClick(candidates[0]);
    return { ok:true, clicked:true, title };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'SHINO_V2_DISCOVER_PROJECT_ROWS') {
      discoverProjectRows().then(rows => sendResponse({ ok: true, rows }));
      return true;
    }
    if (msg?.type === 'SHINO_V2_CLICK_PROJECT_ROW') {
      sendResponse(clickProjectRow(msg.title || ''));
      return;
    }
    if (msg?.type === 'SHINO_V2_DISCOVER_THREAD_ROWS') {
      sendResponse({ ok:true, rows:threadCandidatesNow(msg.projectTitle || '') });
      return;
    }
    if (msg?.type === 'SHINO_V2_CLICK_THREAD_ROW') {
      sendResponse(clickThread(msg.title || ''));
      return;
    }
  });
})();