const $ = id => document.getElementById(id);

async function readUiAndSave() {
  const endpoint = $('endpoint').value.trim();
  if (!endpoint) throw new Error('No endpoint configured');
  const u = new URL(endpoint);
  const pattern = `${u.protocol}//${u.host}/*`;
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
    const ok = await chrome.permissions.request({ origins: [pattern] });
    if (!ok) throw new Error(`Permission not granted for ${u.origin}`);
  }
  await chrome.storage.local.set({
    enabled: $('enabled').checked,
    endpoint,
    token: $('token').value
  });
  return { enabled: $('enabled').checked, endpoint };
}

async function load() {
  const s = await chrome.storage.local.get({
    enabled: false,
    endpoint: 'http://127.0.0.1:4177/api/ingest/chatgpt',
    token: '',
    lastStatus: 'Not synced yet',
    lastError: ''
  });
  $('enabled').checked = s.enabled;
  $('endpoint').value = s.endpoint;
  $('token').value = s.token;
  $('status').textContent = `${s.lastStatus}${s.lastError ? `\n${s.lastError}` : ''}`;
}

function isChatGptUrl(url = '') {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function norm(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function projectKeyFromUrl(url = '') {
  try { return new URL(url).pathname.match(/\/g\/(g-p-[^/?#]+)/i)?.[1] || null; }
  catch { return null; }
}

function conversationKeyFromUrl(url = '') {
  try {
    const u = new URL(url);
    return u.pathname.match(/\/c\/([^/?#]+)/)?.[1] || `${u.pathname}${u.search}`;
  } catch { return url; }
}

function sameRoute(a = '', b = '') {
  try {
    const ua = new URL(a), ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search;
  } catch { return a === b; }
}

function mergeProjects(...lists) {
  const byKey = new Map();
  const titleToKey = new Map();

  for (const list of lists) {
    for (const raw of list || []) {
      if (!raw?.url) continue;
      const key = projectKeyFromUrl(raw.url) || raw.key || `title:${norm(raw.title)}`;
      const titleKey = norm(raw.title);
      const existingKey = titleKey && titleToKey.get(titleKey);
      const finalKey = existingKey || key;
      const prev = byKey.get(finalKey);
      const next = {
        key: projectKeyFromUrl(raw.url) || raw.key || prev?.key || finalKey,
        title: raw.title || prev?.title || 'ChatGPT project',
        url: raw.url || prev?.url
      };
      byKey.set(finalKey, { ...prev, ...next });
      if (titleKey) titleToKey.set(titleKey, finalKey);
    }
  }

  return [...byKey.values()];
}

async function waitForTab(tabId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('Tab disappeared');
    if (tab.status === 'complete') {
      await sleep(1150);
      return tab;
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for ChatGPT page');
}

async function waitForNavigation(tabId, fromUrl, accept, timeoutMs = 5500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    if (tab.url && !sameRoute(tab.url, fromUrl) && (!accept || accept(tab.url))) {
      if (tab.status !== 'complete') await waitForTab(tabId, Math.max(1500, timeoutMs - (Date.now() - start))).catch(() => {});
      return chrome.tabs.get(tabId).catch(() => tab);
    }
    await sleep(150);
  }
  return null;
}

async function messageTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(400);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function captureTab(tab, reason = 'manual', projectContext = null) {
  if (!tab?.id || !isChatGptUrl(tab.url || '')) throw new Error('Not a ChatGPT tab');
  return messageTab(tab.id, { type: 'SHINO_CAPTURE_NOW', reason, projectContext });
}

async function activeChatTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && isChatGptUrl(active.url || '')) return active;
  const chats = (await chrome.tabs.query({})).filter(t => isChatGptUrl(t.url || ''));
  return chats[0] || null;
}

async function withTemporaryTab(url, fn) {
  const existing = (await chrome.tabs.query({})).find(t => sameRoute(t.url || '', url));
  if (existing) {
    await waitForTab(existing.id);
    return fn(existing, false);
  }
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    const fresh = await chrome.tabs.get(tab.id);
    return await fn(fresh, true);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function discoverProjectUrlsByClick(projectsPage, knownProjects = []) {
  const worker = await chrome.tabs.create({ url: projectsPage, active: false });
  const projects = new Map();
  const knownTitles = new Set((knownProjects || []).map(p => norm(p.title)).filter(Boolean));
  try {
    await waitForTab(worker.id);
    const labelResult = await messageTab(worker.id, { type: 'SHINO_DISCOVER_PROJECT_LABELS' });
    const labels = (labelResult?.labels || []).slice(0, 120);
    if (!labels.length) return [];

    const missingLabels = labels.filter(item => !knownTitles.has(norm(item.title)));
    $('status').textContent = `${knownProjects.length} direct project routes · ${labels.length} Projects-page rows · ${missingLabels.length} routes to recover…`;

    let attempted = 0;
    for (const item of missingLabels) {
      if (attempted > 0) {
        await chrome.tabs.update(worker.id, { url: projectsPage });
        await waitForTab(worker.id).catch(() => null);
      }
      const before = (await chrome.tabs.get(worker.id)).url;
      const clicked = await messageTab(worker.id, { type: 'SHINO_CLICK_PROJECT_LABEL', title: item.title }).catch(() => null);
      attempted++;
      if (!clicked?.clicked) continue;

      const nav = await waitForNavigation(worker.id, before, url => {
        if (!isChatGptUrl(url) || /\/c\//i.test(url)) return false;
        try { return new URL(url).pathname !== new URL(projectsPage).pathname; }
        catch { return true; }
      });
      if (!nav?.url) continue;

      const key = projectKeyFromUrl(nav.url) || nav.url;
      if (!projects.has(key)) projects.set(key, { key, title: item.title, url: nav.url });
      $('status').textContent = `DOM route recovery ${attempted}/${missingLabels.length} · ${projects.size} additional projects recovered`;
    }
    return [...projects.values()];
  } finally {
    await chrome.tabs.remove(worker.id).catch(() => {});
  }
}

async function discoverThreadUrlsByClick(project) {
  const worker = await chrome.tabs.create({ url: project.url, active: false });
  const threads = new Map();
  try {
    await waitForTab(worker.id);
    const labelResult = await messageTab(worker.id, { type: 'SHINO_DISCOVER_THREAD_LABELS' }).catch(() => null);
    const labels = (labelResult?.labels || []).slice(0, 90);
    if (!labels.length) return [];

    let attempted = 0;
    for (const item of labels) {
      if (attempted > 0) {
        await chrome.tabs.update(worker.id, { url: project.url });
        await waitForTab(worker.id).catch(() => null);
      }
      const before = (await chrome.tabs.get(worker.id)).url;
      const clicked = await messageTab(worker.id, { type: 'SHINO_CLICK_THREAD_LABEL', title: item.title }).catch(() => null);
      attempted++;
      if (!clicked?.clicked) continue;

      const nav = await waitForNavigation(worker.id, before, url => isChatGptUrl(url) && /\/c\//i.test(url), 4200);
      if (!nav?.url) continue;
      const key = conversationKeyFromUrl(nav.url);
      if (!threads.has(key)) {
        threads.set(key, {
          key,
          title: item.title,
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

$('save').onclick = async () => {
  try {
    await readUiAndSave();
    $('status').textContent = 'Settings saved';
  } catch (e) {
    $('status').textContent = e.message || String(e);
  }
};

$('sync').onclick = async () => {
  try {
    const cfg = await readUiAndSave();
    if (!cfg.enabled) return void ($('status').textContent = 'Turn on Auto-sync this browser first');
    const tab = await activeChatTab();
    if (!tab) return void ($('status').textContent = 'No ChatGPT tab found');
    $('status').textContent = 'Capturing…';
    const out = await captureTab(tab, 'manual');
    const suffix = out?.body?.projectId ? ` → ${out.body.projectId}` : out?.body?.discovered ? ' → Discovered' : '';
    $('status').textContent = out?.ok ? `Synced${suffix}` : 'Sync failed: ' + (out?.error || 'unknown');
  } catch (e) {
    $('status').textContent = 'Capture unavailable: ' + (e.message || String(e));
  }
};

$('bulk').onclick = async () => {
  try {
    const cfg = await readUiAndSave();
    if (!cfg.enabled) return void ($('status').textContent = 'Turn on Auto-sync this browser first');
    const tabs = (await chrome.tabs.query({})).filter(t => isChatGptUrl(t.url || ''));
    if (!tabs.length) return void ($('status').textContent = 'No open ChatGPT tabs found');
    const counts = { done: 0, mapped: 0, discovered: 0, failed: 0 };
    for (const tab of tabs) {
      try {
        const out = await captureTab(tab, 'bulk-open-tabs');
        if (out?.ok) out.body?.discovered ? counts.discovered++ : counts.mapped++;
        else counts.failed++;
      } catch { counts.failed++; }
      counts.done++;
      $('status').textContent = `Open tabs ${counts.done}/${tabs.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
    }
    $('status').textContent = `Open-tab sync complete · ${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed`;
  } catch (e) {
    $('status').textContent = 'Bulk sync failed: ' + (e.message || String(e));
  }
};

$('projects').onclick = async () => {
  try {
    const cfg = await readUiAndSave();
    if (!cfg.enabled) return void ($('status').textContent = 'Turn on Auto-sync this browser first');
    const seed = await activeChatTab();
    if (!seed) return void ($('status').textContent = 'Open ChatGPT first');

    $('status').textContent = 'Opening ChatGPT Projects index…';
    const pageInfo = await messageTab(seed.id, { type: 'SHINO_FIND_PROJECTS_PAGE' }).catch(() => null);
    const projectsPage = pageInfo?.url || `${new URL(seed.url).origin}/projects`;

    let directProjects = [];
    await withTemporaryTab(projectsPage, async tab => {
      $('status').textContent = 'Scanning direct project routes + full Projects table…';
      const result = await messageTab(tab.id, { type: 'SHINO_DISCOVER_ALL_PROJECTS' });
      directProjects = result?.projects || [];
    });

    // IMPORTANT: direct hrefs are usually only the pinned/sidebar projects.
    // Always scan the Projects table too and merge the two sources.
    const domProjects = await discoverProjectUrlsByClick(projectsPage, directProjects).catch(() => []);
    let projects = mergeProjects(directProjects, domProjects);

    if (!projects.length) {
      const fallback = await messageTab(seed.id, { type: 'SHINO_DISCOVER_PINNED_PROJECTS' }).catch(() => null);
      projects = mergeProjects(fallback?.projects || []);
    }
    if (!projects.length) return void ($('status').textContent = 'No project routes recovered. Send me this popup screenshot.');

    $('status').textContent = `Project inventory: ${directProjects.length} direct + ${domProjects.length} DOM recovered = ${projects.length} unique projects`;

    const threads = new Map();
    let projectDone = 0;
    for (const project of projects) {
      let foundThreads = [];
      try {
        await withTemporaryTab(project.url, async tab => {
          const found = await messageTab(tab.id, { type: 'SHINO_DISCOVER_PROJECT_THREADS' });
          const ctx = {
            projectKey: project.key || found?.context?.projectKey || null,
            projectTitle: project.title || found?.context?.projectTitle || null,
            projectUrl: project.url || found?.context?.projectUrl || null
          };
          foundThreads = (found?.threads || []).map(thread => ({ ...thread, ...ctx }));
        });
      } catch {}

      if (!foundThreads.length) {
        foundThreads = await discoverThreadUrlsByClick(project).catch(() => []);
      }

      for (const thread of foundThreads) if (!threads.has(thread.key)) threads.set(thread.key, thread);
      projectDone++;
      $('status').textContent = `Projects ${projectDone}/${projects.length} · ${threads.size} conversations discovered`;
    }

    const queue = [...threads.values()].slice(0, 400);
    if (!queue.length) return void ($('status').textContent = `${projects.length} projects recovered, but 0 conversation routes found. Send me this popup screenshot.`);

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

    $('status').textContent = `ALL-project backfill complete\n${projects.length} projects · ${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed${threads.size > 400 ? '\n400-conversation safety cap reached' : ''}`;
  } catch (e) {
    $('status').textContent = 'Project backfill failed: ' + (e.message || String(e));
  }
};

load();
