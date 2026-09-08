// v0.6.3 — deterministic active-tab project inventory + ingestion.
// No hidden/background ChatGPT crawler. The user's currently selected ChatGPT tab is
// navigated visibly, one route at a time. Inventory and ingestion are separate phases.
(() => {
  const statusEl = document.getElementById('status');
  const inventoryButton = document.getElementById('projects');
  const ingestButton = document.getElementById('ingestInventory');
  const retryButton = document.getElementById('retry');

  const INVENTORY_SCHEMA = 'active-tab-inventory-v1';
  const RETRY_SCHEMA = 'active-tab-v1';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const jitter = (min, max) => Math.round(min + Math.random() * Math.max(0, max - min));

  function stableProjectId(url = '') {
    try {
      return new URL(url, 'https://chatgpt.com').pathname
        .match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null;
    } catch { return null; }
  }

  function conversationKey(url = '') {
    try { return new URL(url, 'https://chatgpt.com').pathname.match(/\/c\/([^/?#]+)/i)?.[1] || url; }
    catch { return url; }
  }

  function projectHomeUrl(raw = '') {
    try {
      const u = new URL(raw, 'https://chatgpt.com');
      const m = u.pathname.match(/^\/g\/(g-p-[^/?#]+)/i);
      if (!m) return u.href;
      u.pathname = `/g/${m[1]}/project`;
      u.search = '';
      u.hash = '';
      return u.href;
    } catch { return raw; }
  }

  async function activeVisibleChatTab() {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !isChatGptUrl(tab.url || '')) return null;
    return tab;
  }

  function pageSnapshotInPage() {
    const clean = value => String(value || '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    const bodyText = clean(document.body?.innerText || document.body?.textContent || '');
    const mainText = clean(main?.innerText || main?.textContent || '');
    const controls = [...document.querySelectorAll('button,[role="button"]')]
      .map(el => clean(el.innerText || el.textContent || el.getAttribute('aria-label') || ''))
      .filter(Boolean);
    const exactRetry = controls.find(text => /^(try again|retry|réessayer|reessayer)$/i.test(text)) || '';
    const alertText = [...document.querySelectorAll('[role="alert"],[role="dialog"],[aria-live="assertive"]')]
      .map(el => clean(el.innerText || el.textContent || ''))
      .join(' | ');
    const rateLimited = /too many requests|requests too quickly|temporarily limited access|please wait a few minutes/i.test(alertText);
    const genericError = /something went wrong|unable to load|failed to load|there was an error|we ran into a problem/i.test(alertText || bodyText.slice(0,500));
    const projectKey = (() => {
      try { return location.pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null; }
      catch { return null; }
    })();
    return {
      url:location.href,
      title:document.title,
      visibility:document.visibilityState,
      hasMain:!!main,
      mainChars:mainText.length,
      mainAnchors:main ? main.querySelectorAll('a[href*="/c/"]').length : 0,
      messages:document.querySelectorAll('[data-message-author-role]').length,
      projectKey,
      tryAgain:exactRetry || null,
      rateLimited,
      genericError
    };
  }

  async function snapshot(tabId) {
    const injected = await chrome.scripting.executeScript({target:{tabId},func:pageSnapshotInPage}).catch(() => null);
    return injected?.[0]?.result || null;
  }

  async function reloadActiveTab(tabId) {
    await chrome.tabs.reload(tabId);
    await waitForTab(tabId, 22000);
    await wait(650);
  }

  async function navigateAndEnsure(tabId, url, kind, expectedProjectKey = null) {
    await chrome.tabs.update(tabId,{url,active:true});
    await waitForTab(tabId,22000);
    await wait(550);

    let reloaded = false;
    let hiddenRounds = 0;
    for (let round=0; round<22; round++) {
      const snap = await snapshot(tabId);
      if (!snap) {
        await wait(350);
        continue;
      }

      if (snap.rateLimited) {
        if (typeof shinoArmRateLimit === 'function') await shinoArmRateLimit('Too many requests detected in active-tab run');
        throw new Error('RATE_LIMITED');
      }

      if (snap.tryAgain || snap.genericError && !snap.hasMain) {
        if (reloaded) throw new Error(`RENDER_FAILED_TRY_AGAIN${snap.tryAgain ? `: ${snap.tryAgain}` : ''}`);
        statusEl.textContent = `ChatGPT render failed (${snap.tryAgain || 'page error'}).\nOne clean reload…`;
        await reloadActiveTab(tabId);
        reloaded = true;
        continue;
      }

      if (snap.visibility !== 'visible') {
        hiddenRounds++;
        if (hiddenRounds >= 5) throw new Error('ACTIVE_TAB_NOT_VISIBLE — keep the driven ChatGPT tab selected');
        await wait(400);
        continue;
      }
      hiddenRounds = 0;

      let ready = false;
      if (kind === 'projects') ready = snap.hasMain && snap.mainChars >= 20;
      if (kind === 'project') ready = snap.hasMain && snap.projectKey === expectedProjectKey && snap.mainChars >= 20;
      if (kind === 'conversation') ready = snap.hasMain && /\/c\//i.test(snap.url || '') && (snap.messages > 0 || snap.mainChars >= 80);
      if (ready) return snap;
      await wait(400);
    }

    if (!reloaded) {
      statusEl.textContent = 'Page did not finish rendering. One clean reload…';
      await reloadActiveTab(tabId);
      reloaded = true;
      for (let round=0; round<12; round++) {
        const snap = await snapshot(tabId);
        if (snap?.tryAgain) throw new Error(`RENDER_FAILED_TRY_AGAIN: ${snap.tryAgain}`);
        if (snap?.rateLimited) throw new Error('RATE_LIMITED');
        if (snap?.visibility === 'visible') {
          if (kind === 'projects' && snap.hasMain && snap.mainChars >= 20) return snap;
          if (kind === 'project' && snap.hasMain && snap.projectKey === expectedProjectKey && snap.mainChars >= 20) return snap;
          if (kind === 'conversation' && snap.hasMain && /\/c\//i.test(snap.url || '') && (snap.messages > 0 || snap.mainChars >= 80)) return snap;
        }
        await wait(450);
      }
    }
    throw new Error(`RENDER_NOT_READY (${kind})`);
  }

  async function projectAnchorsInPage() {
    const waitLocal = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = value => String(value || '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
    const stableId = url => {
      try { return new URL(url,location.origin).pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null; }
      catch { return null; }
    };
    const convKey = url => {
      try { return new URL(url,location.origin).pathname.match(/\/c\/([^/?#]+)/i)?.[1] || url; }
      catch { return url; }
    };
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    const projectKey = stableId(location.href);
    if (!main) return {projectKey,direct:[],diag:{reason:'no-main'}};
    const found = new Map();
    let scanned = 0;
    let wrongProject = 0;

    const scan = () => {
      for (const a of main.querySelectorAll('a[href*="/c/"]')) {
        const raw = a.href || a.getAttribute('href') || '';
        if (!raw) continue;
        let url;
        try { url = new URL(raw,location.origin).href; } catch { continue; }
        const owner = stableId(url);
        scanned++;
        if (projectKey && owner !== projectKey) { wrongProject++; continue; }
        const key = convKey(url);
        const title = clean(a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || 'ChatGPT conversation');
        if (!found.has(key)) found.set(key,{key,title:title.slice(0,180),url});
      }
    };

    const roots = [];
    for (const el of [main,...main.querySelectorAll('[role="tabpanel"],div,section')]) {
      const delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
      const oy = getComputedStyle(el).overflowY;
      if (delta > 80 && (el === main || oy === 'auto' || oy === 'scroll')) roots.push(el);
    }
    const scrollRoots = [...new Set(roots)]
      .sort((a,b)=>((b.scrollHeight||0)-(b.clientHeight||0))-((a.scrollHeight||0)-(a.clientHeight||0)))
      .slice(0,4);
    const originals = scrollRoots.map(root=>({root,top:root.scrollTop}));

    scan();
    try {
      for (const root of scrollRoots) {
        root.scrollTop = 0;
        await waitLocal(160);
        let last = -1;
        for (let pass=0; pass<45; pass++) {
          scan();
          const max = root.scrollHeight || 0;
          const view = root.clientHeight || 0;
          const pos = root.scrollTop || 0;
          if (pos + view >= max - 8 || Math.round(pos) === last) break;
          last = Math.round(pos);
          root.scrollTop = Math.min(max,pos + Math.max(240,view * 0.72));
          await waitLocal(170);
        }
        scan();
      }
    } finally {
      for (const item of originals) item.root.scrollTop = item.top;
    }

    return {
      projectKey,
      direct:[...found.values()].slice(0,240),
      diag:{strategy:'active-main-anchors',scanned,accepted:found.size,wrongProject,scrollRoots:scrollRoots.length}
    };
  }

  async function discoverProjectsInActiveTab(tab, originalUrl) {
    let projectsPage = `${new URL(originalUrl).origin}/projects`;
    try {
      const info = await messageTab(tab.id,{type:'SHINO_FIND_PROJECTS_PAGE'});
      if (info?.url) projectsPage = info.url;
    } catch {}

    statusEl.textContent = 'ACTIVE-TAB PHASE 1/2\nOpening the real ChatGPT Projects index…';
    await navigateAndEnsure(tab.id,projectsPage,'projects');
    let result = await messageTab(tab.id,{type:'SHINO_DISCOVER_ALL_PROJECTS'}).catch(() => null);
    let projects = mergeProjects(result?.projects || []);
    if (projects.length < 2) {
      await wait(1200);
      result = await messageTab(tab.id,{type:'SHINO_DISCOVER_ALL_PROJECTS'}).catch(() => null);
      projects = mergeProjects(projects,result?.projects || []);
    }
    return {projects,projectsPage};
  }

  async function updateInventoryButton() {
    if (!ingestButton) return;
    const stored = await chrome.storage.local.get({lastActiveTabInventory:null});
    const inv = stored.lastActiveTabInventory;
    const valid = inv?.schema === INVENTORY_SCHEMA && inv?.approved && Array.isArray(inv?.threads) && inv.threads.length;
    ingestButton.disabled = !valid;
    ingestButton.textContent = valid ? `Ingest ${inv.threads.length} inventoried chats` : 'Ingest inventoried chats';
    ingestButton.title = valid
      ? `Inventory from ${new Date(inv.createdAt).toLocaleString()} · ${inv.projectCount} projects`
      : 'Run a healthy active-tab inventory first.';
  }

  async function saveRetryQueue(list) {
    await chrome.storage.local.set({lastFailedBackfill:list,lastFailedBackfillSchema:RETRY_SCHEMA});
    if (typeof shinoRefreshRetryButton === 'function') await shinoRefreshRetryButton();
  }

  async function ingestQueueInActiveTab(tab, queue, label) {
    const counts = {mapped:0,discovered:0,failed:0};
    const failed = [];
    let stopped = false;

    for (let i=0; i<queue.length; i++) {
      const thread = queue[i];
      if (i > 0) {
        const delay = jitter(3200,5200);
        statusEl.textContent = `${label} ${i}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}\nActive-tab pacing ${(delay/1000).toFixed(1)}s…`;
        await wait(delay);
        if (i % 8 === 0) {
          const cool = jitter(9000,14000);
          statusEl.textContent += `\nSafety cooldown ${(cool/1000).toFixed(0)}s…`;
          await wait(cool);
        }
      }

      let failure = null;
      let hardStop = false;
      try {
        await navigateAndEnsure(tab.id,thread.url,'conversation');
        let out = await captureTab(await chrome.tabs.get(tab.id),label === 'Retry' ? 'retry-failed-backfill' : 'all-project-backfill',{
          projectKey:thread.projectKey,
          projectTitle:thread.projectTitle,
          projectUrl:thread.projectUrl
        });
        if (!out?.ok && /capture unavailable|no readable/i.test(String(out?.error || ''))) {
          await wait(1200);
          out = await captureTab(await chrome.tabs.get(tab.id),label === 'Retry' ? 'retry-failed-backfill' : 'all-project-backfill',{
            projectKey:thread.projectKey,
            projectTitle:thread.projectTitle,
            projectUrl:thread.projectUrl
          });
        }
        if (out?.ok) out.body?.discovered ? counts.discovered++ : counts.mapped++;
        else failure = out?.error || 'capture failed';
      } catch (e) {
        failure = e?.message || String(e);
        hardStop = /RATE_LIMITED|RENDER_FAILED|RENDER_NOT_READY|ACTIVE_TAB_NOT_VISIBLE/i.test(failure);
      }

      if (failure) {
        counts.failed++;
        failed.push({...thread,lastError:failure});
      }

      if (hardStop) {
        const rest = queue.slice(i+1).map(item=>({...item,lastError:'DEFERRED_AFTER_SAFETY_STOP'}));
        failed.push(...rest);
        counts.failed += rest.length;
        stopped = true;
        statusEl.textContent = `ACTIVE-TAB SAFETY STOP\n${i+1}/${queue.length} attempted · ${counts.mapped} mapped · ${counts.discovered} discovered\n${failed.length} queued for Retry.\n${failure}`;
        break;
      }

      statusEl.textContent = `${label} ${i+1}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
    }

    await saveRetryQueue(failed);
    return {counts,failed,stopped};
  }

  if (inventoryButton) inventoryButton.onclick = async () => {
    const tab = await activeVisibleChatTab();
    if (!tab) return void(statusEl.textContent='Open ChatGPT in the current selected tab first.');
    const originalUrl = tab.url;
    let shouldRestore = true;
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void(statusEl.textContent='Turn on Auto-sync this browser first');
      if (typeof shinoGuardButtonRun === 'function' && await shinoGuardButtonRun()) return;

      const {projects} = await discoverProjectsInActiveTab(tab,originalUrl);
      if (!projects.length) throw new Error('No project routes found on the visible Projects index');

      const threads = new Map();
      const owners = new Map();
      const collisions = [];
      const perProject = [];
      statusEl.textContent = `ACTIVE-TAB PHASE 2/2\n${projects.length} project routes found.\nReading each project visibly…`;

      for (let i=0; i<projects.length; i++) {
        const project = projects[i];
        const home = projectHomeUrl(project.url);
        const expectedKey = stableProjectId(home) || project.key || null;
        statusEl.textContent = `ACTIVE-TAB INVENTORY ${i+1}/${projects.length}\n${project.title}\nNavigating visible ChatGPT tab…`;
        await navigateAndEnsure(tab.id,home,'project',expectedKey);
        const injected = await chrome.scripting.executeScript({target:{tabId:tab.id},func:projectAnchorsInPage});
        const result = injected?.[0]?.result || {direct:[],diag:{reason:'no-result'}};
        const ctx = {projectKey:expectedKey || result.projectKey,projectTitle:project.title,projectUrl:home};
        const list = (result.direct || []).map(item=>({...item,...ctx}));

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
        perProject.push({title:project.title,total:list.length,projectKey:ctx.projectKey,diag:result.diag});
        statusEl.textContent = `ACTIVE-TAB INVENTORY ${i+1}/${projects.length}\n${project.title}: ${list.length}\nTOTAL UNIQUE: ${threads.size}`;
      }

      const report = perProject.map(item=>`${item.title}: ${item.total}`).join(' · ');
      if (collisions.length) {
        const sample = collisions.slice(0,8).map(item=>`${item.a} ↔ ${item.b}: ${item.title || item.key}`).join('\n');
        throw new Error(`INVENTORY COLLISION SAFETY STOP\n${sample}`);
      }

      const nonEmpty = perProject.filter(item=>item.total>0).length;
      const minimumHealthy = projects.length >= 10 ? Math.ceil(projects.length * 0.7) : Math.max(1,Math.ceil(projects.length * 0.5));
      const approved = nonEmpty >= minimumHealthy && threads.size > 0;
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
      await updateInventoryButton();

      if (!approved) {
        const msg = `ACTIVE-TAB INVENTORY SAFETY STOP\n${projects.length} projects · ${nonEmpty} with conversations · ${threads.size} unique chats.\nNothing was ingested.\n${report}`;
        statusEl.textContent = msg;
        await chrome.storage.local.set({lastStatus:msg,lastError:'Suspicious active-tab inventory coverage'});
        return;
      }

      const msg = `ACTIVE-TAB INVENTORY COMPLETE — NO INGESTION YET\n${projects.length} projects · ${threads.size} unique conversations\n${report}\n\nReview these counts. If they look right, click “Ingest ${threads.size} inventoried chats”.`;
      statusEl.textContent = msg;
      await chrome.storage.local.set({lastStatus:msg,lastError:''});
    } catch (e) {
      const error = e?.message || String(e);
      statusEl.textContent = `ACTIVE-TAB INVENTORY STOPPED\nNothing was ingested.\n${error}`;
      await chrome.storage.local.set({lastStatus:statusEl.textContent,lastError:error});
      if (/RATE_LIMITED/.test(error)) shouldRestore = false;
    } finally {
      if (shouldRestore) {
        await chrome.tabs.update(tab.id,{url:originalUrl,active:true}).catch(()=>{});
      }
    }
  };

  if (ingestButton) ingestButton.onclick = async () => {
    const tab = await activeVisibleChatTab();
    if (!tab) return void(statusEl.textContent='Open ChatGPT in the current selected tab first.');
    const originalUrl = tab.url;
    let shouldRestore = true;
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void(statusEl.textContent='Turn on Auto-sync this browser first');
      if (typeof shinoGuardButtonRun === 'function' && await shinoGuardButtonRun()) return;
      const stored = await chrome.storage.local.get({lastActiveTabInventory:null});
      const inv = stored.lastActiveTabInventory;
      if (inv?.schema !== INVENTORY_SCHEMA || !inv?.approved || !Array.isArray(inv?.threads) || !inv.threads.length) {
        return void(statusEl.textContent='No healthy active-tab inventory available. Run Inventory ALL projects first.');
      }
      statusEl.textContent = `Starting ACTIVE-TAB ingestion\n${inv.threads.length} inventoried conversations · ${inv.projectCount} projects`;
      const result = await ingestQueueInActiveTab(tab,inv.threads,'Backfill');
      const final = result.stopped
        ? statusEl.textContent
        : `ACTIVE-TAB BACKFILL COMPLETE\n${inv.projectCount} projects · ${inv.threads.length} conversations\n${result.counts.mapped} mapped · ${result.counts.discovered} discovered · ${result.counts.failed} failed${result.failed.length ? `\nRetry armed for ${result.failed.length}` : ''}`;
      statusEl.textContent = final;
      await chrome.storage.local.set({lastStatus:final,lastError:''});
      if (result.stopped && result.failed.some(item=>/RATE_LIMITED/.test(item.lastError || ''))) shouldRestore = false;
    } catch (e) {
      const error = e?.message || String(e);
      statusEl.textContent = 'Active-tab ingestion failed: ' + error;
      if (/RATE_LIMITED/.test(error)) shouldRestore = false;
    } finally {
      if (shouldRestore) await chrome.tabs.update(tab.id,{url:originalUrl,active:true}).catch(()=>{});
    }
  };

  if (retryButton) retryButton.onclick = async () => {
    const tab = await activeVisibleChatTab();
    if (!tab) return void(statusEl.textContent='Open ChatGPT in the current selected tab first.');
    const originalUrl = tab.url;
    let shouldRestore = true;
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void(statusEl.textContent='Turn on Auto-sync this browser first');
      if (typeof shinoGuardButtonRun === 'function' && await shinoGuardButtonRun()) return;
      const stored = await chrome.storage.local.get({lastFailedBackfill:[],lastFailedBackfillSchema:''});
      const queue = stored.lastFailedBackfillSchema === RETRY_SCHEMA ? (stored.lastFailedBackfill || []) : [];
      if (!queue.length) return void(statusEl.textContent='No compatible active-tab failures to retry');
      statusEl.textContent = `Retrying ${queue.length} failures in the selected ChatGPT tab…`;
      const result = await ingestQueueInActiveTab(tab,queue,'Retry');
      const final = result.stopped
        ? statusEl.textContent
        : `ACTIVE-TAB RETRY COMPLETE\n${queue.length} attempted · ${result.counts.mapped} mapped · ${result.counts.discovered} discovered · ${result.counts.failed} still failed${result.failed.length ? `\n${result.failed.slice(0,6).map(item=>item.title || item.url).join(' · ')}` : ''}`;
      statusEl.textContent = final;
      await chrome.storage.local.set({lastStatus:final,lastError:''});
      if (result.stopped && result.failed.some(item=>/RATE_LIMITED/.test(item.lastError || ''))) shouldRestore = false;
    } catch (e) {
      const error = e?.message || String(e);
      statusEl.textContent = 'Active-tab retry failed: ' + error;
      if (/RATE_LIMITED/.test(error)) shouldRestore = false;
    } finally {
      if (shouldRestore) await chrome.tabs.update(tab.id,{url:originalUrl,active:true}).catch(()=>{});
    }
  };

  updateInventoryButton().catch(()=>{});
})();
