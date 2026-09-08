// v0.6.7 — deep current-project conversation scan.
// The v0.6.6 inventory proved project ownership/route recovery works, but a real Music project
// contains 33 chats while the old <main>-anchor scanner only collected 10. The old scanner only
// considered a narrow set of CSS overflow roots and did not handle document scrolling or explicit
// "load/show more" pagination. This scanner accumulates project conversation URLs while traversing
// the document + every meaningful scroll container inside <main>, waiting for lazy/virtualized rows,
// and clicking only exact, conservative "load/show more" controls.

async function shinoDeepProjectAnchorsInPage(projectTitle = '') {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const stableProjectId = url => {
    try {
      return new URL(url, location.origin).pathname
        .match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null;
    } catch { return null; }
  };
  const conversationKey = url => {
    try { return new URL(url, location.origin).pathname.match(/\/c\/([^/?#]+)/i)?.[1] || url; }
    catch { return url; }
  };
  const visible = el => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) !== 0;
  };

  const projectKey = stableProjectId(location.href);
  const pageText = clean(document.body?.innerText || document.body?.textContent || '');
  if (/too many requests|temporarily limited access|making requests too quickly/i.test(pageText)) {
    return { projectKey, direct:[], rows:[], rateLimited:true, diag:{reason:'rate-limit page'} };
  }

  const main = document.querySelector('main') || document.querySelector('[role="main"]');
  if (!main) return {projectKey,direct:[],rows:[],rateLimited:false,diag:{reason:'no-main'}};

  const found = new Map();
  let scannedAnchors = 0;
  let rejectedWrongProject = 0;
  let loadMoreClicks = 0;

  const scan = () => {
    for (const a of main.querySelectorAll('a[href*="/c/"]')) {
      const raw = a.href || a.getAttribute('href') || '';
      if (!raw) continue;
      let absolute;
      try { absolute = new URL(raw, location.origin).href; } catch { continue; }
      if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(absolute)) continue;
      scannedAnchors++;
      const owner = stableProjectId(absolute);
      if (projectKey && owner !== projectKey) {
        rejectedWrongProject++;
        continue;
      }
      const key = conversationKey(absolute);
      const title = clean(a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || 'ChatGPT conversation');
      if (!found.has(key)) found.set(key,{key,title:title.slice(0,180),url:absolute});
    }
  };

  const maybeClickLoadMore = async () => {
    const rx = /^(show more|load more|view more|see more|show more chats|more chats|voir plus|afficher plus|charger plus|plus de discussions)$/i;
    const candidates = [...main.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .map(el => ({el,text:clean(el.innerText || el.textContent || el.getAttribute('aria-label') || '')}))
      .filter(item => rx.test(item.text));
    if (!candidates.length) return false;
    const target = candidates[0].el;
    target.scrollIntoView({block:'center',inline:'nearest'});
    await wait(120);
    target.click();
    loadMoreClicks++;
    await wait(900);
    scan();
    return true;
  };

  const doc = document.scrollingElement || document.documentElement;
  const candidates = [];
  const seen = new Set();
  const addTarget = (el, kind) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    const client = el === doc ? window.innerHeight : (el.clientHeight || 0);
    const scroll = el === doc
      ? Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0)
      : (el.scrollHeight || 0);
    if (kind !== 'document' && scroll - client < 24) return;
    candidates.push({el,kind,client,scroll});
  };

  // Important: document scrolling was absent from the old scanner.
  addTarget(doc,'document');
  addTarget(main,'main');
  for (const el of main.querySelectorAll('[role="tabpanel"],section,div,ul,ol')) {
    const client = el.clientHeight || 0;
    const scroll = el.scrollHeight || 0;
    if (scroll - client >= 24) addTarget(el,'element');
  }

  // Largest traversal ranges first. Keep enough candidates for nested/virtualized chat lists.
  candidates.sort((a,b)=>(b.scroll-b.client)-(a.scroll-a.client));
  const targets = candidates.slice(0,10);
  const diagnostics = [];

  const getPos = target => target.kind === 'document' ? window.scrollY : target.el.scrollTop;
  const getMax = target => target.kind === 'document'
    ? Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0)
    : (target.el.scrollHeight || 0);
  const getView = target => target.kind === 'document' ? window.innerHeight : (target.el.clientHeight || 0);
  const setPos = (target,pos) => {
    if (target.kind === 'document') window.scrollTo(0,pos);
    else target.el.scrollTop = pos;
  };

  scan();
  // Pagination controls can exist even when no element reports useful overflow yet.
  await maybeClickLoadMore();

  for (const target of targets) {
    const original = getPos(target);
    const startCount = found.size;
    let rounds = 0;
    let stableBottomRounds = 0;
    let lastCount = found.size;
    let lastMax = getMax(target);

    try {
      setPos(target,0);
      await wait(320);
      scan();

      for (let pass=0; pass<90; pass++) {
        rounds++;
        scan();
        const max = getMax(target);
        const view = getView(target);
        const pos = getPos(target);

        const clicked = await maybeClickLoadMore();
        if (clicked) {
          stableBottomRounds = 0;
          lastCount = found.size;
          lastMax = getMax(target);
          continue;
        }

        if (pos + view >= max - 10) {
          // Lazy lists often append only after sitting at the bottom for a moment.
          await wait(650);
          scan();
          const grownMax = getMax(target);
          const grownCount = found.size;
          if (grownMax > lastMax + 8 || grownCount > lastCount) {
            stableBottomRounds = 0;
            lastMax = grownMax;
            lastCount = grownCount;
            continue;
          }
          stableBottomRounds++;
          if (stableBottomRounds >= 3) break;
          continue;
        }

        stableBottomRounds = 0;
        const next = Math.min(max, pos + Math.max(220, view * 0.72));
        setPos(target,next);
        try { target.el.dispatchEvent(new Event('scroll',{bubbles:true})); } catch {}
        await wait(380);
        scan();
        lastCount = found.size;
        lastMax = getMax(target);
      }
    } finally {
      setPos(target,original);
      await wait(120);
    }

    diagnostics.push({
      kind:target.kind,
      tag:target.el?.tagName || 'DOCUMENT',
      role:target.el?.getAttribute?.('role') || null,
      className:clean(target.el?.className || '').slice(0,120),
      clientHeight:getView(target),
      scrollHeight:getMax(target),
      rounds,
      foundBefore:startCount,
      foundAfter:found.size
    });
  }

  // One final pagination/settle cycle after all scroll roots have been exercised.
  for (let i=0; i<4; i++) {
    const before = found.size;
    const clicked = await maybeClickLoadMore();
    await wait(clicked ? 700 : 250);
    scan();
    if (!clicked && found.size === before) break;
  }

  const controls = [...main.querySelectorAll('button,[role="button"]')]
    .filter(visible)
    .map(el => clean(el.innerText || el.textContent || el.getAttribute('aria-label') || ''))
    .filter(Boolean)
    .filter((value,index,array)=>array.indexOf(value)===index)
    .slice(0,40);
  const mr = main.getBoundingClientRect();

  return {
    projectKey,
    direct:[...found.values()].slice(0,300),
    rows:[],
    rateLimited:false,
    diag:{
      strategy:'deep-main-project-anchors-v2',
      projectTitle,
      mainX:Math.round(mr.x),
      mainW:Math.round(mr.width),
      scannedAnchors,
      accepted:found.size,
      rejectedWrongProject,
      loadMoreClicks,
      scrollTargets:diagnostics,
      controls
    }
  };
}

