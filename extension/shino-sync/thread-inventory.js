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
  function textOf(el) {
    return clean(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
  }
  function conversationKey(url = '') {
    try {
      const u = new URL(url, location.origin);
      return u.pathname.match(/\/c\/([^/?#]+)/)?.[1] || `${u.pathname}${u.search}`;
    } catch { return url; }
  }
  function projectKeyFromUrl(url = location.href) {
    try { return new URL(url, location.origin).pathname.match(/\/g\/(g-p-[^/?#]+)/i)?.[1] || null; }
    catch { return null; }
  }
  function isUi(text = '') {
    const t = norm(text);
    if (!t || t.length < 2 || t.length > 180) return true;
    return /^(chatgpt|projects?|new chat|library|scheduled|plugins|more|pinned|recents|files|instructions|project instructions|add files|search|share|new|settings|temporary chat)$/i.test(t);
  }
  function clickableAncestor(el, max = 5) {
    let cur = el;
    for (let i = 0; cur && i < max; i++, cur = cur.parentElement) {
      const tag = String(cur.tagName || '').toLowerCase();
      const role = String(cur.getAttribute?.('role') || '').toLowerCase();
      const tabindex = cur.getAttribute?.('tabindex');
      const cursor = getComputedStyle(cur).cursor;
      if (tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || cursor === 'pointer' || (tabindex != null && Number(tabindex) >= 0)) return cur;
    }
    return null;
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

  function directThreadsNow(projectKey) {
    const out = new Map();
    const main = document.querySelector('main') || document.body;
    for (const a of main.querySelectorAll('a[href]')) {
      const raw = a.href || a.getAttribute('href') || '';
      if (!raw || !/\/c\//i.test(raw)) continue;
      let absolute;
      try { absolute = new URL(raw, location.origin).href; } catch { continue; }
      if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(absolute)) continue;
      const otherProject = projectKeyFromUrl(absolute);
      if (projectKey && otherProject && otherProject !== projectKey) continue;
      const key = conversationKey(absolute);
      const title = textOf(a) || 'ChatGPT conversation';
      if (!out.has(key)) out.set(key, { key, title: title.slice(0, 180), url: absolute });
    }
    return [...out.values()];
  }

  function threadRowsNow(projectTitle = '') {
    const main = document.querySelector('main') || document.body;
    const exclude = new Set([norm(projectTitle), 'files', 'instructions', 'project instructions', 'add files', 'new chat']);
    const best = new Map();
    const nodes = main.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],div,span,p');

    for (const el of nodes) {
      if (!visible(el)) continue;
      const title = textOf(el);
      const key = norm(title);
      if (!key || exclude.has(key) || isUi(title) || title.length > 180) continue;
      if (/\b(today|yesterday|modified|created by you|shared with you)\b/i.test(title)) continue;
      if (/^\d{1,2}[:/]\d{1,2}/.test(title)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 96 || r.width < 70) continue;
      const click = clickableAncestor(el, 4);
      if (!click) continue;
      const clickText = textOf(click);
      if (clickText.length > 220) continue;
      const descendants = el.querySelectorAll('*').length;
      const clickDesc = click.querySelectorAll('*').length;
      const score = descendants * 5 + clickDesc * 2 + r.height / 3 + title.length / 100;
      const prev = best.get(key);
      if (!prev || score < prev.score) best.set(key, { title, score });
    }
    return [...best.values()].sort((a,b) => a.score - b.score).slice(0, 140).map(x => ({ title: x.title }));
  }

  async function discoverThreadInventory(projectTitle = '') {
    const projectKey = projectKeyFromUrl();
    const direct = new Map();
    const rows = new Map();
    const root = scrollRoot();
    const isDoc = root === document.scrollingElement || root === document.documentElement || root === document.body;
    const original = isDoc ? window.scrollY : root.scrollTop;
    try {
      if (isDoc) window.scrollTo(0, 0); else root.scrollTop = 0;
      await sleep(300);
      let stable = 0;
      let lastFingerprint = '';
      for (let i = 0; i < 55; i++) {
        for (const t of directThreadsNow(projectKey)) direct.set(t.key, t);
        for (const row of threadRowsNow(projectTitle)) rows.set(norm(row.title), row);
        const max = isDoc ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) : root.scrollHeight;
        const pos = isDoc ? window.scrollY : root.scrollTop;
        const viewport = isDoc ? window.innerHeight : root.clientHeight;
        const fp = `${direct.size}|${rows.size}|${Math.round(max)}|${Math.round(pos)}`;
        if (fp === lastFingerprint) stable++; else stable = 0;
        lastFingerprint = fp;
        if (pos + viewport >= max - 12 && stable >= 2) break;
        const next = Math.min(max, pos + Math.max(280, viewport * 0.74));
        if (isDoc) window.scrollTo(0, next); else root.scrollTop = next;
        await sleep(300);
      }
      for (const t of directThreadsNow(projectKey)) direct.set(t.key, t);
      for (const row of threadRowsNow(projectTitle)) rows.set(norm(row.title), row);
    } finally {
      if (isDoc) window.scrollTo(0, original); else root.scrollTop = original;
    }
    return { projectKey, direct:[...direct.values()].slice(0, 220), rows:[...rows.values()].slice(0, 160) };
  }

  function realClick(el) {
    const target = clickableAncestor(el, 5) || el;
    target.scrollIntoView({ block:'center', inline:'nearest' });
    const r = target.getBoundingClientRect();
    const x = r.left + Math.max(2, Math.min(r.width - 2, r.width / 2));
    const y = r.top + Math.max(2, Math.min(r.height - 2, r.height / 2));
    const base = { bubbles:true, cancelable:true, composed:true, view:window, clientX:x, clientY:y, button:0 };
    try { target.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId:1, pointerType:'mouse', isPrimary:true, buttons:1 })); } catch {}
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons:1 }));
    try { target.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId:1, pointerType:'mouse', isPrimary:true, buttons:0 })); } catch {}
    target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons:0 }));
    target.dispatchEvent(new MouseEvent('click', { ...base, buttons:0 }));
    return target;
  }

  function clickThreadRow(title) {
    const targetNorm = norm(title);
    const main = document.querySelector('main') || document.body;
    const matches = [...main.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],div,span,p')]
      .filter(el => visible(el) && norm(textOf(el)) === targetNorm && clickableAncestor(el, 4))
      .sort((a,b) => {
        const ad = a.querySelectorAll('*').length, bd = b.querySelectorAll('*').length;
        if (ad !== bd) return ad - bd;
        return a.getBoundingClientRect().height - b.getBoundingClientRect().height;
      });
    if (!matches.length) return { ok:false, clicked:false, error:`Thread row not found: ${title}` };
    const target = realClick(matches[0]);
    return { ok:true, clicked:true, title, tag:target.tagName, role:target.getAttribute?.('role') || null };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'SHINO_V3_DISCOVER_THREADS') {
      discoverThreadInventory(msg.projectTitle || '').then(inventory => sendResponse({ ok:true, ...inventory }));
      return true;
    }
    if (msg?.type === 'SHINO_V3_CLICK_THREAD') {
      sendResponse(clickThreadRow(msg.title || ''));
      return;
    }
  });
})();
