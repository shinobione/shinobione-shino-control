// v0.5.1 inventory/backfill override. Loaded after popup.js so it can reuse its helpers.

async function shinoDiscoverProjectUrlsByRows(projectsPage, knownProjects = []) {
  const worker = await chrome.tabs.create({ url: projectsPage, active: false });
  const recovered = new Map();
  const knownTitles = new Set((knownProjects || []).map(p => norm(p.title)).filter(Boolean));
  try {
    await waitForTab(worker.id);
    await sleep(900);
    const result = await messageTab(worker.id, { type: 'SHINO_V2_DISCOVER_PROJECT_ROWS' }).catch(() => null);
    const rows = (result?.rows || []).slice(0, 160);
    const missing = rows.filter(row => !knownTitles.has(norm(row.title)));

    $('status').textContent = `Projects table: ${rows.length} rows detected\n${rows.map(r => r.title).join(' · ')}\n${knownProjects.length} already have direct routes · ${missing.length} routes to recover`;
    await sleep(800);

    let attempted = 0;
    for (const row of missing) {
      if (attempted > 0) {
        await chrome.tabs.update(worker.id, { url: projectsPage });
        await waitForTab(worker.id).catch(() => null);
        await sleep(550);
      }
      const before = (await chrome.tabs.get(worker.id)).url;
      const clicked = await messageTab(worker.id, { type: 'SHINO_V2_CLICK_PROJECT_ROW', title: row.title }).catch(() => null);
      attempted++;
      if (!clicked?.clicked) continue;

      const nav = await waitForNavigation(worker.id, before, url => {
        if (!isChatGptUrl(url) || /\/c\//i.test(url)) return false;
        return !!projectKeyFromUrl(url);
      }, 6500);
      if (!nav?.url) continue;

      const key = projectKeyFromUrl(nav.url) || nav.url;
      if (!recovered.has(key)) recovered.set(key, { key, title: row.title, url: nav.url });
      $('status').textContent = `Project route recovery ${attempted}/${missing.length} · ${recovered.size} recovered`;
    }
    return { rows, projects: [...recovered.values()] };
  } finally {
    await chrome.tabs.remove(worker.id).catch(() => {});
  }
}

async function shinoDiscoverThreadUrlsByRows(project) {
  const worker = await chrome.tabs.create({ url: project.url, active: false });
  const threads = new Map();
  try {
    await waitForTab(worker.id);
    await sleep(1100);
    const result = await messageTab(worker.id, { type: 'SHINO_V2_DISCOVER_THREAD_ROWS', projectTitle: project.title }).catch(() => null);
    const rows = (result?.rows || []).slice(0, 120);
    let attempted = 0;

    for (const row of rows) {
      if (attempted > 0) {
        await chrome.tabs.update(worker.id, { url: project.url });
        await waitForTab(worker.id).catch(() => null);
        await sleep(400);
      }
      const before = (await chrome.tabs.get(worker.id)).url;
      const clicked = await messageTab(worker.id, { type: 'SHINO_V2_CLICK_THREAD_ROW', title: row.title }).catch(() => null);
      attempted++;
      if (!clicked?.clicked) continue;
      const nav = await waitForNavigation(worker.id, before, url => isChatGptUrl(url) && /\/c\//i.test(url), 4200);
      if (!nav?.url) continue;
      const key = conversationKeyFromUrl(nav.url);
      if (!threads.has(key)) {
        threads.set(key, {
          key,
          title: row.title,
          url: nav.url,
          projectKey: project.key || projectKeyFromUrl(project.url),
          projectTitle: project.title,
          projectUrl: project.url
        });
      }
    }
    return [...threads.values()];
  } finally {
    await chrome.tabs.remove(worker.id).catch(() => {});
  }
}

$('projects').onclick = async () => {
  try {
    const cfg = await readUiAndSave();
    if (!cfg.enabled) return void ($('status').textContent = 'Turn on Auto-sync this browser first');
    const seed = await activeChatTab();
    if (!seed) return void ($('status').textContent = 'Open ChatGPT first');

    $('status').textContent = 'Opening full ChatGPT Projects index…';
    const pageInfo = await messageTab(seed.id, { type: 'SHINO_FIND_PROJECTS_PAGE' }).catch(() => null);
    const projectsPage = pageInfo?.url || `${new URL(seed.url).origin}/projects`;

    let directProjects = [];
    await withTemporaryTab(projectsPage, async tab => {
      const result = await messageTab(tab.id, { type: 'SHINO_DISCOVER_ALL_PROJECTS' }).catch(() => null);
      directProjects = result?.projects || [];
    });

    const rowRecovery = await shinoDiscoverProjectUrlsByRows(projectsPage, directProjects).catch(() => ({ rows: [], projects: [] }));
    const domProjects = rowRecovery.projects || [];
    let projects = mergeProjects(directProjects, domProjects);

    if (!projects.length) {
      const fallback = await messageTab(seed.id, { type: 'SHINO_DISCOVER_PINNED_PROJECTS' }).catch(() => null);
      projects = mergeProjects(fallback?.projects || []);
    }
    if (!projects.length) return void ($('status').textContent = 'No project routes recovered. Send me this popup screenshot.');

    const inventoryNames = projects.map(p => p.title).join(' · ');
    $('status').textContent = `INVENTORY OK: ${projects.length} projects\n${inventoryNames}\n${directProjects.length} direct + ${domProjects.length} table routes`;
    await sleep(900);

    const threads = new Map();
    let projectDone = 0;
    for (const project of projects) {
      let foundThreads = [];
      try {
        await withTemporaryTab(project.url, async tab => {
          await sleep(650);
          const found = await messageTab(tab.id, { type: 'SHINO_DISCOVER_PROJECT_THREADS' }).catch(() => null);
          const ctx = {
            projectKey: project.key || found?.context?.projectKey || projectKeyFromUrl(project.url),
            projectTitle: project.title || found?.context?.projectTitle || null,
            projectUrl: project.url || found?.context?.projectUrl || null
          };
          foundThreads = (found?.threads || []).map(thread => ({ ...thread, ...ctx }));
        });
      } catch {}

      if (!foundThreads.length) foundThreads = await discoverThreadUrlsByClick(project).catch(() => []);
      if (!foundThreads.length) foundThreads = await shinoDiscoverThreadUrlsByRows(project).catch(() => []);

      for (const thread of foundThreads) if (!threads.has(thread.key)) threads.set(thread.key, thread);
      projectDone++;
      $('status').textContent = `Projects ${projectDone}/${projects.length} · ${threads.size} conversations discovered`;
    }

    const queue = [...threads.values()].slice(0, 400);
    if (!queue.length) return void ($('status').textContent = `${projects.length} projects recovered, but 0 conversation routes found. Project inventory itself is OK; send me this popup screenshot.`);

    const counts = { mapped: 0, discovered: 0, failed: 0 };
    let done = 0;
    for (const thread of queue) {
      try {
        await withTemporaryTab(thread.url, async tab => {
          const out = await captureTab(tab, 'all-project-backfill', {
            projectKey: thread.projectKey,
            projectTitle: thread.projectTitle,
            projectUrl: thread.projectUrl
          });
          if (out?.ok) out.body?.discovered ? counts.discovered++ : counts.mapped++;
          else counts.failed++;
        });
      } catch { counts.failed++; }
      done++;
      $('status').textContent = `Backfill ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
    }

    $('status').textContent = `ALL-project backfill complete\n${projects.length} projects: ${inventoryNames}\n${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed${threads.size > 400 ? '\n400-conversation safety cap reached' : ''}`;
  } catch (e) {
    $('status').textContent = 'Project backfill failed: ' + (e.message || String(e));
  }
};