// All v0.6.6 inventory code calls this global helper, so a successful deep probe is also a
// direct test of the scanner the next full inventory will use.
shinoMainProjectAnchorsInPage = shinoDeepProjectAnchorsInPage;

(() => {
  const statusEl = document.getElementById('status');
  const probeButton = document.getElementById('probe');
  const copyButton = document.getElementById('copyProbe');
  const ingestButton = document.getElementById('ingestInventory');
  let lastDeepProbe = '';

  // The 105-chat v0.6.6 inventory is known incomplete (Music alone was 10/33), so never leave
  // its ingestion button armed after this update.
  chrome.storage.local.set({lastActiveTabInventory:null}).catch(()=>{});
  if (ingestButton) {
    ingestButton.disabled = true;
    ingestButton.textContent = 'Ingest inventoried chats';
    ingestButton.title = 'v0.6.6 inventory invalidated: project conversation counts were incomplete.';
  }

  if (probeButton) {
    probeButton.textContent = 'Deep probe current project';
    probeButton.onclick = async () => {
      try {
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '') || !/\/g\/g-p-/i.test(tab.url || '')) {
          statusEl.textContent = 'Open the Music ChatGPT project page first.';
          return;
        }
        statusEl.textContent = 'DEEP PROJECT PROBE\nScrolling the project chat list and waiting for lazy/virtualized rows…';
        const injected = await chrome.scripting.executeScript({
          target:{tabId:tab.id},
          func:shinoDeepProjectAnchorsInPage,
          args:['']
        });
        const result = injected?.[0]?.result;
        if (!result) throw new Error('No deep project scan result');
        lastDeepProbe = JSON.stringify({url:tab.url,projectKey:result.projectKey,threads:result.direct,diag:result.diag},null,2);
        await chrome.storage.local.set({lastProjectProbeText:lastDeepProbe});
        if (copyButton) copyButton.disabled = false;
        const roots = result.diag?.scrollTargets || [];
        statusEl.textContent = `DEEP PROJECT PROBE\n${result.direct.length} unique project conversations found\nprojectKey: ${result.projectKey || 'NONE'}\nscroll targets exercised: ${roots.length} · load-more clicks: ${result.diag?.loadMoreClicks || 0}\n\n${result.direct.slice(0,12).map(t=>`• ${t.title}`).join('\n')}`;
      } catch (e) {
        statusEl.textContent = 'Deep project probe failed: ' + (e?.message || String(e));
      }
    };
  }

  if (copyButton) copyButton.onclick = async () => {
    if (!lastDeepProbe) {
      const stored = await chrome.storage.local.get({lastProjectProbeText:''});
      lastDeepProbe = stored.lastProjectProbeText || '';
    }
    if (!lastDeepProbe) return void(statusEl.textContent='Run Deep probe current project first.');
    await navigator.clipboard.writeText(lastDeepProbe);
    statusEl.textContent = 'Deep project probe copied.';
  };
})();
