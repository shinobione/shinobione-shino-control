// v0.5.5 thread-inventory override. Loaded after popup-patch.js.

function shinoMergeThreads(...lists) {
  const out = new Map();
  for (const list of lists) {
    for (const thread of list || []) {
      if (!thread?.url) continue;
      const key = conversationKeyFromUrl(thread.url) || thread.key || thread.url;
      if (!out.has(key)) out.set(key, { ...thread, key });
    }
  }
  return [...out.values()];
}

async function shinoThreadInventoryForProject(project) {
  let direct = [];
  let rows = [];
  await withTemporaryTab(project.url, async tab => {
    await sleep(850);
    const legacy = await messageTab(tab.id, { type:'SHINO_DISCOVER_PROJECT_THREADS' }).catch(() => null);
    const v3 = await messageTab(tab.id, { type:'SHINO_V3_DISCOVER_THREADS', projectTitle:project.title }).catch(() => null);
    const ctx = {
      projectKey: project.key || v3?.projectKey || legacy?.context?.projectKey || projectKeyFromUrl(project.url),
      projectTitle: project.title || legacy?.context?.projectTitle || null,
      projectUrl: project.url || legacy?.context?.projectUrl || null
    };
    const legacyDirect = (legacy?.threads || []).map(t => ({ ...t, ...ctx }));
    const v3Direct = (v3?.direct || []).map(t => ({ ...t, ...ctx }));
    direct = shinoMergeThreads(legacyDirect, v3Direct);
    rows = v3?.rows || [];
  });
  return { direct, rows };
}

