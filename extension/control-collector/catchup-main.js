(() => {
  const ORIGIN = location.origin;
  const CHANNEL = 'SHINO_CONTROL_CATCHUP_V1';
  const DEFAULT_FETCH_TIMEOUT_MS = 30000;
  const SESSION_FETCH_TIMEOUT_MS = 10000;
  const FETCH_CONCURRENCY = 2;
  const FETCH_MAX_ATTEMPTS = 2;
  const FETCH_RETRY_DELAY_MS = 750;
  const INACCESSIBLE_FAILURE = {kind:'inaccessible'};
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

  function stableProjectId(value = '') {
    const direct = String(value || '').match(/\b(g-p-[0-9a-f]{32})\b/i)?.[1];
    if (direct) return direct.toLowerCase();
    try {
      return new URL(value, ORIGIN).pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1]?.toLowerCase() || null;
    } catch { return null; }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {...options, signal:controller.signal});
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`CHATGPT_FETCH_TIMEOUT_${timeoutMs}MS`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sessionHeaders() {
    let response = await fetchWithTimeout(`${ORIGIN}/api/auth/session?unstable_client=true`, {
      credentials:'include', cache:'no-store', headers:{accept:'application/json'}
    }, SESSION_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      response = await fetchWithTimeout(`${ORIGIN}/api/auth/session`, {
        credentials:'include', cache:'no-store', headers:{accept:'application/json'}
      }, SESSION_FETCH_TIMEOUT_MS);
    }
    if (!response.ok) throw new Error(`SESSION_HTTP_${response.status}`);
    const session = await response.json();
    if (!session?.accessToken) throw new Error('SESSION_ACCESS_TOKEN_MISSING');
    return {accept:'application/json', Authorization:`Bearer ${session.accessToken}`};
  }

  async function apiJson(path, headers, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const response = await fetchWithTimeout(`${ORIGIN}${path}`, {
      method:'GET', credentials:'include', cache:'no-store', headers
    }, timeoutMs);
    if (!response.ok) {
      let detail = '';
      try { detail = clean(await response.text()).slice(0,180); } catch {}
      throw new Error(`CHATGPT_HTTP_${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
  }

  function unpackProject(item) {
    const wrapper = item?.gizmo || item || {};
    const gizmo = wrapper?.gizmo || wrapper || {};
    const key = stableProjectId(gizmo?.id || wrapper?.id || item?.id || '');
    if (!key) return null;
    const display = gizmo?.display || wrapper?.display || item?.display || {};
    const title = clean(display?.name || gizmo?.name || wrapper?.name || item?.name || key).slice(0,160);
    const rawShort = clean(gizmo?.short_url || wrapper?.short_url || item?.short_url || '');
    const shortUrl = rawShort.startsWith('g-p-') ? rawShort : key;
    return {key,title,shortUrl,url:`${ORIGIN}/g/${shortUrl}/project`};
  }

  async function listProjects(headers) {
    const found = new Map();
    const seen = new Set();
    let cursor = null;
    for (let guard=0; guard<20; guard++) {
      const params = new URLSearchParams({owned_only:'true',conversations_per_gizmo:'0'});
      if (cursor) params.set('cursor',cursor);
      const data = await apiJson(`/backend-api/gizmos/snorlax/sidebar?${params.toString()}`, headers);
      for (const raw of data?.items || []) {
        const project = unpackProject(raw);
        if (project && !found.has(project.key)) found.set(project.key,project);
      }
      const next = data?.cursor;
      if (!next) break;
      const cursorKey = String(next);
      if (seen.has(cursorKey)) throw new Error('PROJECT_CURSOR_LOOP');
      seen.add(cursorKey);
      cursor = cursorKey;
      await sleep(60);
    }
    return [...found.values()];
  }

  async function listProjectThreads(project, headers) {
    const found = new Map();
    const seen = new Set();
    let cursor = '0';
    for (let guard=0; guard<100; guard++) {
      const data = await apiJson(`/backend-api/gizmos/${encodeURIComponent(project.key)}/conversations?cursor=${encodeURIComponent(String(cursor))}`, headers);
      for (const item of data?.items || []) {
        const key = clean(item?.id || item?.conversation_id || '');
        if (!key || found.has(key)) continue;
        const owner = stableProjectId(item?.gizmo_id || item?.conversation_template_id || project.key) || project.key;
        if (owner !== project.key) continue;
        found.set(key, {
          key,
          title:clean(item?.title || item?.name || 'ChatGPT conversation').slice(0,180),
          url:`${ORIGIN}/g/${project.shortUrl || project.key}/c/${key}`,
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
      if (seen.has(cursorKey)) throw new Error(`CONVERSATION_CURSOR_LOOP_${project.key}`);
      seen.add(cursorKey);
      cursor = cursorKey;
      await sleep(45);
    }
    return [...found.values()];
  }

  async function inventory() {
    const headers = await sessionHeaders();
    const projects = await listProjects(headers);
    const threads = [];
    for (const project of projects) {
      threads.push(...await listProjectThreads(project, headers));
      await sleep(60);
    }
    return {source:'chatgpt-project-api-metadata-v1', observedAt:new Date().toISOString(), projectCount:projects.length, threads};
  }

  function messageText(message) {
    const content = message?.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').filter(Boolean).join('\n');
    return String(text || content.text || '').replace(/\r/g,'').trim();
  }

  function currentBranchMessages(conversation) {
    const mapping = conversation?.mapping || {};
    let nodeId = conversation?.current_node || null;
    const chain = [];
    const seen = new Set();
    while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = mapping[nodeId];
      chain.push(node);
      nodeId = node?.parent || null;
    }
    chain.reverse();
    const messages = [];
    for (const node of chain) {
      const message = node?.message;
      const role = String(message?.author?.role || '').toLowerCase();
      if (!['user','assistant'].includes(role)) continue;
      const text = messageText(message);
      if (!text) continue;
      messages.push({role,text:text.slice(0,16000)});
    }
    return messages.slice(-12);
  }

  function hash(value = '') {
    let h = 2166136261;
    for (const char of String(value || '')) {
      h ^= char.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function failureKind(errorText = '') {
    if (/CHATGPT_HTTP_404\b/i.test(errorText)) return INACCESSIBLE_FAILURE.kind;
    return 'transient';
  }

  function retryable(errorText = '') {
    return /CHATGPT_FETCH_TIMEOUT_|CHATGPT_HTTP_5\d\d\b|Failed to fetch|NetworkError/i.test(errorText);
  }

  async function fetchChangedItem(item, headers) {
    let lastError = null;
    for (let attempt=1; attempt<=FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        const conversation = await apiJson(`/backend-api/conversation/${encodeURIComponent(item.key)}`, headers);
        const messages = currentBranchMessages(conversation);
        if (!messages.length) throw new Error('NO_READABLE_MESSAGES');
        const tail = messages.slice(-4).map(message => `${message.role}:${message.text}`).join('\n');
        return {payload:{
          conversationKey:item.key,
          url:item.url || `${ORIGIN}/c/${item.key}`,
          title:item.title || conversation?.title || 'ChatGPT conversation',
          projectKey:item.projectKey || stableProjectId(item.url || '') || null,
          projectTitle:item.projectTitle || null,
          projectUrl:item.projectUrl || null,
          messages,
          messageCount:Object.values(conversation?.mapping || {}).filter(node => node?.message).length,
          fingerprint:`${item.key}:${messages.length}:${hash(tail)}`,
          conversationUpdatedAt:item.updatedAt || conversation?.update_time || conversation?.updated_at || new Date().toISOString(),
          conversationCreatedAt:item.createdAt || conversation?.create_time || conversation?.created_at || null,
          clientTimestamp:new Date().toISOString(),
          collectorVersion:'0.2.5',
          catchupReason:item.reason || 'targeted-catchup'
        }};
      } catch (error) {
        lastError = String(error?.message || error);
        if (attempt < FETCH_MAX_ATTEMPTS && retryable(lastError)) {
          await sleep(FETCH_RETRY_DELAY_MS * attempt);
          continue;
        }
        break;
      }
    }
    return {failure:{
      key:item.key,
      title:item.title || '',
      error:lastError || 'Unknown fetch error',
      kind:failureKind(lastError || ''),
      updatedAt:item.updatedAt || null
    }};
  }

  async function fetchChanged(plan = []) {
    const headers = await sessionHeaders();
    const payloads = [];
    const failures = [];
    const items = plan.slice(0,32);

    for (let offset=0; offset<items.length; offset+=FETCH_CONCURRENCY) {
      const chunk = items.slice(offset, offset + FETCH_CONCURRENCY);
      const results = await Promise.all(chunk.map(item => fetchChangedItem(item, headers)));
      for (const result of results) {
        if (result?.payload) payloads.push(result.payload);
        if (result?.failure) failures.push(result.failure);
      }
      if (offset + FETCH_CONCURRENCY < items.length) await sleep(250);
    }

    return {payloads,failures};
  }

  window.addEventListener('message', async event => {
    if (event.source !== window || event.data?.channel !== CHANNEL) return;
    const {type,requestId} = event.data;
    if (type === 'CONTROL_CATCHUP_INVENTORY_REQUEST') {
      try {
        const result = await inventory();
        window.postMessage({channel:CHANNEL,type:'CONTROL_CATCHUP_INVENTORY_RESULT',requestId,ok:true,result}, '*');
      } catch (error) {
        window.postMessage({channel:CHANNEL,type:'CONTROL_CATCHUP_INVENTORY_RESULT',requestId,ok:false,error:String(error?.message || error)}, '*');
      }
    }
    if (type === 'CONTROL_CATCHUP_FETCH_REQUEST') {
      try {
        const result = await fetchChanged(Array.isArray(event.data.plan) ? event.data.plan : []);
        window.postMessage({channel:CHANNEL,type:'CONTROL_CATCHUP_FETCH_RESULT',requestId,ok:true,result}, '*');
      } catch (error) {
        window.postMessage({channel:CHANNEL,type:'CONTROL_CATCHUP_FETCH_RESULT',requestId,ok:false,error:String(error?.message || error)}, '*');
      }
    }
  });
})();
