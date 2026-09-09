// v0.7.2 — clean MAIN-world API project inventory + CONTROL metadata reconciliation.
// This intentionally avoids every DOM/project-list crawler. The API call runs in the page MAIN world,
// using the same authenticated origin as ChatGPT. The authoritative inventory is also posted to CONTROL
// so historical backfill captures regain their real ChatGPT update timestamps without reopening chats.

async function shinoMainWorldProjectApi(mode = 'current', requestedProjectKey = null) {
  let stage = 'start';
  const origin = location.origin;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const stableProjectId = value => {
    const text = String(value || '');
    const direct = text.match(/\b(g-p-[0-9a-f]{32})\b/i)?.[1];
    if (direct) return direct;
    try {
      return new URL(text, origin).pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null;
    } catch { return null; }
  };

  try {
    stage = 'session';
    let sessionResponse = await fetch(`${origin}/api/auth/session?unstable_client=true`, {
      method: 'GET', credentials: 'include', cache: 'no-store', headers: {accept:'application/json'}
    });
    if (!sessionResponse.ok) {
      sessionResponse = await fetch(`${origin}/api/auth/session`, {
        method: 'GET', credentials: 'include', cache: 'no-store', headers: {accept:'application/json'}
      });
    }
    if (!sessionResponse.ok) throw new Error(`SESSION_HTTP_${sessionResponse.status}`);
    const session = await sessionResponse.json();
    const accessToken = session?.accessToken;
    if (!accessToken) throw new Error(`SESSION_ACCESS_TOKEN_MISSING keys=${Object.keys(session || {}).join(',')}`);

    const headers = {accept:'application/json', Authorization:`Bearer ${accessToken}`};

    async function apiJson(path, label) {
      stage = label;
      const response = await fetch(`${origin}${path}`, {
        method:'GET', credentials:'include', cache:'no-store', headers
      });
      if (!response.ok) {
        let detail = '';
        try { detail = clean(await response.text()).slice(0,240); } catch {}
        throw new Error(`${label}_HTTP_${response.status}${detail ? `: ${detail}` : ''}`);
      }
      return response.json();
    }

    function unpackProject(item) {
      const wrapper = item?.gizmo || item || {};
      const gizmo = wrapper?.gizmo || wrapper || {};
      const id = stableProjectId(gizmo?.id || wrapper?.id || item?.id || '');
      if (!id) return null;
      const display = gizmo?.display || wrapper?.display || item?.display || {};
      const title = clean(display?.name || gizmo?.name || wrapper?.name || item?.name || id);
      const rawShort = clean(gizmo?.short_url || wrapper?.short_url || item?.short_url || '');
      const shortUrl = rawShort.startsWith('g-p-') ? rawShort : id;
      return {key:id,title,shortUrl,url:`${origin}/g/${shortUrl}/project`};
    }

    async function listProjectConversations(project) {
      const found = new Map();
      const seenCursors = new Set();
      let cursor = '0';
      let pages = 0;
      for (let guard=0; guard<100; guard++) {
        const data = await apiJson(`/backend-api/gizmos/${encodeURIComponent(project.key)}/conversations?cursor=${encodeURIComponent(String(cursor))}`, `PROJECT_CONVERSATIONS_${project.key}`);
        pages++;
        for (const item of data?.items || []) {
          const id = clean(item?.id || item?.conversation_id || '');
          if (!id || found.has(id)) continue;
          const owner = stableProjectId(item?.gizmo_id || item?.conversation_template_id || project.key) || project.key;
          if (owner !== project.key) continue;
          found.set(id, {
            key:id,
            title:clean(item?.title || item?.name || 'ChatGPT conversation').slice(0,180),
            url:`${origin}/g/${project.shortUrl || project.key}/c/${id}`,
            projectKey:project.key,
            projectTitle:project.title,
            projectUrl:project.url,
            updatedAt:item?.update_time || item?.updated_at || null,
            createdAt:item?.create_time || item?.created_at || null
          });
        }
        const next = data?.cursor;
        if (next == null || next === '') break;
        const cursorKey = String(next);
        if (seenCursors.has(cursorKey)) throw new Error(`CURSOR_LOOP_${project.key}`);
        seenCursors.add(cursorKey);
        cursor = cursorKey;
        await wait(90);
      }
      return {threads:[...found.values()],pages};
    }

    if (mode === 'current') {
      stage = 'resolve-current-project';
      const key = stableProjectId(requestedProjectKey || location.href);
      if (!key) throw new Error('CURRENT_PROJECT_ID_NOT_FOUND');
      const slug = location.pathname.match(/\/g\/([^/]+)/i)?.[1] || key;
      const title = clean(document.title.replace(/^ChatGPT\s*[-–—]?\s*/i,'')) || key;
      const project = {key,title,shortUrl:slug,url:`${origin}/g/${slug}/project`};
      const conversations = await listProjectConversations(project);
      return {ok:true,source:'chatgpt-project-api-v2-mainworld',project,threads:conversations.threads,conversationPages:conversations.pages};
    }

    stage = 'projects-sidebar';
    const projectsById = new Map();
    let cursor = null;
    const seenProjectCursors = new Set();
    let projectPages = 0;
    for (let guard=0; guard<20; guard++) {
      const params = new URLSearchParams({owned_only:'true',conversations_per_gizmo:'0'});
      if (cursor) params.set('cursor',cursor);
      const data = await apiJson(`/backend-api/gizmos/snorlax/sidebar?${params.toString()}`, 'PROJECTS_SIDEBAR');
      projectPages++;
      for (const raw of data?.items || []) {
        const project = unpackProject(raw);
        if (project && !projectsById.has(project.key)) projectsById.set(project.key,project);
      }
      const next = data?.cursor;
      if (!next) break;
      const cursorKey = String(next);
      if (seenProjectCursors.has(cursorKey)) throw new Error('PROJECT_CURSOR_LOOP');
      seenProjectCursors.add(cursorKey);
      cursor = cursorKey;
      await wait(90);
    }

    const projects = [];
    for (const project of projectsById.values()) {
      const conversations = await listProjectConversations(project);
      projects.push({...project,threads:conversations.threads,conversationPages:conversations.pages});
      await wait(110);
    }
    return {ok:true,source:'chatgpt-project-api-v2-mainworld',projectPages,projects};
  } catch (error) {
    return {
      ok:false,
      source:'chatgpt-project-api-v2-mainworld',
      stage,
      errorName:error?.name || 'Error',
      errorMessage:error?.message || String(error),
      stack:String(error?.stack || '').slice(0,1200)
    };
  }
}

