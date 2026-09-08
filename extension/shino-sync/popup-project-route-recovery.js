// v0.6.6 — single-pass, resumable active-tab project inventory.
// Key change: when a project row is opened to recover its route, scan that project immediately.
// Do NOT open every project once for route recovery and then open all of them a second time.
// Progress and recovered routes are persisted after every project, so a ChatGPT Try again page
// pauses safely and the next click resumes from the first unfinished project instead of restarting.
(() => {
  const statusEl = document.getElementById('status');
  const inventoryButton = document.getElementById('projects');
  const ingestButton = document.getElementById('ingestInventory');
  if (!inventoryButton || !statusEl) return;

  const INVENTORY_SCHEMA = 'active-tab-inventory-v1';
  const DRAFT_SCHEMA = 'single-pass-inventory-v1';
  const ROUTE_CACHE_SCHEMA = 'project-route-cache-v1';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const jitter = (min, max) => Math.round(min + Math.random() * Math.max(0, max - min));

  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

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

  function conversationKey(url = '') {
    if (typeof conversationKeyFromUrl === 'function') return conversationKeyFromUrl(url);
    try { return new URL(url, 'https://chatgpt.com').pathname.match(/\/c\/([^/?#]+)/i)?.[1] || url; }
    catch { return url; }
  }

  async function activeVisibleChatTab() {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    return tab?.id && isChatGptUrl(tab.url || '') ? tab : null;
  }

  function pageHealthInPage() {
    const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    const body = tidy(document.body?.innerText || document.body?.textContent || '');
    const controls = [...document.querySelectorAll('button,[role="button"]')]
      .map(el => tidy(el.innerText || el.textContent || el.getAttribute('aria-label') || ''))
      .filter(Boolean);
    const tryAgain = controls.find(text => /^(try again|retry|réessayer|reessayer)$/i.test(text)) || null;
    const projectKey = (() => {
      try { return location.pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null; }
      catch { return null; }
    })();
    return {
      url:location.href,
      visibility:document.visibilityState,
      hasMain:!!main,
      mainChars:tidy(main?.innerText || main?.textContent || '').length,
      mainAnchors:main ? main.querySelectorAll('a[href*="/c/"]').length : 0,
      projectKey,
      tryAgain,
      rateLimited:/too many requests|requests too quickly|temporarily limited access|please wait a few minutes/i.test(body)
    };
  }

  async function health(tabId) {
    const out = await chrome.scripting.executeScript({ target:{tabId}, func:pageHealthInPage }).catch(() => null);
    return out?.[0]?.result || null;
  }

  async function ensureRendered(tabId, expectedProjectKey = null, allowOneReload = true) {
    let reloaded = false;
    for (let i = 0; i < 22; i++) {
      const h = await health(tabId);
      if (!h) { await wait(500); continue; }
      if (h.rateLimited) throw new Error('RATE_LIMITED');
      if (h.tryAgain) {
        statusEl.textContent = 'ChatGPT displayed Try again. Waiting 6s before the one allowed reload…';
        await wait(6000);
        const grace = await health(tabId);
        if (grace && !grace.tryAgain && grace.hasMain && grace.mainChars >= 20 && (!expectedProjectKey || grace.projectKey === expectedProjectKey)) return grace;
        if (!allowOneReload || reloaded) throw new Error(`RENDER_FAILED_TRY_AGAIN: ${h.tryAgain}`);
        await chrome.tabs.reload(tabId);
        await waitForTab(tabId, 22000);
        await wait(jitter(2600, 3600));
        reloaded = true;
        continue;
      }
      if (h.visibility !== 'visible') throw new Error('ACTIVE_TAB_NOT_VISIBLE — keep the driven ChatGPT tab selected');
      if (h.hasMain && h.mainChars >= 20 && (!expectedProjectKey || h.projectKey === expectedProjectKey)) return h;
      await wait(500);
    }
    throw new Error('RENDER_NOT_READY');
  }

  async function navigateVisible(tabId, url, expectedProjectKey = null) {
    await chrome.tabs.update(tabId, { url, active:true });
    await waitForTab(tabId, 22000);
    await wait(jitter(1800, 2600));
    return ensureRendered(tabId, expectedProjectKey, true);
  }

  async function scanCurrentProject(tabId, project) {
    const home = projectHomeUrl(project.url);
    const expectedKey = stableProjectId(home) || project.key || null;
    await ensureRendered(tabId, expectedKey, true);
    await wait(jitter(1000, 1600));
    const injected = await chrome.scripting.executeScript({
      target:{tabId},
      func:shinoMainProjectAnchorsInPage,
      args:[project.title]
    }).catch(() => null);
    const result = injected?.[0]?.result || {direct:[],diag:{reason:'no-result'}};
    const ctx = {projectKey:expectedKey || result.projectKey, projectTitle:project.title, projectUrl:home};
    const threads = (result.direct || []).map(item => ({...item,...ctx,key:item.key || conversationKey(item.url)}));
    return {project:{...project,key:ctx.projectKey,url:home},threads,diag:result.diag || {}};
  }

  async function readProjectsIndex(tab, projectsPage) {
    await navigateVisible(tab.id, projectsPage, null);
    await wait(jitter(1000, 1500));

    const directResult = await messageTab(tab.id, {type:'SHINO_DISCOVER_ALL_PROJECTS'}).catch(() => null);
    const direct = mergeProjects(directResult?.projects || []);

    let rowResult = await messageTab(tab.id, {type:'SHINO_V2_DISCOVER_PROJECT_ROWS'}).catch(() => null);
    let labels = (rowResult?.rows || []).map(item => clean(item?.title)).filter(Boolean);
    if (!labels.length) {
      const fallback = await messageTab(tab.id, {type:'SHINO_DISCOVER_PROJECT_LABELS'}).catch(() => null);
      labels = (fallback?.labels || []).map(item => clean(item?.title)).filter(Boolean);
    }
    labels = [...new Map(labels.map(title => [norm(title), title])).values()];

    // Direct routes first: they cost only one project navigation. Then rows that still need recovery.
    const directByTitle = new Map(direct.map(item => [norm(item.title), {...item,url:projectHomeUrl(item.url)}]));
    const targets = [];
    const seen = new Set();
    for (const item of direct) {
      const key = norm(item.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      targets.push({title:item.title,key:item.key || stableProjectId(item.url),url:projectHomeUrl(item.url),routeKnown:true});
    }
    for (const title of labels) {
      const key = norm(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const directItem = directByTitle.get(key);
      targets.push(directItem
        ? {title:directItem.title,key:directItem.key || stableProjectId(directItem.url),url:projectHomeUrl(directItem.url),routeKnown:true}
        : {title,url:null,key:null,routeKnown:false});
    }
    return {direct,labels,targets};
  }

  async function recoverRouteByVisibleRow(tab, projectsPage, title) {
    await navigateVisible(tab.id, projectsPage, null);
    await wait(jitter(900, 1400));
    statusEl.textContent = `Recovering route for ${title}\nClicking its visible Projects row…`;
    const before = (await chrome.tabs.get(tab.id)).url;

    let clicked = await messageTab(tab.id, {type:'SHINO_V2_CLICK_PROJECT_ROW',title}).catch(() => null);
    if (!clicked?.clicked) clicked = await messageTab(tab.id, {type:'SHINO_CLICK_PROJECT_LABEL',title}).catch(() => null);
    if (!clicked?.clicked) throw new Error(`PROJECT_ROW_NOT_CLICKABLE: ${title}`);

    const nav = await waitForNavigation(tab.id, before, url => {
      return isChatGptUrl(url) && /\/g\/g-p-/i.test(url) && !/\/c\//i.test(url);
    }, 10000);
    if (!nav?.url) throw new Error(`PROJECT_ROUTE_NOT_RECOVERED: ${title}`);

    const key = stableProjectId(nav.url);
    if (!key) throw new Error(`PROJECT_ID_NOT_FOUND: ${title}`);
    const project = {title,key,url:projectHomeUrl(nav.url),routeKnown:true};
    await ensureRendered(tab.id, key, true);
    return project;
  }

  async function loadRouteCache() {
    const stored = await chrome.storage.local.get({lastProjectRouteCache:null});
    const cache = stored.lastProjectRouteCache;
    if (cache?.schema !== ROUTE_CACHE_SCHEMA || !Array.isArray(cache.projects)) return new Map();
    return new Map(cache.projects.filter(item => item?.title && item?.url).map(item => [norm(item.title),item]));
  }

  async function saveRouteCache(routeMap) {
    await chrome.storage.local.set({
      lastProjectRouteCache:{
        schema:ROUTE_CACHE_SCHEMA,
        updatedAt:Date.now(),
        projects:[...routeMap.values()]
      }
    });
  }

  function emptyDraft(projectsPage, targets) {
    return {
      schema:DRAFT_SCHEMA,
      createdAt:Date.now(),
      updatedAt:Date.now(),
      projectsPage,
      targets,
      entries:{},
      complete:false,
      lastError:''
    };
  }

  async function loadDraft() {
    const stored = await chrome.storage.local.get({lastSinglePassInventoryDraft:null});
    const draft = stored.lastSinglePassInventoryDraft;
    return draft?.schema === DRAFT_SCHEMA && Array.isArray(draft.targets) ? draft : null;
  }

  async function saveDraft(draft) {
    draft.updatedAt = Date.now();
    await chrome.storage.local.set({lastSinglePassInventoryDraft:draft});
    await refreshInventoryButton(draft);
  }

  function draftProgress(draft) {
    const total = draft?.targets?.length || 0;
    const done = Object.values(draft?.entries || {}).filter(entry => entry?.done).length;
    return {done,total};
  }

  async function refreshInventoryButton(draftArg = undefined) {
    const draft = draftArg === undefined ? await loadDraft() : draftArg;
    const {done,total} = draftProgress(draft);
    if (draft && !draft.complete && total > 0 && done < total) {
      inventoryButton.textContent = `Resume inventory ${done}/${total}`;
      inventoryButton.title = 'Progress was saved. Continue from the first unfinished project; completed projects will not be reopened.';
    } else {
      inventoryButton.textContent = 'Inventory ALL projects (active tab)';
      inventoryButton.title = 'Single-pass inventory: each opened project is scanned immediately and progress is saved after every project.';
    }
  }

  async function setIngestButton(inventory) {
    if (!ingestButton) return;
    const valid = inventory?.schema === INVENTORY_SCHEMA && inventory?.approved && Array.isArray(inventory?.threads) && inventory.threads.length;
    ingestButton.disabled = !valid;
    ingestButton.textContent = valid ? `Ingest ${inventory.threads.length} inventoried chats` : 'Ingest inventoried chats';
  }

  function buildInventoryFromDraft(draft) {
    const entries = Object.values(draft.entries || {}).filter(entry => entry?.done);
    const threads = new Map();
    const owners = new Map();
    const collisions = [];
    const perProject = [];

    for (const entry of entries) {
      const project = entry.project || {title:entry.title,key:entry.projectKey,url:entry.projectUrl};
      const list = Array.isArray(entry.threads) ? entry.threads : [];
      for (const thread of list) {
        const key = thread.key || conversationKey(thread.url);
        const previous = owners.get(key);
        if (previous && previous !== project.title) {
          collisions.push({key,a:previous,b:project.title,title:thread.title});
          continue;
        }
        owners.set(key,project.title);
        if (!threads.has(key)) threads.set(key,{...thread,key});
      }
      perProject.push({title:project.title,total:list.length,projectKey:project.key,diag:entry.diag || {}});
    }

    return {threads,collisions,perProject};
  }

  inventoryButton.onclick = async () => {
    const tab = await activeVisibleChatTab();
    if (!tab) return void(statusEl.textContent='Open ChatGPT in the current selected tab first.');
    const originalUrl = tab.url;
    let restoreOriginal = false;
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void(statusEl.textContent='Turn on Auto-sync this browser first');
      if (typeof shinoGuardButtonRun === 'function' && await shinoGuardButtonRun()) return;

      await setIngestButton(null);
      let draft = await loadDraft();
      let routeMap = await loadRouteCache();

      if (!draft || draft.complete) {
        let projectsPage = `${new URL(originalUrl).origin}/projects`;
        try {
          const info = await messageTab(tab.id,{type:'SHINO_FIND_PROJECTS_PAGE'});
          if (info?.url) projectsPage = info.url;
        } catch {}

        statusEl.textContent = 'SINGLE-PASS INVENTORY\nReading visible Projects index…';
        const index = await readProjectsIndex(tab, projectsPage);
        if (!index.targets.length) throw new Error('No project rows/routes found on Projects index');

        // Merge previously cached routes into the fresh target list by title.
        const targets = index.targets.map(target => {
          const cached = routeMap.get(norm(target.title));
          return cached ? {...target,...cached,routeKnown:true} : target;
        });
        draft = emptyDraft(projectsPage, targets);
        await chrome.storage.local.set({lastActiveTabInventory:null});
        await saveDraft(draft);
      }

      const {done:alreadyDone,total} = draftProgress(draft);
      statusEl.textContent = `SINGLE-PASS INVENTORY\n${alreadyDone}/${total} projects already saved.\nCompleted projects will NOT be reopened.`;
      await wait(900);

      for (let i = 0; i < draft.targets.length; i++) {
        const target = draft.targets[i];
        const titleKey = norm(target.title);
        if (draft.entries?.[titleKey]?.done) continue;

        const progress = draftProgress(draft);
        if (progress.done > 0) {
          const cool = jitter(4200, 6500);
          statusEl.textContent = `SINGLE-PASS INVENTORY ${progress.done}/${progress.total}\nNext: ${target.title}\nSafety pacing ${(cool/1000).toFixed(1)}s…`;
          await wait(cool);
        }

        let project = null;
        const cached = routeMap.get(titleKey);
        if (target.url || cached?.url) {
          project = {...target,...cached,url:projectHomeUrl(cached?.url || target.url),routeKnown:true};
          project.key = stableProjectId(project.url) || project.key;
          statusEl.textContent = `SINGLE-PASS INVENTORY ${progress.done+1}/${progress.total}\n${target.title}\nOpening cached/direct project route…`;
          await navigateVisible(tab.id, project.url, project.key);
        } else {
          statusEl.textContent = `SINGLE-PASS INVENTORY ${progress.done+1}/${progress.total}\n${target.title}\nRecovering route from Projects index…`;
          project = await recoverRouteByVisibleRow(tab, draft.projectsPage, target.title);
        }

        // Crucial v0.6.6 behavior: scan NOW, while this project is already open.
        const scanned = await scanCurrentProject(tab.id, project);
        project = scanned.project;
        routeMap.set(titleKey, project);
        await saveRouteCache(routeMap);

        draft.entries[titleKey] = {
          done:true,
          title:project.title,
          project,
          threads:scanned.threads,
          diag:scanned.diag,
          completedAt:Date.now()
        };
        draft.lastError = '';
        await saveDraft(draft);

        const after = draftProgress(draft);
        statusEl.textContent = `SAVED ${after.done}/${after.total}\n${project.title}: ${scanned.threads.length} conversations\nProgress persisted — this project will not be reopened.`;
      }

      const built = buildInventoryFromDraft(draft);
      if (built.collisions.length) {
        const sample = built.collisions.slice(0,8).map(item => `${item.a} ↔ ${item.b}: ${item.title || item.key}`).join('\n');
        throw new Error(`INVENTORY COLLISION SAFETY STOP\n${sample}`);
      }

      const projectCount = draft.targets.length;
      const nonEmpty = built.perProject.filter(item => item.total > 0).length;
      const minimumHealthy = projectCount >= 10 ? Math.ceil(projectCount * 0.7) : Math.max(1,Math.ceil(projectCount * 0.5));
      const approved = projectCount >= 10 && nonEmpty >= minimumHealthy && built.threads.size > 0;
      const inventory = {
        schema:INVENTORY_SCHEMA,
        createdAt:Date.now(),
        approved,
        projectCount,
        nonEmptyProjects:nonEmpty,
        perProject:built.perProject,
        threads:[...built.threads.values()]
      };

      await chrome.storage.local.set({lastActiveTabInventory:inventory,lastBackfillProjectReport:built.perProject});
      await setIngestButton(inventory);
      draft.complete = true;
      draft.completedAt = Date.now();
      await saveDraft(draft);
      restoreOriginal = true;

      const report = built.perProject.map(item => `${item.title}: ${item.total}`).join(' · ');
      const msg = approved
        ? `SINGLE-PASS INVENTORY COMPLETE — NO INGESTION YET\n${projectCount} projects · ${built.threads.size} unique conversations\n${report}\n\nReview these counts before ingestion.`
        : `SINGLE-PASS INVENTORY SAFETY STOP\n${projectCount} projects · ${nonEmpty} with conversations · ${built.threads.size} unique chats.\nNothing was ingested.\n${report}`;
      statusEl.textContent = msg;
      await chrome.storage.local.set({lastStatus:msg,lastError:approved ? '' : 'Suspicious single-pass inventory coverage'});
    } catch (e) {
      const error = e?.message || String(e);
      const draft = await loadDraft();
      if (draft && !draft.complete) {
        draft.lastError = error;
        draft.lastErrorAt = Date.now();
        await saveDraft(draft);
        const {done,total} = draftProgress(draft);
        statusEl.textContent = `INVENTORY PAUSED — PROGRESS SAVED\n${done}/${total} projects safely stored.\nNothing was ingested.\n${error}\n\nClick “Resume inventory ${done}/${total}” later; completed projects will not be reopened.`;
      } else {
        statusEl.textContent = `ACTIVE-TAB INVENTORY STOPPED\nNothing was ingested.\n${error}`;
      }
      await chrome.storage.local.set({lastStatus:statusEl.textContent,lastError:error});
      // Intentionally do not restore the original page after a render/rate-limit failure.
      // That avoids one more ChatGPT navigation at the exact moment it is unhappy.
    } finally {
      if (restoreOriginal) {
        await wait(1200);
        await chrome.tabs.update(tab.id,{url:originalUrl,active:true}).catch(()=>{});
      }
    }
  };

  refreshInventoryButton().catch(()=>{});
})();
