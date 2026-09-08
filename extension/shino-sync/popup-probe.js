// v0.5.9 — single-project DOM probe. No ingestion, no navigation storm.
(() => {
  const $probe = document.getElementById('probe');
  const $copy = document.getElementById('copyProbe');
  const $projects = document.getElementById('projects');
  const $status = document.getElementById('status');
  let lastProbe = '';

  // Diagnostic build: full backfill stays disabled until we understand the actual project DOM.
  if ($projects) {
    $projects.disabled = true;
    $projects.title = 'Temporarily disabled in v0.5.9 diagnostic build. Use Probe current project first.';
  }

  function probeInPage() {
    const clean = v => String(v || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const visible = el => {
      if (!el || !(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) !== 0;
    };
    const textOf = el => clean(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
    const rectOf = el => {
      const r = el.getBoundingClientRect();
      return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) };
    };
    const hrefOf = el => el?.href || el?.getAttribute?.('href') || '';
    const path = location.pathname;
    const projectKey = path.match(/\/g\/(g-p-[^/?#]+)/i)?.[1] || null;
    const main = document.querySelector('main');
    const roleMain = document.querySelector('[role="main"]');
    const allAnchors = [...document.querySelectorAll('a[href]')];
    const cAnchors = allAnchors.filter(a => /\/c\//i.test(hrefOf(a)));
    const visibleC = cAnchors.filter(visible);
    const projectC = cAnchors.filter(a => projectKey && hrefOf(a).includes(`/g/${projectKey}/`));
    const navLike = el => !!el.closest?.('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]');
    const clickables = [...document.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex]')]
      .filter(visible)
      .map(el => ({
        tag:el.tagName,
        role:el.getAttribute('role') || '',
        text:textOf(el).slice(0,140),
        href:hrefOf(el).slice(0,220),
        nav:navLike(el),
        rect:rectOf(el)
      }))
      .filter(x => x.text || x.href)
      .slice(0,220);
    const outsideNav = clickables.filter(x => !x.nav && x.rect.x > 180);
    const bodyText = clean(document.body?.innerText || '');
    const mainText = clean((main || roleMain)?.innerText || '');
    return {
      url:location.href,
      title:document.title,
      projectKey,
      viewport:{w:innerWidth,h:innerHeight},
      body:{chars:bodyText.length,sample:bodyText.slice(0,1200)},
      main: main ? {present:true, rect:rectOf(main), chars:mainText.length, sample:mainText.slice(0,1200)} : {present:false},
      roleMain: roleMain ? {present:true, rect:rectOf(roleMain), chars:clean(roleMain.innerText).length, sample:clean(roleMain.innerText).slice(0,1200)} : {present:false},
      anchors:{all:allAnchors.length, cAll:cAnchors.length, cVisible:visibleC.length, cProjectScoped:projectC.length,
        samples:cAnchors.slice(0,40).map(a=>({text:textOf(a).slice(0,120),href:hrefOf(a).slice(0,220),visible:visible(a),nav:navLike(a),rect:rectOf(a)}))},
      clickables:{allVisible:clickables.length,outsideNav:outsideNav.length,samples:outsideNav.slice(0,80)},
      scripts:[...document.scripts].map(s=>s.src||'[inline]').slice(0,40),
      timestamp:new Date().toISOString()
    };
  }

  async function activeProjectTab() {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '')) return null;
    return tab;
  }

  if ($probe) $probe.onclick = async () => {
    try {
      const tab = await activeProjectTab();
      if (!tab) {
        $status.textContent = 'Open a ChatGPT project page in the current tab, then click Probe current project.';
        return;
      }
      if (!/\/g\/g-p-/i.test(tab.url || '')) {
        $status.textContent = `Current ChatGPT tab is not a project page.\nOpen e.g. Music, Riso or TouchPlus first.\n${tab.url}`;
        return;
      }
      $status.textContent = 'Probing current project DOM only… no ingestion, no navigation.';
      const injected = await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:probeInPage });
      const probe = injected?.[0]?.result;
      if (!probe) throw new Error('No probe result returned');
      lastProbe = JSON.stringify(probe, null, 2);
      await chrome.storage.local.set({ lastProjectProbe:probe, lastProjectProbeText:lastProbe });
      const a = probe.anchors;
      const c = probe.clickables;
      $status.textContent = `PROJECT DOM PROBE COMPLETE\n${probe.title}\n${probe.url}\nprojectKey: ${probe.projectKey || 'NONE'}\nmain: ${probe.main.present ? `${probe.main.rect.w}×${probe.main.rect.h}, ${probe.main.chars} chars` : 'NONE'}\n/c/ anchors: ${a.cAll} total · ${a.cVisible} visible · ${a.cProjectScoped} project-scoped\nvisible clickables outside nav: ${c.outsideNav}\n\nClick “Copy probe report” and paste it in ChatGPT.`;
      if ($copy) $copy.disabled = false;
    } catch (e) {
      $status.textContent = 'Probe failed: ' + (e?.message || String(e));
    }
  };

  if ($copy) $copy.onclick = async () => {
    try {
      if (!lastProbe) {
        const stored = await chrome.storage.local.get({ lastProjectProbeText:'' });
        lastProbe = stored.lastProjectProbeText || '';
      }
      if (!lastProbe) return void ($status.textContent = 'Run Probe current project first.');
      await navigator.clipboard.writeText(lastProbe);
      $status.textContent = 'Probe report copied. Paste it into our ChatGPT conversation.';
    } catch (e) {
      $status.textContent = 'Copy failed. Probe is stored locally; reopen popup and try again. ' + (e?.message || String(e));
    }
  };
})();