async function shinoRecoverThreadRows(project, rows, directThreads = []) {
  if (!rows?.length) return [];
  const knownTitles = new Set((directThreads || []).map(t => norm(t.title)).filter(Boolean));
  const candidates = rows.filter(r => !knownTitles.has(norm(r.title))).slice(0, 90);
  if (!candidates.length) return [];

  const worker = await chrome.tabs.create({ url: project.url, active:false });
  const recovered = new Map();
  const expectedProjectKey = project.key || projectKeyFromUrl(project.url);
  try {
    await waitForTab(worker.id);
    let attempted = 0;
    for (const row of candidates) {
      if (attempted > 0) {
        await chrome.tabs.update(worker.id, { url:project.url });
        await waitForTab(worker.id).catch(() => null);
        await sleep(450);
      }
      const before = (await chrome.tabs.get(worker.id)).url;
      const clicked = await messageTab(worker.id, { type:'SHINO_V3_CLICK_THREAD', title:row.title, projectTitle:project.title }).catch(() => null);
      attempted++;
      if (!clicked?.clicked) continue;

      const nav = await waitForNavigation(worker.id, before, url => isChatGptUrl(url) && /\/c\//i.test(url), 4800);
      if (!nav?.url) continue;
      const explicitProjectKey = projectKeyFromUrl(nav.url);
      if (expectedProjectKey && explicitProjectKey && explicitProjectKey !== expectedProjectKey) continue;
      const key = conversationKeyFromUrl(nav.url);
      if (!recovered.has(key)) {
        recovered.set(key, {
          key,
          title:row.title,
          url:nav.url,
          projectKey:expectedProjectKey,
          projectTitle:project.title,
          projectUrl:project.url
        });
      }
    }
    return [...recovered.values()];
  } finally {
    await chrome.tabs.remove(worker.id).catch(() => {});
  }
}

async function shinoSetRetryState(failedThreads = null) {
  const retry = $('retry');
  if (!retry) return;
  let list = failedThreads;
  if (!list) {
    const stored = await chrome.storage.local.get({ lastFailedBackfill:[] });
    list = stored.lastFailedBackfill || [];
  }
  retry.disabled = !list.length;
  retry.textContent = list.length ? `Retry ${list.length} failed only` : 'Retry failed only';
}

async function shinoIngestQueue(queue, label = 'Backfill') {
  const counts = { mapped:0, discovered:0, failed:0 };
  const failedThreads = [];
  let done = 0;

  for (const thread of queue) {
    let failure = null;
    try {
      await withTemporaryTab(thread.url, async tab => {
        const out = await captureTab(tab, label === 'Retry' ? 'retry-failed-backfill' : 'all-project-backfill', {
          projectKey:thread.projectKey,
          projectTitle:thread.projectTitle,
          projectUrl:thread.projectUrl
        });
        if (out?.ok) out.body?.discovered ? counts.discovered++ : counts.mapped++;
        else failure = out?.error || 'capture failed';
      });
    } catch (e) {
      failure = e?.message || String(e);
    }
    if (failure) {
      counts.failed++;
      failedThreads.push({ ...thread, lastError:failure });
    }
    done++;
    $('status').textContent = `${label} ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
  }

  await chrome.storage.local.set({ lastFailedBackfill:failedThreads });
  await shinoSetRetryState(failedThreads);
  return { counts, failedThreads };
}

const retryButton = $('retry');
if (retryButton) {
  retryButton.onclick = async () => {
    try {
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void ($('status').textContent = 'Turn on Auto-sync this browser first');
      const stored = await chrome.storage.local.get({ lastFailedBackfill:[] });
      const queue = stored.lastFailedBackfill || [];
      if (!queue.length) return void ($('status').textContent = 'No failed conversations to retry');
      $('status').textContent = `Retrying ${queue.length} failed conversations only…`;
      const { counts, failedThreads } = await shinoIngestQueue(queue, 'Retry');
      const final = `FAILED-ONLY RETRY COMPLETE\n${queue.length} attempted · ${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} still failed${failedThreads.length ? `\n${failedThreads.slice(0,6).map(t => t.title || t.url).join(' · ')}` : ''}`;
      $('status').textContent = final;
      await chrome.storage.local.set({ lastStatus:final, lastError:'' });
    } catch (e) {
      $('status').textContent = 'Retry failed: ' + (e.message || String(e));
    }
  };
  shinoSetRetryState().catch(() => {});
}

$('projects').onclick = async () => {
  try {
    const cfg = await readUiAndSave();
    if (!cfg.enabled) return void ($('status').textContent = 'Turn on Auto-sync this browser first');
    const seed = await activeChatTab();
    if (!seed) return void ($('status').textContent = 'Open ChatGPT first');

    $('status').textContent = 'Opening full ChatGPT Projects index…';
    const pageInfo = await messageTab(seed.id, { type:'SHINO_FIND_PROJECTS_PAGE' }).catch(() => null);
    const projectsPage = pageInfo?.url || `${new URL(seed.url).origin}/projects`;

    let directProjects = [];
    await withTemporaryTab(projectsPage, async tab => {
      const result = await messageTab(tab.id, { type:'SHINO_DISCOVER_ALL_PROJECTS' }).catch(() => null);
      directProjects = result?.projects || [];
    });

    const rowRecovery = await shinoDiscoverProjectUrlsByRows(projectsPage, directProjects).catch(() => ({ rows:[], projects:[] }));
    const domProjects = rowRecovery.projects || [];
    let projects = mergeProjects(directProjects, domProjects);
    if (!projects.length) {
      const fallback = await messageTab(seed.id, { type:'SHINO_DISCOVER_PINNED_PROJECTS' }).catch(() => null);
      projects = mergeProjects(fallback?.projects || []);
    }
    if (!projects.length) return void ($('status').textContent = 'No project routes recovered. Send me this popup screenshot.');

    const inventoryNames = projects.map(p => p.title).join(' · ');
    $('status').textContent = `PROJECT INVENTORY OK: ${projects.length}\n${inventoryNames}`;
    await sleep(700);

    const threads = new Map();
    const perProject = [];
    let projectDone = 0;

    for (const project of projects) {
      let inv = { direct:[], rows:[] };
      try { inv = await shinoThreadInventoryForProject(project); } catch {}

      let recovered = [];
      if (inv.rows.length) recovered = await shinoRecoverThreadRows(project, inv.rows, inv.direct).catch(() => []);

      const merged = shinoMergeThreads(inv.direct, recovered);
      for (const thread of merged) if (!threads.has(thread.key)) threads.set(thread.key, thread);
      perProject.push({ title:project.title, direct:inv.direct.length, rows:inv.rows.length, recovered:recovered.length, total:merged.length });
      projectDone++;
      $('status').textContent = `THREAD INVENTORY ${projectDone}/${projects.length}\n${project.title}: ${merged.length} threads (${inv.direct.length} href + ${recovered.length} row recovered; ${inv.rows.length} row candidates)\nTOTAL UNIQUE: ${threads.size}`;
    }

    const queue = [...threads.values()].slice(0, 400);
    const report = perProject.map(x => `${x.title}: ${x.total}`).join(' · ');
    if (!queue.length) return void ($('status').textContent = `PROJECTS OK (${projects.length}) but 0 conversations recovered.\n${report}`);

    $('status').textContent = `THREAD INVENTORY COMPLETE: ${queue.length} unique conversations\n${report}\nStarting ingestion…`;
    await sleep(900);

    const { counts, failedThreads } = await shinoIngestQueue(queue, 'Backfill');
    const final = `ALL-project backfill complete\n${projects.length} projects · ${queue.length} unique conversations\n${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed\n${report}${threads.size > 400 ? '\n400-conversation safety cap reached' : ''}${failedThreads.length ? `\nRetry button armed for ${failedThreads.length} failures` : ''}`;
    $('status').textContent = final;
    await chrome.storage.local.set({ lastStatus:final, lastError:'', lastBackfillProjectReport:perProject });
  } catch (e) {
    $('status').textContent = 'Project backfill failed: ' + (e.message || String(e));
  }
};
