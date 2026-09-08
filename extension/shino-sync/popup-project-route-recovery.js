// v0.6.4 — recover project routes from the visible Projects table.
// ChatGPT's /projects page may render project rows as client-side clickable rows with no href.
// v0.6.3 only trusted direct anchors, so it could report zero routes even when the rows were visible.
// This patch is loaded last and replaces only the Inventory button handler.
(() => {
  const statusEl = document.getElementById('status');
  const inventoryButton = document.getElementById('projects');
  const ingestButton = document.getElementById('ingestInventory');
  if (!inventoryButton || !statusEl) return;

  const INVENTORY_SCHEMA = 'active-tab-inventory-v1';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function stableProjectId(url = '') {
    if (typeof shinoStableProjectId === 'function') return shinoStableProjectId(url);
    try {
      return new URL(url, 'https://chatgpt.com').pathname
        .match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null;
    } catch { return null; }
  }

  function projectHomeUrl(raw = '') {
    try {
      const u = new URL(raw, 'https://chatgpt.com');
      const id = stableProjectId(u.href);
      if (!id) return u.href;
      u.pathname = `/g/${id}/project`;
      u.search = '';
      u.hash = '';
      return u.href;
    } catch { return raw; }
  }

  async function activeVisibleChatTab() {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    return tab?.id && isChatGptUrl(tab.url || '') ? tab : null;
  }

  function pageHealthInPage() {
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    const body = clean(document.body?.innerText || '');
    const controls = [...document.querySelectorAll('button,[role="button"]')]
      .map(el => clean(el.innerText || el.textContent || el.getAttribute('aria-label') || ''))
      .filter(Boolean);
    const tryAgain = controls.find(t => /^(try again|retry|réessayer|reessayer)$/i.test(t)) || null;
    return {
      visibility:document.visibilityState,
      hasMain:!!main,
      mainChars:clean(main?.innerText || '').length,
      tryAgain,
      rateLimited:/too many requests|requests too quickly|temporarily limited access|please wait a few minutes/i.test(body)
    };
  }

  async function health(tabId) {
    const out = await chrome.scripting.executeScript({ target:{tabId}, func:pageHealthInPage }).catch(() => null);
    return out?.[0]?.result || null;
  }

  async function navigateVisible(tabId, url, expectedProjectKey = null) {
    await chrome.tabs.update(tabId, { url, active:true });
    await waitForTab(tabId, 22000);
    await wait(650);

    let reloaded = false;
    for (let i=0; i<18; i++) {
      const h = await health(tabId);
      if (!h) { await wait(350); continue; }
      if (h.rateLimited) throw new Error('RATE_LIMITED');
      if (h.tryAgain) {
        if (reloaded) throw new Error(`RENDER_FAILED_TRY_AGAIN: ${h.tryAgain}`);
        statusEl.textContent = 'ChatGPT displayed Try again. One clean reload…';
        await chrome.tabs.reload(tabId);
        await waitForTab(tabId, 22000);
        await wait(650);
        reloaded = true;
        continue;
      }
      if (h.visibility !== 'visible') throw new Error('ACTIVE_TAB_NOT_VISIBLE — keep the driven ChatGPT tab selected');
      const current = await chrome.tabs.get(tabId);
      const currentKey = stableProjectId(current.url || '');
      if (h.hasMain && h.mainChars >= 20 && (!expectedProjectKey || currentKey === expectedProjectKey)) return current;
      await wait(400);
    }
    throw new Error('RENDER_NOT_READY');
  }

  async function clickProjectTitleInPage(title) {
    const sleepLocal = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = v => String(v || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const norm = v => clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const visible = el => {
      if (!el || !(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) !== 0;
    };
    const target = norm(title);
    const main = document.querySelector('main') || document.body;

    const scrollRoot = (() => {
      let winner = document.scrollingElement || document.documentElement;
      let delta = (winner.scrollHeight || 0) - (winner.clientHeight || 0);
      for (const el of [main, ...main.querySelectorAll('div,section')]) {
        if (!visible(el)) continue;
        const d = (el.scrollHeight || 0) - (el.clientHeight || 0);
        const oy = getComputedStyle(el).overflowY;
        if (d > delta + 40 && (el === main || oy === 'auto' || oy === 'scroll')) { winner = el; delta = d; }
      }
      return winner;
    })();
    const isDoc = scrollRoot === document.scrollingElement || scrollRoot === document.documentElement || scrollRoot === document.body;
    const original = isDoc ? window.scrollY : scrollRoot.scrollTop;

    function clickableAncestor(el) {
      let cur = el;
      for (let i=0; cur && i<9; i++, cur=cur.parentElement) {
        const role = String(cur.getAttribute?.('role') || '').toLowerCase();
        const tag = String(cur.tagName || '').toLowerCase();
        const cursor = getComputedStyle(cur).cursor;
        const tabIndex = cur.getAttribute?.('tabindex');
        if (tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || cursor === 'pointer' || (tabIndex != null && Number(tabIndex) >= 0)) return cur;
      }
      return el;
    }

    function find() {
      const candidates = [...main.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],span,p,div')]
        .filter(el => visible(el) && norm(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '') === target)
        .sort((a,b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      return candidates[0] || null;
    }

    function realClick(el) {
      const clickTarget = clickableAncestor(el);
      clickTarget.scrollIntoView({block:'center', inline:'nearest'});
      const r = clickTarget.getBoundingClientRect();
      const x = r.left + Math.max(2, r.width / 2);
      const y = r.top + Math.max(2, r.height / 2);
      const base = {bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,button:0};
      try { clickTarget.dispatchEvent(new PointerEvent('pointerdown',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:1})); } catch {}
      clickTarget.dispatchEvent(new MouseEvent('mousedown',{...base,buttons:1}));
      try { clickTarget.dispatchEvent(new PointerEvent('pointerup',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:0})); } catch {}
      clickTarget.dispatchEvent(new MouseEvent('mouseup',{...base,buttons:0}));
      clickTarget.dispatchEvent(new MouseEvent('click',{...base,buttons:0}));
      return { clicked:true, tag:clickTarget.tagName, role:clickTarget.getAttribute?.('role') || null };
    }

    try {
      if (isDoc) window.scrollTo(0,0); else scrollRoot.scrollTop = 0;
      await sleepLocal(180);
      for (let pass=0; pass<50; pass++) {
        const found = find();
        if (found) return realClick(found);
        const max = isDoc ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) : scrollRoot.scrollHeight;
        const pos = isDoc ? window.scrollY : scrollRoot.scrollTop;
        const view = isDoc ? window.innerHeight : scrollRoot.clientHeight;
        if (pos + view >= max - 8) break;
        const next = Math.min(max, pos + Math.max(260, view * 0.75));
        if (isDoc) window.scrollTo(0,next); else scrollRoot.scrollTop = next;
        await sleepLocal(220);
      }
      return {clicked:false,error:`Project title not found: ${title}`};
    } finally {
      // If navigation does not happen the caller will revisit /projects anyway.
      if (document.visibilityState === 'visible') {
        if (isDoc) window.scrollTo(0,original); else scrollRoot.scrollTop = original;
      }
    }
  }

  async function recoverProjectRoutes(tab, projectsPage) {
    await navigateVisible(tab.id, projectsPage);

    const directResult = await messageTab(tab.id, {type:'SHINO_DISCOVER_ALL_PROJECTS'}).catch(() => null);
    let direct = mergeProjects(directResult?.projects || []);

    let rowResult = await messageTab(tab.id, {type:'SHINO_V2_DISCOVER_PROJECT_ROWS'}).catch(() => null);
    let labels = (rowResult?.rows || []).map(x => x?.title).filter(Boolean);
    if (!labels.length) {
      const fallback = await messageTab(tab.id, {type:'SHINO_DISCOVER_PROJECT_LABELS'}).catch(() => null);
      labels = (fallback?.labels || []).map(x => x?.title).filter(Boolean);
    }
    labels = [...new Map(labels.map(title => [String(title).trim().toLowerCase(), String(title).trim()])).values()];

    statusEl.textContent = `PROJECT ROUTE RECOVERY\n${direct.length} direct hrefs · ${labels.length} visible project rows\nRecovering row routes visibly…`;

    const byTitle = new Map(direct.map(p => [String(p.title || '').trim().toLowerCase(), p]));
    const recovered = [];

    for (let i=0; i<labels.length; i++) {
      const title = labels[i];
      if (byTitle.has(title.toLowerCase())) continue;

      await navigateVisible(tab.id, projectsPage);
      statusEl.textContent = `PROJECT ROUTE RECOVERY ${i+1}/${labels.length}\n${title}\nClicking the visible Projects row…`;
      const before = (await chrome.tabs.get(tab.id)).url;
      const injected = await chrome.scripting.executeScript({target:{tabId:tab.id},func:clickProjectTitleInPage,args:[title]}).catch(() => null);
      const clicked = injected?.[0]?.result;
      if (!clicked?.clicked) continue;

      const nav = await waitForNavigation(tab.id, before, url => {
        return isChatGptUrl(url) && /\/g\/g-p-/i.test(url) && !/\/c\//i.test(url);
      }, 8000);
      if (!nav?.url) continue;

      const key = stableProjectId(nav.url);
      if (!key) continue;
      const item = {key,title,url:projectHomeUrl(nav.url)};
      recovered.push(item);
      byTitle.set(title.toLowerCase(), item);
      await wait(250);
    }

    const projects = mergeProjects(direct, recovered);
    return {projects,directCount:direct.length,rowCount:labels.length,recoveredCount:recovered.length};
  }

  async function setIngestButton(inventory) {
    if (!ingestButton) return;
    const valid = inventory?.schema === INVENTORY_SCHEMA && inventory?.approved && Array.isArray(inventory?.threads) && inventory.threads.length;
    ingestButton.disabled = !valid;
    ingestButton.textContent = valid ? `Ingest ${inventory.threads.length} inventoried chats` : 'Ingest inventoried chats';
  }

  inventoryButton.onclick = async () => {
    const tab = await activeVisibleChatTab();
    if (!tab) return void(statusEl.textContent='Open ChatGPT in the current selected tab first.');
    const originalUrl = tab.url;
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void(statusEl.textContent='Turn on Auto-sync this browser first');
      if (typeof shinoGuardButtonRun === 'function' && await shinoGuardButtonRun()) return;

      await chrome.storage.local.set({lastActiveTabInventory:null});
      await setIngestButton(null);

      let projectsPage = `${new URL(originalUrl).origin}/projects`;
      try {
        const info = await messageTab(tab.id,{type:'SHINO_FIND_PROJECTS_PAGE'});
        if (info?.url) projectsPage = info.url;
      } catch {}

      const routeInfo = await recoverProjectRoutes(tab, projectsPage);
      const projects = routeInfo.projects;
      if (!projects.length) throw new Error(`No project routes recovered (${routeInfo.directCount} direct hrefs · ${routeInfo.rowCount} rows · ${routeInfo.recoveredCount} clicked routes)`);

      statusEl.textContent = `PROJECT ROUTES OK\n${projects.length} projects (${routeInfo.directCount} direct + ${routeInfo.recoveredCount} row recovered).\nNow reading project conversations visibly…`;

      const threads = new Map();
      const owners = new Map();
      const collisions = [];
      const perProject = [];

      for (let i=0; i<projects.length; i++) {
        const project = projects[i];
        const home = projectHomeUrl(project.url);
        const expectedKey = stableProjectId(home) || project.key || null;
        statusEl.textContent = `ACTIVE-TAB INVENTORY ${i+1}/${projects.length}\n${project.title}\nNavigating visible ChatGPT tab…`;
        await navigateVisible(tab.id, home, expectedKey);
        const injected = await chrome.scripting.executeScript({target:{tabId:tab.id},func:shinoMainProjectAnchorsInPage,args:[project.title]}).catch(() => null);
        const result = injected?.[0]?.result || {direct:[],diag:{reason:'no-result'}};
        const ctx = {projectKey:expectedKey || result.projectKey,projectTitle:project.title,projectUrl:home};
        const list = (result.direct || []).map(item => ({...item,...ctx}));

        for (const thread of list) {
          const key = thread.key || conversationKeyFromUrl(thread.url);
          const previous = owners.get(key);
          if (previous && previous !== project.title) {
            collisions.push({key,a:previous,b:project.title,title:thread.title});
            continue;
          }
          owners.set(key,project.title);
          if (!threads.has(key)) threads.set(key,{...thread,key});
        }
        perProject.push({title:project.title,total:list.length,projectKey:ctx.projectKey,diag:result.diag});
        statusEl.textContent = `ACTIVE-TAB INVENTORY ${i+1}/${projects.length}\n${project.title}: ${list.length}\nTOTAL UNIQUE: ${threads.size}`;
      }

      const report = perProject.map(item => `${item.title}: ${item.total}`).join(' · ');
      if (collisions.length) {
        const sample = collisions.slice(0,8).map(item => `${item.a} ↔ ${item.b}: ${item.title || item.key}`).join('\n');
        throw new Error(`INVENTORY COLLISION SAFETY STOP\n${sample}`);
      }

      const nonEmpty = perProject.filter(item => item.total > 0).length;
      const minimumHealthy = projects.length >= 10 ? Math.ceil(projects.length * 0.7) : Math.max(1,Math.ceil(projects.length * 0.5));
      const approved = projects.length >= 10 && nonEmpty >= minimumHealthy && threads.size > 0;
      const inventory = {
        schema:INVENTORY_SCHEMA,
        createdAt:Date.now(),
        approved,
        projectCount:projects.length,
        nonEmptyProjects:nonEmpty,
        perProject,
        threads:[...threads.values()]
      };
      await chrome.storage.local.set({lastActiveTabInventory:inventory,lastBackfillProjectReport:perProject});
      await setIngestButton(inventory);

      if (!approved) {
        const msg = `ACTIVE-TAB INVENTORY SAFETY STOP\n${projects.length} projects · ${nonEmpty} with conversations · ${threads.size} unique chats.\nNothing was ingested.\n${report}`;
        statusEl.textContent = msg;
        await chrome.storage.local.set({lastStatus:msg,lastError:'Suspicious active-tab inventory coverage'});
        return;
      }

      const msg = `ACTIVE-TAB INVENTORY COMPLETE — NO INGESTION YET\n${projects.length} projects · ${threads.size} unique conversations\n${report}\n\nReview these counts before ingestion.`;
      statusEl.textContent = msg;
      await chrome.storage.local.set({lastStatus:msg,lastError:''});
    } catch (e) {
      const error = e?.message || String(e);
      statusEl.textContent = `ACTIVE-TAB INVENTORY STOPPED\nNothing was ingested.\n${error}`;
      await chrome.storage.local.set({lastStatus:statusEl.textContent,lastError:error});
    } finally {
      await chrome.tabs.update(tab.id,{url:originalUrl,active:true}).catch(()=>{});
    }
  };
})();
