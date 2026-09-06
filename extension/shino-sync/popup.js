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
    const out = await chrome.tabs.sendMessage(tab.id, { type: 'SHINO_CAPTURE_NOW' });
    $('status').textContent = out?.ok ? 'Synced' : 'Sync failed: ' + (out?.error || 'unknown');
  } catch (e) {
    $('status').textContent = 'Capture unavailable: ' + (e.message || String(e));
  }
};

load();