(() => {
  const statusEl = document.getElementById('status');
  const probeButton = document.getElementById('probe');
  const copyButton = document.getElementById('copyProbe');
  const inventoryButton = document.getElementById('projects');
  const ingestButton = document.getElementById('ingestInventory');
  if (!statusEl || !probeButton || !inventoryButton) return;

  const INVENTORY_SCHEMA = 'active-tab-inventory-v1';
  const SOURCE = 'chatgpt-project-api-v2-mainworld';
  let lastReport = '';
  const normalize = value => String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');

  async function selectedChatTab() {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    return tab?.id && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '') ? tab : null;
  }

  async function runMainWorld(tab, mode, key = null) {
    let injected;
    try {
      injected = await chrome.scripting.executeScript({
        target:{tabId:tab.id},
        world:'MAIN',
        func:shinoMainWorldProjectApi,
        args:[mode,key]
      });
    } catch (error) {
      throw new Error(`EXECUTE_SCRIPT_FAILED: ${error?.message || String(error)}`);
    }
    const entry = injected?.[0];
    if (!entry) throw new Error('EXECUTE_SCRIPT_RETURNED_NO_FRAME');
    if (entry.error) throw new Error(`PAGE_EXECUTION_ERROR: ${entry.error}`);
    if (entry.result === undefined) throw new Error(`PAGE_EXECUTION_RETURNED_UNDEFINED frame=${entry.frameId ?? 'unknown'}`);
    const result = entry.result;
    if (!result?.ok) throw new Error(`${result?.stage || 'unknown-stage'}: ${result?.errorMessage || 'unknown page error'}`);
    return result;
  }

  async function pushInventoryMetadataToControl(inventory) {
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
    const response = await fetch(endpoint.href, {
      method:'POST',
      headers,
      body:JSON.stringify({
        source:inventory.source,
        projectCount:inventory.projectCount,
        threads:inventory.threads.map(thread => ({
          key:thread.key,
          title:thread.title,
          url:thread.url,
          projectKey:thread.projectKey,
          projectTitle:thread.projectTitle,
          projectUrl:thread.projectUrl,
          updatedAt:thread.updatedAt || null,
          createdAt:thread.createdAt || null
        }))
      })
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || `CONTROL_METADATA_HTTP_${response.status}`);
    return data;
  }

  async function setIngest(inventory) {
    if (!ingestButton) return;
    const valid = inventory?.schema === INVENTORY_SCHEMA && inventory?.source === SOURCE && inventory?.approved && Array.isArray(inventory?.threads) && inventory.threads.length > 0;
    ingestButton.disabled = !valid;
    ingestButton.textContent = valid ? `Ingest ${inventory.threads.length} inventoried chats` : 'Ingest inventoried chats';
    ingestButton.title = valid ? 'API inventory validated; ingestion uses the existing paced active-tab capture engine.' : 'Run a validated API inventory first.';
  }

  async function refreshGate() {
    const stored = await chrome.storage.local.get({apiMusicReferenceOkV071:false,lastActiveTabInventory:null});
    const musicOk = !!stored.apiMusicReferenceOkV071;
    inventoryButton.disabled = !musicOk;
    inventoryButton.textContent = musicOk ? 'Inventory ALL projects via API' : 'Validate Music 33/33 first';
    inventoryButton.title = musicOk ? 'Read every project and its cursor-paginated conversation feed without opening project pages.' : 'Run API count current project while Music is open.';
    await setIngest(stored.lastActiveTabInventory?.source === SOURCE ? stored.lastActiveTabInventory : null);
  }

  probeButton.textContent = 'API count current project';
  probeButton.onclick = async () => {
    try {
      const tab = await selectedChatTab();
      if (!tab || !/\/g\/g-p-/i.test(tab.url || '')) return void(statusEl.textContent='Open the Music project page first.');
      const key = tab.url.match(/\/g\/(g-p-[0-9a-f]{32})/i)?.[1] || null;
      statusEl.textContent = 'PROJECT API COUNT\nDirect MAIN-world request; no DOM scrolling…';
      const result = await runMainWorld(tab,'current',key);
      const count = result.threads.length;
      const title = result.project.title;
      const isMusic = normalize(title) === 'music' || key === 'g-p-6a875756d38c819198883bc500c99263';
      const musicOk = isMusic && count === 33;
      if (isMusic) await chrome.storage.local.set({apiMusicReferenceOkV071:musicOk});
      lastReport = JSON.stringify(result,null,2);
      await chrome.storage.local.set({lastProjectProbeText:lastReport});
      if (copyButton) copyButton.disabled = false;
      statusEl.textContent = `PROJECT API COUNT\n${title}: ${count} conversations\n${result.conversationPages} API page${result.conversationPages===1?'':'s'} · DOM scrolling: 0\nprojectKey: ${result.project.key}${isMusic ? `\n\n${musicOk ? '✅ MUSIC REFERENCE MATCH: 33/33' : `❌ MUSIC REFERENCE MISMATCH: ${count}/33`}` : ''}\n\n${result.threads.slice(0,12).map(item=>`• ${item.title}`).join('\n')}`;
      await refreshGate();
    } catch (error) {
      await chrome.storage.local.set({apiMusicReferenceOkV071:false});
      await refreshGate();
      statusEl.textContent = `PROJECT API COUNT FAILED\n${error?.message || String(error)}`;
    }
  };

  if (copyButton) copyButton.onclick = async () => {
    if (!lastReport) {
      const stored = await chrome.storage.local.get({lastProjectProbeText:''});
      lastReport = stored.lastProjectProbeText || '';
    }
    if (!lastReport) return void(statusEl.textContent='Run API count current project first.');
    await navigator.clipboard.writeText(lastReport);
    statusEl.textContent = 'API report copied.';
  };

  inventoryButton.onclick = async () => {
    try {
      const tab = await selectedChatTab();
      if (!tab) return void(statusEl.textContent='Open ChatGPT in the selected tab first.');
      const cfg = await readUiAndSave();
      if (!cfg.enabled) return void(statusEl.textContent='Turn on Auto-sync this browser first');
      const gate = await chrome.storage.local.get({apiMusicReferenceOkV071:false});
      if (!gate.apiMusicReferenceOkV071) return void(statusEl.textContent='Music API reference is not validated at 33/33 yet.');
      statusEl.textContent = 'API PROJECT INVENTORY\nReading every project + every cursor page. No project pages will open.';
      const result = await runMainWorld(tab,'all',null);

      const owners = new Map();
      const threads = new Map();
      const collisions = [];
      const perProject = [];
      for (const project of result.projects || []) {
        const list = project.threads || [];
        perProject.push({title:project.title,total:list.length,projectKey:project.key,diag:{strategy:SOURCE,pages:project.conversationPages}});
        for (const thread of list) {
          const previous = owners.get(thread.key);
          if (previous && previous !== project.title) collisions.push({key:thread.key,a:previous,b:project.title,title:thread.title});
          owners.set(thread.key,project.title);
          if (!threads.has(thread.key)) threads.set(thread.key,thread);
        }
      }
      const music = perProject.find(item=>normalize(item.title)==='music') || perProject.find(item=>item.projectKey==='g-p-6a875756d38c819198883bc500c99263');
      const musicOk = !!music && music.total === 33;
      const approved = perProject.length >= 10 && threads.size > 0 && collisions.length === 0 && musicOk;
      const inventory = {
        schema:INVENTORY_SCHEMA,
        source:SOURCE,
        createdAt:Date.now(),
        approved,
        projectCount:perProject.length,
        nonEmptyProjects:perProject.filter(item=>item.total>0).length,
        perProject,
        threads:[...threads.values()]
      };
      await chrome.storage.local.set({lastActiveTabInventory:inventory,lastBackfillProjectReport:perProject,lastSinglePassInventoryDraft:null});
      await setIngest(inventory);

      let metadata = null;
      let metadataError = '';
      if (approved) {
        statusEl.textContent = `API PROJECT INVENTORY\n${inventory.projectCount} projects · ${inventory.threads.length} conversations\nReconciling real ChatGPT timestamps into CONTROL…`;
        try { metadata = await pushInventoryMetadataToControl(inventory); }
        catch (error) { metadataError = error?.message || String(error); }
      }

      const report = perProject.map(item=>`${item.title}: ${item.total}`).join(' · ');
      const metadataLine = metadata
        ? `\nCONTROL metadata: ${metadata.refreshed}/${metadata.current} refreshed · ${metadata.archived} legacy/out-of-inventory archived${metadata.missing ? ` · ${metadata.missing} missing` : ''}`
        : metadataError ? `\nCONTROL metadata WARNING: ${metadataError}` : '';
      const message = `${approved ? 'API PROJECT INVENTORY COMPLETE — NO INGESTION YET' : 'API PROJECT INVENTORY SAFETY STOP'}\n${perProject.length} projects · ${threads.size} unique conversations\nMusic reference: ${music ? `${music.total}/33` : 'missing'} ${musicOk?'✅':'❌'}${collisions.length ? `\n${collisions.length} collision(s)` : ''}${metadataLine}\n${report}\n\n${approved ? 'Counts came from ChatGPT API pagination. CONTROL now uses the API timestamps; no conversation pages were reopened.' : 'Nothing was ingested.'}`;
      statusEl.textContent = message;
      await chrome.storage.local.set({lastStatus:message,lastError:approved && !metadataError ? '' : metadataError || 'API inventory safety guard failed'});
    } catch (error) {
      await setIngest(null);
      statusEl.textContent = `API PROJECT INVENTORY FAILED\nNothing was ingested.\n${error?.message || String(error)}`;
    }
  };

  refreshGate().catch(()=>{});
})();
