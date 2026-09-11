// v0.7.3 — authoritative per-project metadata replay.
// The v0.7.2 API inventory already stored perProject in chrome.storage, but CONTROL only received
// thread rows. A project with zero conversations therefore disappeared from the metadata payload.
// This patch replays the saved inventory (no ChatGPT API call, no DOM crawl) and augments future
// inventory metadata posts with the complete project list + zero-conversation counts.

(() => {
  const statusEl = document.getElementById('status');
  const nativeFetch = window.fetch.bind(window);

  function projectRows(inventory) {
    const rows = Array.isArray(inventory?.perProject) ? inventory.perProject : [];
    return rows
      .map(item => ({
        key: String(item?.projectKey || '').trim(),
        title: String(item?.title || item?.projectKey || '').trim(),
        url: item?.projectUrl || null,
        conversationCount: Math.max(0, Number(item?.total || 0) || 0)
      }))
      .filter(item => item.key);
  }

  function validInventory(inventory) {
    return !!inventory?.approved &&
      Array.isArray(inventory?.threads) && inventory.threads.length > 0 &&
      Array.isArray(inventory?.perProject) && inventory.perProject.length > 0;
  }

  function metadataBody(inventory) {
    return {
      source: inventory.source || 'chatgpt-project-api-v2-mainworld',
      projectCount: Number(inventory.projectCount || inventory.perProject?.length || 0),
      projects: projectRows(inventory),
      threads: inventory.threads.map(thread => ({
        key: thread.key,
        title: thread.title,
        url: thread.url,
        projectKey: thread.projectKey,
        projectTitle: thread.projectTitle,
        projectUrl: thread.projectUrl,
        updatedAt: thread.updatedAt || null,
        createdAt: thread.createdAt || null
      }))
    };
  }

  async function endpointAndHeaders() {
    const stored = await chrome.storage.local.get({
      endpoint:'http://127.0.0.1:4177/api/ingest/chatgpt',
      token:''
    });
    const endpoint = new URL(stored.endpoint || 'http://127.0.0.1:4177/api/ingest/chatgpt');
    endpoint.pathname = '/api/ingest/chatgpt-inventory';
    endpoint.search = '';
    endpoint.hash = '';
    const headers = {'Content-Type':'application/json'};
    if (stored.token) headers.Authorization = `Bearer ${stored.token}`;
    return {endpoint:endpoint.href, headers};
  }

  // Future v0.7.2-style metadata POSTs are transparently upgraded to the v0.7.3 contract.
  window.fetch = async function shinoProjectMetadataFetch(input, init = {}) {
    try {
      const target = typeof input === 'string' ? input : input?.url;
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && target && new URL(target, location.href).pathname === '/api/ingest/chatgpt-inventory' && typeof init.body === 'string') {
        const stored = await chrome.storage.local.get({lastActiveTabInventory:null});
        const inventory = stored.lastActiveTabInventory;
        if (validInventory(inventory)) {
          const parsed = JSON.parse(init.body);
          parsed.projects = projectRows(inventory);
          parsed.projectCount = Number(inventory.projectCount || parsed.projectCount || parsed.projects.length);
          init = {...init, body:JSON.stringify(parsed)};
        }
      }
    } catch {
      // Never block the existing metadata path if augmentation itself fails.
    }
    return nativeFetch(input, init);
  };

  async function replaySavedInventory() {
    const stored = await chrome.storage.local.get({lastActiveTabInventory:null});
    const inventory = stored.lastActiveTabInventory;
    if (!validInventory(inventory)) return;

    const {endpoint, headers} = await endpointAndHeaders();
    const response = await nativeFetch(endpoint, {
      method:'POST',
      headers,
      body:JSON.stringify(metadataBody(inventory))
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || `CONTROL_METADATA_HTTP_${response.status}`);

    await chrome.storage.local.set({
      lastProjectMetadataReplayAt:Date.now(),
      lastProjectMetadataReplay:{
        projectCount:Number(inventory.projectCount || inventory.perProject.length),
        conversationCount:inventory.threads.length,
        controlProjects:Number(data.projects || 0),
        mappingsAdded:Number(data.projectMappingsAdded || 0)
      }
    });

    if (statusEl) {
      statusEl.textContent = `CONTROL PROJECT METADATA RESTORED\n${inventory.projectCount || inventory.perProject.length} projects · ${inventory.threads.length} conversations\n${data.projects || 0} project counts stored · ${data.projectMappingsAdded || 0} missing project mapping(s) added\nNo ChatGPT API call. No conversation pages reopened.`;
    }
  }

  // The saved 17-project / 131-thread inventory is enough. Opening the popup once after upgrade
  // repairs CONTROL; the user does not need to run Inventory ALL again.
  setTimeout(() => {
    replaySavedInventory().catch(error => {
      if (statusEl) statusEl.textContent = `CONTROL PROJECT METADATA REPLAY FAILED\n${error?.message || String(error)}`;
    });
  }, 150);
})();
