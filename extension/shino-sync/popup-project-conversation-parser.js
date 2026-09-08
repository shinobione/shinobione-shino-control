// v0.6.8 — focused project conversation parser.
// Purpose: enumerate ALL conversations belonging to the currently open ChatGPT project,
// including virtualized/lazy rows, without guessing every scroll container on the page.
// Strategy: keep the parser anchored to the actual project-owned conversation links, find the
// nearest scrollable ancestor of the rendered rows, advance that list, and accumulate unique
// conversation IDs until both the set and the scroll position are stable.

async function shinoParseProjectConversationsInPage(projectTitle = '') {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const stableProjectId = url => {
    try {
      return new URL(url, location.origin).pathname
        .match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null;
    } catch { return null; }
  };
  const conversationKey = url => {
    try { return new URL(url, location.origin).pathname.match(/\/c\/([^/?#]+)/i)?.[1] || url; }
    catch { return url; }
  };

  const projectKey = stableProjectId(location.href);
  const pageText = clean(document.body?.innerText || document.body?.textContent || '');
  if (/too many requests|temporarily limited access|making requests too quickly/i.test(pageText)) {
    return {projectKey,direct:[],rows:[],rateLimited:true,diag:{reason:'rate-limit page'}};
  }

  const main = document.querySelector('main') || document.querySelector('[role="main"]');
  if (!main) return {projectKey,direct:[],rows:[],rateLimited:false,diag:{reason:'no-main'}};

  const found = new Map();
  const rejected = new Set();
  let scanned = 0;

  function projectAnchors() {
    const accepted = [];
    for (const a of main.querySelectorAll('a[href*="/c/"]')) {
      const raw = a.href || a.getAttribute('href') || '';
      if (!raw) continue;
      let absolute;
      try { absolute = new URL(raw, location.origin).href; } catch { continue; }
      if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(absolute)) continue;
      scanned++;
      const owner = stableProjectId(absolute);
      if (projectKey && owner !== projectKey) {
        rejected.add(conversationKey(absolute));
        continue;
      }
      const key = conversationKey(absolute);
      const title = clean(a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || 'ChatGPT conversation');
      if (!found.has(key)) found.set(key,{key,title:title.slice(0,180),url:absolute});
      accepted.push(a);
    }
    return accepted;
  }

  function nearestScrollHost(el) {
    let cur = el?.parentElement || null;
    while (cur && cur !== document.body) {
      const delta = (cur.scrollHeight || 0) - (cur.clientHeight || 0);
      const style = getComputedStyle(cur);
      if (delta > 24 && /auto|scroll|overlay/i.test(style.overflowY || '')) return cur;
      if (cur === main) break;
      cur = cur.parentElement;
    }
    // Some virtualizers don't expose overflowY but still have a larger scrollHeight.
    cur = el?.parentElement || null;
    while (cur && cur !== document.body) {
      if ((cur.scrollHeight || 0) - (cur.clientHeight || 0) > 24) return cur;
      if (cur === main) break;
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function hostInfo(host) {
    const doc = host === document.scrollingElement || host === document.documentElement || host === document.body;
    const pos = doc ? window.scrollY : (host.scrollTop || 0);
    const view = doc ? window.innerHeight : (host.clientHeight || 0);
    const max = doc
      ? Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0)
      : (host.scrollHeight || 0);
    return {doc,pos,view,max};
  }

  function setHostPos(host,pos) {
    const info = hostInfo(host);
    if (info.doc) window.scrollTo(0,pos);
    else host.scrollTop = pos;
  }

  function rowBottom(a) {
    const r = a.getBoundingClientRect();
    return r.bottom;
  }

  const trace = [];
  let stableRounds = 0;
  let lastCount = -1;
  let lastSignature = '';

  // Start from whatever ChatGPT rendered initially.
  let anchors = projectAnchors();
  if (!anchors.length) {
    return {
      projectKey,
      direct:[],
      rows:[],
      rateLimited:false,
      diag:{strategy:'row-driven-parser-v1',reason:'no project conversation anchors in main',projectTitle,scanned,rejectedWrongProject:rejected.size}
    };
  }

  for (let round=0; round<140; round++) {
    anchors = projectAnchors();
    if (!anchors.length) break;

    const last = [...anchors].sort((a,b)=>rowBottom(a)-rowBottom(b)).at(-1);
    const host = nearestScrollHost(last);
    const before = hostInfo(host);
    const beforeCount = found.size;

    // Scroll the list itself, then make sure the last rendered row is pushed to the bottom edge.
    if (before.max > before.view + 4) {
      const step = Math.max(260, Math.floor(before.view * 0.82));
      setHostPos(host, Math.min(before.max, before.pos + step));
    }
    try { last.scrollIntoView({block:'end',inline:'nearest'}); } catch {}
    try { host.dispatchEvent(new Event('scroll',{bubbles:true})); } catch {}

    await wait(520);
    anchors = projectAnchors();
    const after = hostInfo(host);
    const afterCount = found.size;
    const signature = `${after.pos}|${after.max}|${afterCount}|${anchors.map(a=>conversationKey(a.href || '')).join(',')}`;

    trace.push({
      round,
      rendered:anchors.length,
      unique:afterCount,
      hostTag:host?.tagName || 'DOCUMENT',
      hostRole:host?.getAttribute?.('role') || null,
      pos:Math.round(after.pos),
      view:Math.round(after.view),
      max:Math.round(after.max)
    });

    const grew = afterCount > beforeCount;
    const moved = Math.abs(after.pos - before.pos) > 2 || Math.abs(after.max - before.max) > 2;
    const changedWindow = signature !== lastSignature;

    if (!grew && !moved && !changedWindow && afterCount === lastCount) stableRounds++;
    else stableRounds = 0;

    // At the bottom, give lazy/virtualized rows a longer settle window before declaring done.
    if (after.pos + after.view >= after.max - 6) {
      await wait(900);
      projectAnchors();
      if (found.size > afterCount) stableRounds = 0;
      else stableRounds++;
    }

    lastCount = found.size;
    lastSignature = signature;
    if (stableRounds >= 5) break;
  }

  const mr = main.getBoundingClientRect();
  return {
    projectKey,
    direct:[...found.values()].slice(0,500),
    rows:[],
    rateLimited:false,
    diag:{
      strategy:'row-driven-parser-v1',
      projectTitle,
      mainX:Math.round(mr.x),
      mainW:Math.round(mr.width),
      scannedAnchors:scanned,
      accepted:found.size,
      rejectedWrongProject:rejected.size,
      rounds:trace.length,
      tail:trace.slice(-12)
    }
  };
}

// Make the single-pass inventory use exactly this parser.
shinoMainProjectAnchorsInPage = shinoParseProjectConversationsInPage;

(() => {
  const statusEl = document.getElementById('status');
  const probeButton = document.getElementById('probe');
  const copyButton = document.getElementById('copyProbe');
  const ingestButton = document.getElementById('ingestInventory');
  const inventoryButton = document.getElementById('projects');
  let lastParserProbe = '';

  // Never allow ingestion from an inventory produced by the undercounting scanners.
  chrome.storage.local.set({lastActiveTabInventory:null,lastSinglePassInventoryDraft:null}).catch(()=>{});
  if (ingestButton) {
    ingestButton.disabled = true;
    ingestButton.textContent = 'Ingest inventoried chats';
    ingestButton.title = 'Run a fresh parser-validated inventory first.';
  }
  if (inventoryButton) {
    inventoryButton.disabled = true;
    inventoryButton.title = 'Disabled until Music parser validation matches the known 33 conversations.';
  }

  if (probeButton) {
    probeButton.textContent = 'Parse current project conversations';
    probeButton.onclick = async () => {
      try {
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '') || !/\/g\/g-p-/i.test(tab.url || '')) {
          statusEl.textContent = 'Open the Music ChatGPT project page first.';
          return;
        }
        statusEl.textContent = 'PROJECT CONVERSATION PARSER\nWalking the project chat list itself…';
        const injected = await chrome.scripting.executeScript({
          target:{tabId:tab.id},
          func:shinoParseProjectConversationsInPage,
          args:['Music']
        });
        const result = injected?.[0]?.result;
        if (!result) throw new Error('No parser result');
        lastParserProbe = JSON.stringify({url:tab.url,projectKey:result.projectKey,threads:result.direct,diag:result.diag},null,2);
        await chrome.storage.local.set({lastProjectProbeText:lastParserProbe});
        if (copyButton) copyButton.disabled = false;

        const count = result.direct.length;
        statusEl.textContent = `PROJECT CONVERSATION PARSER\n${count} unique project conversations found\nprojectKey: ${result.projectKey || 'NONE'}\nstrategy: row-driven virtual-list parser\n\n${count === 33 ? '✅ MUSIC REFERENCE MATCH: 33/33' : '❌ MUSIC REFERENCE NOT MATCHED — do not run global inventory'}\n\n${result.direct.slice(0,12).map(t=>`• ${t.title}`).join('\n')}`;

        if (count === 33 && inventoryButton) {
          inventoryButton.disabled = false;
          inventoryButton.title = 'Parser validated on Music (33/33). Global single-pass inventory is now allowed.';
        }
      } catch (e) {
        statusEl.textContent = 'Project parser failed: ' + (e?.message || String(e));
      }
    };
  }

  if (copyButton) copyButton.onclick = async () => {
    if (!lastParserProbe) {
      const stored = await chrome.storage.local.get({lastProjectProbeText:''});
      lastParserProbe = stored.lastProjectProbeText || '';
    }
    if (!lastParserProbe) return void(statusEl.textContent='Run the project parser first.');
    await navigator.clipboard.writeText(lastParserProbe);
    statusEl.textContent = 'Project parser report copied.';
  };
})();
