// v0.7.0 — API-backed project inventory.
// Stop scraping ChatGPT's virtualized project chat list. The web app already exposes the authoritative
// project/conversation feed through its same-origin backend API. We use the active authenticated ChatGPT
// tab to call those read-only endpoints, follow cursors, and build the same inventory shape CONTROL expects.

async function shinoApiInventoryInPage(mode = 'all', requestedProjectKey = null) {
  const origin = location.origin;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const stableProjectId = value => {
    const text = String(value || '');
    const direct = text.match(/\b(g-p-[0-9a-f]{32})\b/i)?.[1];
    if (direct) return direct;
    try {
      return new URL(text, origin).pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null;
    } catch { return null; }
  };
  const decodeJwtAccountId = token => {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      const payload = JSON.parse(atob(normalized));
      return payload?.['https://api.openai.com/auth']?.chatgpt_account_id || null;
    } catch { return null; }
  };

  const sessionResponse = await fetch(`${origin}/api/auth/session`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });
  if (!sessionResponse.ok) throw new Error(`SESSION_HTTP_${sessionResponse.status}`);
  const session = await sessionResponse.json();
  const accessToken = session?.accessToken;
  if (!accessToken) throw new Error('SESSION_ACCESS_TOKEN_MISSING');
  const accountId = session?.account?.id || session?.user?.account_id || decodeJwtAccountId(accessToken);

  const baseHeaders = { accept: 'application/json', Authorization: `Bearer ${accessToken}` };
  if (accountId) baseHeaders['chatgpt-account-id'] = accountId;

  async function apiJson(url) {
    let response = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', headers: baseHeaders });
    // Personal workspaces sometimes do not require chatgpt-account-id. Retry once without it only on auth errors.
    if ((response.status === 401 || response.status === 403) && baseHeaders['chatgpt-account-id']) {
      const fallbackHeaders = { accept: 'application/json', Authorization: `Bearer ${accessToken}` };
      response = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', headers: fallbackHeaders });
    }
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.text()) || '').replace(/\s+/g, ' ').slice(0, 180); } catch {}
      throw new Error(`BACKEND_HTTP_${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
  }

  function unpackProject(item) {
    const outer = item?.gizmo || item || {};
    const gizmo = outer?.gizmo || outer || {};
    const id = stableProjectId(gizmo?.id || outer?.id || item?.id || '');
    if (!id) return null;
    const display = gizmo?.display || outer?.display || item?.display || {};
    const title = String(display?.name || gizmo?.name || outer?.name || item?.name || id).trim();
    const shortUrl = String(gizmo?.short_url || outer?.short_url || item?.short_url || id).trim();
    return {
      key: id,
      title,
      shortUrl: shortUrl.startsWith('g-p-') ? shortUrl : id,
      url: `${origin}/g/${shortUrl.startsWith('g-p-') ? shortUrl : id}/project`
    };
  }

  async function listProjects() {
    const found = new Map();
    let cursor = null;
    const seenCursors = new Set();
    let pages = 0;
    for (let guard = 0; guard < 50; guard++) {
      const params = new URLSearchParams({ owned_only: 'true', conversations_per_gizmo: '0' });
      if (cursor) params.set('cursor', cursor);
      const data = await apiJson(`${origin}/backend-api/gizmos/snorlax/sidebar?${params.toString()}`);
      pages++;
      for (const raw of data?.items || []) {
        const project = unpackProject(raw);
        if (project && !found.has(project.key)) found.set(project.key, project);
      }
      const next = data?.cursor;
      if (!next || seenCursors.has(String(next))) break;
      seenCursors.add(String(next));
      cursor = String(next);
      await wait(120);
    }
    return { projects: [...found.values()], pages };
  }

  async function listProjectConversations(project) {
    const found = new Map();
    let cursor = '0';
    const seenCursors = new Set();
    let pages = 0;
    for (let guard = 0; guard < 100; guard++) {
      const params = new URLSearchParams({ cursor: String(cursor), limit: '100' });
      const data = await apiJson(`${origin}/backend-api/gizmos/${encodeURIComponent(project.key)}/conversations?${params.toString()}`);
      pages++;
      for (const item of data?.items || []) {
        const id = String(item?.id || item?.conversation_id || '').trim();
        if (!id || found.has(id)) continue;
        const title = String(item?.title || item?.name || 'ChatGPT conversation').replace(/\s+/g, ' ').trim();
        const gizmoId = stableProjectId(item?.gizmo_id || item?.conversation_template_id || project.key) || project.key;
        if (gizmoId !== project.key) continue;
        const slug = project.shortUrl || project.key;
        found.set(id, {
          key: id,
          title: title.slice(0, 180),
          url: `${origin}/g/${slug}/c/${id}`,
          projectKey: project.key,
          projectTitle: project.title,
          projectUrl: project.url,
          updatedAt: item?.update_time || item?.updated_at || null,
          createdAt: item?.create_time || item?.created_at || null
        });
      }
      const next = data?.cursor;
      if (next == null || next === '' || seenCursors.has(String(next))) break;
      seenCursors.add(String(next));
      cursor = String(next);
      await wait(120);
    }
    return { threads: [...found.values()], pages };
  }

  if (mode === 'current') {
    const key = stableProjectId(requestedProjectKey || location.href);
    if (!key) throw new Error('CURRENT_PROJECT_ID_NOT_FOUND');
    const projectIndex = await listProjects();
    const project = projectIndex.projects.find(item => item.key === key) || {
      key,
      title: document.title.replace(/^ChatGPT\s*[-–—]?\s*/i, '').trim() || key,
      shortUrl: location.pathname.match(/\/g\/([^/]+)/i)?.[1] || key,
      url: `${origin}/g/${location.pathname.match(/\/g\/([^/]+)/i)?.[1] || key}/project`
    };
    const conversations = await listProjectConversations(project);
    return {
      source: 'chatgpt-project-api-v1',
      accountIdPresent: !!accountId,
      project,
      threads: conversations.threads,
      projectPages: projectIndex.pages,
      conversationPages: conversations.pages
    };
  }

  const projectIndex = await listProjects();
  const projects = [];
  for (let i = 0; i < projectIndex.projects.length; i++) {
    const project = projectIndex.projects[i];
    const conversations = await listProjectConversations(project);
    projects.push({ ...project, threads: conversations.threads, conversationPages: conversations.pages });
    await wait(160);
  }
  return {
    source: 'chatgpt-project-api-v1',
    accountIdPresent: !!accountId,
    projectPages: projectIndex.pages,
    projects
  };
}

(() => {
  const statusEl = document.getElementById('status');
  const probeButton = document.getElementById('probe');
  const copyButton = document.getElementById('copyProbe');
  const inventoryButton = document.getElementById('projects');
  const ingestButton = document.getElementById('ingestInventory');
  if (!statusEl || !inventoryButton) return;

  const INVENTORY_SCHEMA = 'active-tab-inventory-v1';
  const API_SOURCE = 'chatgpt-project-api-v1';
  let lastReport = '';
  const normalize = value => String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  async function activeChatTab() {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    return tab?.id && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '') ? tab : null;
  }

  async function runApi(tab, mode, projectKey = null) {
    const injected = await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func:shinoApiInventoryInPage,
      args:[mode, projectKey]
    });
    const result = injected?.[0]?.result;
    if (!result) throw new Error('NO_API_INVENTORY_RESULT');
    return result;
  }

  async function armIngest(inventory) {
    if (!ingestButton) return;
    const valid = inventory?.schema === INVENTORY_SCHEMA && inventory?.source === API_SOURCE && inventory?.approved && Array.isArray(inventory?.threads) && inventory.threads.length > 0;
    ingestButton.disabled = !valid;
    ingestButton.textContent = valid ? `Ingest ${inventory.threads.length} inventoried chats` : 'Ingest inventoried chats';
    ingestButton.title = valid ? 'Inventory came from ChatGPT project API pagination.' : 'Run API project inventory first.';
  }

  // Old DOM inventories are not trustworthy. Preserve an existing API inventory across popup reopen.
  chrome.storage.local.get({lastActiveTabInventory:null}).then(async stored => {
    if (stored.lastActiveTabInventory?.source !== API_SOURCE) {
      await chrome.storage.local.set({lastActiveTabInventory:null,lastSinglePassInventoryDraft:null});
      await armIngest(null);
    } else {
      await armIngest(stored.lastActiveTabInventory);
    }
  }).catch(()=>{});

  if (probeButton) {
    probeButton.textContent = 'API count current project';
    probeButton.onclick = async () => {
      try {
        const tab = await activeChatTab();
        if (!tab || !/\/g\/g-p-/i.test(tab.url || '')) return void(statusEl.textContent='Open a ChatGPT project page first.');
        const key = tab.url.match(/\/g\/(g-p-[0-9a-f]{32})/i)?.[1] || null;
        statusEl.textContent = 'PROJECT API COUNT\nReading the authoritative paginated project feed…';
        const result = await runApi(tab, 'current', key);
        const count = result.threads.length;
        lastReport = JSON.stringify(result, null, 2);
        await chrome.storage.local.set({lastProjectProbeText:lastReport});
        if (copyButton) copyButton.disabled = false;
        statusEl.textContent = `PROJECT API COUNT\n${result.project.title}: ${count} conversations\n${result.conversationPages} API page${result.conversationPages===1?'':'s'} · DOM scrolling: 0\nprojectKey: ${result.project.key}${normalize(result.project.title)==='music' ? `\n\n${count===33?'✅ MUSIC REFERENCE MATCH: 33/33':'❌ MUSIC REFERENCE MISMATCH — expected 33'}` : ''}\n\n${result.threads.slice(0,12).map(item=>`• ${item.title}`).join('\n')}`;
      } catch (e) {
        statusEl.textContent = `PROJECT API COUNT FAILED\n${e?.message || String(e)}`;
      }
    };
  }

  if (copyButton) copyButton.onclick = async () => {
    if (!lastReport) {
      const stored = await chrome.storage.local.get({lastProjectProbeText:''});
      lastReport = stored.lastProjectProbeText || '';
    }
    if (!lastReport) return void(statusEl.textContent='Run API count current project first.');
    await navigator.clipboard.writeText(lastReport);
    statusEl.textContent = 'API inventory report copied.';
  };

  inventoryButton.disabled = false;
  inventoryButton.textContent = 'Inventory ALL projects via API';
  inventoryButton.title = 'No DOM crawler: list projects and conversations through ChatGPT same-origin paginated backend feed.';
  inventoryButton.onclick = async () => {
    try {
      const tab = await activeChatTab();
      if (!tab) return void(statusEl.textContent='Open ChatGPT in the selected tab first.');
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void(statusEl.textContent='Turn on Auto-sync this browser first');
      statusEl.textContent = 'API PROJECT INVENTORY\nReading projects + cursor-paginated conversations. No project pages will be opened.';
      const result = await runApi(tab, 'all', null);

      const owners = new Map();
      const threads = new Map();
      const collisions = [];
      const perProject = [];
      for (const project of result.projects || []) {
        const list = project.threads || [];
        perProject.push({title:project.title,total:list.length,projectKey:project.key,diag:{strategy:API_SOURCE,pages:project.conversationPages}});
        for (const thread of list) {
          const previous = owners.get(thread.key);
          if (previous && previous !== project.title) collisions.push({key:thread.key,a:previous,b:project.title,title:thread.title});
          owners.set(thread.key, project.title);
          if (!threads.has(thread.key)) threads.set(thread.key, thread);
        }
      }

      const music = perProject.find(item => normalize(item.title) === 'music');
      const musicReferenceOk = !!music && music.total === 33;
      const projectCount = perProject.length;
      const nonEmptyProjects = perProject.filter(item => item.total > 0).length;
      const approved = projectCount >= 10 && threads.size > 0 && collisions.length === 0 && musicReferenceOk;
      const inventory = {
        schema:INVENTORY_SCHEMA,
        source:API_SOURCE,
        createdAt:Date.now(),
        approved,
        projectCount,
        nonEmptyProjects,
        perProject,
        threads:[...threads.values()]
      };
      await chrome.storage.local.set({lastActiveTabInventory:inventory,lastBackfillProjectReport:perProject,lastSinglePassInventoryDraft:null});
      await armIngest(inventory);

      const report = perProject.map(item=>`${item.title}: ${item.total}`).join(' · ');
      const header = approved ? 'API PROJECT INVENTORY COMPLETE — NO INGESTION YET' : 'API PROJECT INVENTORY SAFETY STOP';
      const guard = music ? `Music reference: ${music.total}/33 ${musicReferenceOk?'✅':'❌'}` : 'Music reference: project not found ❌';
      const collisionText = collisions.length ? `\n${collisions.length} cross-project collision(s) detected.` : '';
      const message = `${header}\n${projectCount} projects · ${threads.size} unique conversations\n${guard}${collisionText}\n${report}\n\n${approved ? 'Review the counts, then ingestion is enabled.' : 'Nothing was ingested.'}`;
      statusEl.textContent = message;
      await chrome.storage.local.set({lastStatus:message,lastError:approved?'':'API inventory safety guard failed'});
    } catch (e) {
      const error = e?.message || String(e);
      await armIngest(null);
      statusEl.textContent = `API PROJECT INVENTORY FAILED\nNothing was ingested.\n${error}`;
      await chrome.storage.local.set({lastStatus:statusEl.textContent,lastError:error});
    }
  };
})();
