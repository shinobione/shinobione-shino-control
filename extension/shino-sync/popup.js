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

async function waitForTab(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('Tab disappeared');
    if (tab.status === 'complete') {
      await sleep(850);
      return tab;
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for ChatGPT page');
}

async function messageTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(250);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function captureTab(tab, reason = 'manual') {
  if (!tab?.id || !isChatGptUrl(tab.url || '')) throw new Error('Not a ChatGPT tab');
  return messageTab(tab.id, { type: 'SHINO_CAPTURE_NOW', reason });
}

async function activeChatTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && isChatGptUrl(active.url || '')) return active;
  const chats = (await chrome.tabs.query({})).filter(t => isChatGptUrl(t.url || ''));
  return chats[0] || null;
}

async function withTemporaryTab(url, fn) {
  const existing = (await chrome.tabs.query({})).find(t => t.url === url);
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

    $('status').textContent = 'Discovering pinned projects…';
    const projectResult = await messageTab(seed.id, { type: 'SHINO_DISCOVER_PINNED_PROJECTS' });
    const projects = projectResult?.projects || [];
    if (!projects.length) return void ($('status').textContent = 'No pinned project links found in the current ChatGPT sidebar');

    const threads = new Map();
    let projectDone = 0;
    for (const project of projects) {
      try {
        await withTemporaryTab(project.url, async tab => {
          const found = await messageTab(tab.id, { type: 'SHINO_DISCOVER_PROJECT_THREADS' });
          for (const thread of found?.threads || []) if (!threads.has(thread.key)) threads.set(thread.key, thread);
        });
      } catch {}
      projectDone++;
      $('status').textContent = `Projects ${projectDone}/${projects.length} · ${threads.size} conversations discovered`;
    }

    const queue = [...threads.values()].slice(0, 200);
    const counts = { mapped: 0, discovered: 0, failed: 0 };
    let done = 0;
    for (const thread of queue) {
      try {
        await withTemporaryTab(thread.url, async tab => {
          const out = await captureTab(tab, 'pinned-project-backfill');
          if (out?.ok) out.body?.discovered ? counts.discovered++ : counts.mapped++;
          else counts.failed++;
        });
      } catch { counts.failed++; }
      done++;
      $('status').textContent = `Backfill ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
    }

    $('status').textContent = `Pinned-project backfill complete\n${projects.length} projects · ${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed${threads.size > 200 ? '\n200-conversation safety cap reached' : ''}`;
  } catch (e) {
    $('status').textContent = 'Project backfill failed: ' + (e.message || String(e));
  }
};

load();
