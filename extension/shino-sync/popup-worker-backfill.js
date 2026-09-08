// v0.6.2 — single visible worker window for project inventory + ingestion.
// ChatGPT project <main> anchors render reliably in a selected tab, but not necessarily
// in inactive/background tabs. Keep one selected tab in an unfocused worker window and
// navigate it sequentially. This also prevents tab storms and gives Retry the same renderer.
(() => {
  const $status = document.getElementById('status');
  const $projects = document.getElementById('projects');
  const $retry = document.getElementById('retry');
  const RETRY_SCHEMA = 'main-anchor-v1';

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  async function createWorker(url) {
    const created = await chrome.windows.create({
      url,
      focused:false,
      type:'normal',
      width:1400,
      height:900
    });
    const tab = created.tabs?.[0] || (await chrome.tabs.query({windowId:created.id}))[0];
    if (!created.id || !tab?.id) throw new Error('Could not create ChatGPT worker window');
    await waitForTab(tab.id);
    return { windowId:created.id, tabId:tab.id };
  }

  async function closeWorker(worker) {
    if (worker?.windowId) await chrome.windows.remove(worker.windowId).catch(() => {});
  }

  async function navigateWorker(worker, url) {
    await chrome.tabs.update(worker.tabId, {url});
    await waitForTab(worker.tabId);
    await wait(550);
    return chrome.tabs.get(worker.tabId);
  }

  async function visibleMainSnapshot(tabId) {
    const injected = await chrome.scripting.executeScript({
      target:{tabId},
      func:() => {
        const main = document.querySelector('main') || document.querySelector('[role="main"]');
        const text = String(main?.innerText || main?.textContent || '').replace(/\s+/g,' ').trim();
        return {
          visibility:document.visibilityState,
          hasMain:!!main,
          chars:text.length,
          anchors:main ? main.querySelectorAll('a[href*="/c/"]').length : 0,
          url:location.href,
          title:document.title
        };
      }
    }).catch(() => null);
    return injected?.[0]?.result || {visibility:'unknown',hasMain:false,chars:0,anchors:0};
  }

  async function scanProjectOnWorker(worker, project) {
    const home = projectHomeUrl(project.url);
    await navigateWorker(worker, home);

    let snapshot = null;
    for (let i=0; i<9; i++) {
      const limited = await shinoRateLimitOnTab(worker.tabId).catch(() => null);
      if (limited) {
        await shinoArmRateLimit(limited.text || 'Too many requests during worker inventory');
        throw new Error('RATE_LIMITED during project inventory');
      }
      snapshot = await visibleMainSnapshot(worker.tabId);
      if (snapshot?.anchors > 0) break;
      await wait(420);
    }

    const injected = await chrome.scripting.executeScript({
      target:{tabId:worker.tabId},
      func:shinoMainProjectAnchorsInPage,
      args:[project.title]
    });
    const result = injected?.[0]?.result || {direct:[],rows:[],diag:{reason:'no-result'}};
    const stable = shinoStableProjectId(home) || result.projectKey || project.key || null;
    const ctx = { projectKey:stable, projectTitle:project.title, projectUrl:home };
    return {
      direct:(result.direct || []).map(thread => ({...thread,...ctx})),
      rows:[],
      diag:{...(result.diag || {}), workerSnapshot:snapshot, workerHome:home}
    };
  }

  async function discoverProjectsForWorker() {
    const seed = await activeChatTab();
    if (!seed) throw new Error('Open ChatGPT first');
    const pageInfo = await messageTab(seed.id,{type:'SHINO_FIND_PROJECTS_PAGE'}).catch(() => null);
    const projectsPage = pageInfo?.url || `${new URL(seed.url).origin}/projects`;
    let directProjects = [];
    await withTemporaryTab(projectsPage, async tab => {
      const result = await messageTab(tab.id,{type:'SHINO_DISCOVER_ALL_PROJECTS'}).catch(() => null);
      directProjects = result?.projects || [];
    });
    const rowRecovery = await shinoDiscoverProjectUrlsByRows(projectsPage,directProjects).catch(() => ({rows:[],projects:[]}));
    let projects = mergeProjects(directProjects,rowRecovery.projects || []);
    if (!projects.length) {
      const fallback = await messageTab(seed.id,{type:'SHINO_DISCOVER_PINNED_PROJECTS'}).catch(() => null);
      projects = mergeProjects(fallback?.projects || []);
    }
    return projects;
  }

  async function saveRetryQueue(list) {
    await chrome.storage.local.set({
      lastFailedBackfill:list,
      lastFailedBackfillSchema:RETRY_SCHEMA
    });
    if (typeof shinoRefreshRetryButton === 'function') await shinoRefreshRetryButton();
    else if (typeof shinoSetRetryState === 'function') await shinoSetRetryState(list);
  }

  async function ingestOnWorker(worker, queue, label='Backfill') {
    const counts = {mapped:0,discovered:0,failed:0};
    const failedThreads = [];
    let done = 0;

    for (let i=0; i<queue.length; i++) {
      const thread = queue[i];
      if (i > 0) {
        const delay = typeof shinoJitter === 'function' ? shinoJitter(2700,4200) : 3300;
        $status.textContent = `${label} ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}\nWorker pacing ${(delay/1000).toFixed(1)}s…`;
        await wait(delay);
      }

      let failure = null;
      let limited = false;
      try {
        await navigateWorker(worker, thread.url);
        const rl = await shinoRateLimitOnTab(worker.tabId).catch(() => null);
        if (rl) {
          limited = true;
          failure = rl.text || 'RATE_LIMITED';
        } else {
          let out = await captureTab(await chrome.tabs.get(worker.tabId), label === 'Retry' ? 'retry-failed-backfill' : 'all-project-backfill', {
            projectKey:thread.projectKey,
            projectTitle:thread.projectTitle,
            projectUrl:thread.projectUrl
          });
          // A selected worker tab can still need one extra render beat for a long transcript.
          if (!out?.ok && /capture unavailable|no readable/i.test(String(out?.error || ''))) {
            await wait(1200);
            out = await captureTab(await chrome.tabs.get(worker.tabId), label === 'Retry' ? 'retry-failed-backfill' : 'all-project-backfill', {
              projectKey:thread.projectKey,
              projectTitle:thread.projectTitle,
              projectUrl:thread.projectUrl
            });
          }
          if (out?.ok) out.body?.discovered ? counts.discovered++ : counts.mapped++;
          else failure = out?.error || 'capture failed';
        }
      } catch (e) {
        failure = e?.message || String(e);
        limited = /RATE_LIMITED|too many requests|temporarily limited/i.test(failure);
      }

      done++;
      if (failure) {
        counts.failed++;
        failedThreads.push({...thread,lastError:failure});
      }

      if (limited) {
        const rest = queue.slice(i+1).map(t => ({...t,lastError:'DEFERRED_AFTER_RATE_LIMIT'}));
        failedThreads.push(...rest);
        counts.failed += rest.length;
        await shinoArmRateLimit(failure || 'Too many requests');
        $status.textContent = `RATE LIMIT DETECTED — WORKER STOPPED SAFELY\n${done}/${queue.length} attempted · ${counts.mapped} mapped · ${counts.discovered} discovered\n${failedThreads.length} queued for retry.`;
        break;
      }

      $status.textContent = `${label} ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
    }

    await saveRetryQueue(failedThreads);
    return {counts,failedThreads};
  }

  if ($projects) $projects.onclick = async () => {
    let worker = null;
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void ($status.textContent='Turn on Auto-sync this browser first');
      if (typeof shinoGuardButtonRun === 'function' && await shinoGuardButtonRun()) return;

      $status.textContent = 'Recovering ChatGPT project routes…';
      const projects = await discoverProjectsForWorker();
      if (!projects.length) return void ($status.textContent='No project routes recovered.');

      $status.textContent = `WORKER PROJECT INVENTORY: ${projects.length}\nCreating one selected ChatGPT worker tab…`;
      worker = await createWorker(projectHomeUrl(projects[0].url));

      const threads = new Map();
      const owners = new Map();
      const collisions = [];
      const perProject = [];

      for (let i=0; i<projects.length; i++) {
        const project = projects[i];
        let inv;
        try {
          inv = await scanProjectOnWorker(worker,project);
        } catch (e) {
          if (/RATE_LIMITED/.test(String(e?.message || e))) throw e;
          inv = {direct:[],diag:{error:e?.message || String(e)}};
        }
        for (const thread of inv.direct || []) {
          const key = thread.key || conversationKeyFromUrl(thread.url);
          const previous = owners.get(key);
          if (previous && previous !== project.title) {
            collisions.push({key,a:previous,b:project.title,title:thread.title});
            continue;
          }
          owners.set(key,project.title);
          if (!threads.has(key)) threads.set(key,thread);
        }
        perProject.push({title:project.title,total:(inv.direct || []).length,direct:(inv.direct || []).length,recovered:0,rows:0,diag:inv.diag});
        $status.textContent = `WORKER INVENTORY ${i+1}/${projects.length}\n${project.title}: ${(inv.direct || []).length}\nTOTAL UNIQUE: ${threads.size}`;
      }

      const report = perProject.map(x=>`${x.title}: ${x.total}`).join(' · ');
      if (collisions.length) {
        const sample = collisions.slice(0,8).map(c=>`${c.a} ↔ ${c.b}: ${c.title || c.key}`).join('\n');
        const msg = `INVENTORY SAFETY STOP — ${collisions.length} cross-project collisions.\nNothing was ingested.\n${sample}\n${report}`;
        $status.textContent = msg;
        await chrome.storage.local.set({lastStatus:msg,lastError:'Cross-project inventory contamination',lastBackfillProjectReport:perProject});
        return;
      }

      const nonEmpty = perProject.filter(x=>x.total>0).length;
      const minimumHealthy = projects.length >= 10 ? Math.ceil(projects.length * 0.6) : Math.max(1,Math.ceil(projects.length * 0.5));
      if (nonEmpty < minimumHealthy) {
        const msg = `INVENTORY RENDER SAFETY STOP\n${projects.length} projects · only ${nonEmpty} rendered with conversations · ${threads.size} unique threads.\nNothing was ingested.\n${report}`;
        $status.textContent = msg;
        await chrome.storage.local.set({lastStatus:msg,lastError:'Too many empty project renders',lastBackfillProjectReport:perProject});
        return;
      }

      const queue = [...threads.values()].slice(0,400);
      if (!queue.length) return void ($status.textContent=`${projects.length} projects recovered, but 0 worker conversation routes found.\n${report}`);

      $status.textContent = `WORKER INVENTORY COMPLETE: ${queue.length} unique conversations\n${report}\nStarting sequential ingestion in the same worker…`;
      await wait(700);
      const {counts,failedThreads} = await ingestOnWorker(worker,queue,'Backfill');
      const final = `ALL-project worker backfill complete\n${projects.length} projects · ${queue.length} unique conversations\n${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed\n${report}${failedThreads.length ? `\nRetry armed for ${failedThreads.length} failures` : ''}`;
      $status.textContent = final;
      await chrome.storage.local.set({lastStatus:final,lastError:'',lastBackfillProjectReport:perProject});
    } catch (e) {
      $status.textContent = 'Worker backfill failed: ' + (e?.message || String(e));
    } finally {
      await closeWorker(worker);
    }
  };

  if ($retry) $retry.onclick = async () => {
    let worker = null;
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void ($status.textContent='Turn on Auto-sync this browser first');
      if (typeof shinoGuardButtonRun === 'function' && await shinoGuardButtonRun()) return;
      const stored = await chrome.storage.local.get({lastFailedBackfill:[],lastFailedBackfillSchema:''});
      const queue = stored.lastFailedBackfillSchema === RETRY_SCHEMA ? (stored.lastFailedBackfill || []) : [];
      if (!queue.length) return void ($status.textContent='No compatible failed conversations to retry');
      worker = await createWorker(queue[0].url);
      $status.textContent = `Retrying ${queue.length} failed conversations in visible worker…`;
      const {counts,failedThreads} = await ingestOnWorker(worker,queue,'Retry');
      const final = `FAILED-ONLY WORKER RETRY COMPLETE\n${queue.length} attempted · ${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} still failed${failedThreads.length ? `\n${failedThreads.slice(0,6).map(t=>t.title || t.url).join(' · ')}` : ''}`;
      $status.textContent = final;
      await chrome.storage.local.set({lastStatus:final,lastError:''});
    } catch (e) {
      $status.textContent = 'Worker retry failed: ' + (e?.message || String(e));
    } finally {
      await closeWorker(worker);
    }
  };
})();
