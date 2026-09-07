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
  $('status').innerHTML = `${s.lastStatus}${s.lastError ? `<br><span class="error">${s.lastError}</span>` : ''}`;
}

function isChatGptUrl(url = '') {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url);
}

async function captureTab(tab, reason = 'manual') {
  if (!tab?.id || !isChatGptUrl(tab.url || '')) throw new Error('Not a ChatGPT tab');
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'SHINO_CAPTURE_NOW', reason });
  } catch (firstError) {
    // Tabs that were already open when the extension was upgraded may not have the content script yet.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await new Promise(resolve => setTimeout(resolve, 250));
    return chrome.tabs.sendMessage(tab.id, { type: 'SHINO_CAPTURE_NOW', reason });
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
    if (!cfg.enabled) {
      $('status').textContent = 'Turn on Auto-sync this browser first';
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    $('status').textContent = 'Capturing…';
    const out = await captureTab(tab, 'manual');
    if (out?.ok) {
      const suffix = out.body?.projectId ? ` → ${out.body.projectId}` : out.body?.discovered ? ' → Discovered' : '';
      $('status').textContent = `Synced${suffix}`;
    } else $('status').textContent = 'Sync failed: ' + (out?.error || 'unknown');
  } catch (e) {
    $('status').textContent = 'Capture unavailable: ' + (e.message || String(e));
  }
};

$('bulk').onclick = async () => {
  try {
    const cfg = await readUiAndSave();
    if (!cfg.enabled) {
      $('status').textContent = 'Turn on Auto-sync this browser first';
      return;
    }
    const allTabs = await chrome.tabs.query({});
    const tabs = allTabs.filter(t => isChatGptUrl(t.url || ''));
    if (!tabs.length) {
      $('status').textContent = 'No open ChatGPT tabs found';
      return;
    }

    const counts = { done: 0, mapped: 0, discovered: 0, skipped: 0, failed: 0 };
    let cursor = 0;
    $('status').textContent = `Backfill started · 0/${tabs.length}`;

    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= tabs.length) return;
        try {
          const out = await captureTab(tabs[i], 'bulk-open-tabs');
          if (out?.ok) {
            if (out?.skipped) counts.skipped++;
            else if (out.body?.mapped) counts.mapped++;
            else if (out.body?.discovered) counts.discovered++;
            else counts.mapped++;
          } else counts.failed++;
        } catch {
          counts.failed++;
        } finally {
          counts.done++;
          $('status').textContent = `Backfill ${counts.done}/${tabs.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, tabs.length) }, () => worker()));
    $('status').textContent = `Backfill complete · ${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed`;
  } catch (e) {
    $('status').textContent = 'Bulk sync failed: ' + (e.message || String(e));
  }
};

load();
