// v0.6.0 — use the real project anchors rendered inside <main>.
// Probe evidence showed ChatGPT renders project conversations as links like:
// /g/g-p-<stable-id>-<slug>/c/<conversation-id>
// while the project page itself may be /g/g-p-<stable-id>/project.
// The stable project identity is the base g-p-<32 hex> portion; the readable slug is not part of the ID.

function shinoStableProjectId(url = '') {
  try {
    const pathname = new URL(url, 'https://chatgpt.com').pathname;
    return pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null;
  } catch { return null; }
}

// Override the older popup helper so project inventory, collision checks and capture context
// all compare the same stable ID regardless of ChatGPT's optional readable slug.
projectKeyFromUrl = function(url = '') {
  return shinoStableProjectId(url);
};

async function shinoMainProjectAnchorsInPage(projectTitle = '') {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const conversationKey = url => {
    try { return new URL(url, location.origin).pathname.match(/\/c\/([^/?#]+)/)?.[1] || url; }
    catch { return url; }
  };
  const stableProjectId = url => {
    try { return new URL(url, location.origin).pathname.match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/?#]+)?(?:\/|$)/i)?.[1] || null; }
    catch { return null; }
  };

  const projectKey = stableProjectId(location.href);
  const pageText = clean(document.body?.innerText || '');
  if (/too many requests|temporarily limited access|making requests too quickly/i.test(pageText)) {
    return { projectKey, direct:[], rows:[], rateLimited:true, diag:{ reason:'rate-limit page' } };
  }

  const main = document.querySelector('main') || document.querySelector('[role="main"]');
  if (!main) return { projectKey, direct:[], rows:[], rateLimited:false, diag:{ reason:'no-main' } };

  const found = new Map();
  let scannedAnchors = 0;
  let rejectedWrongProject = 0;

  function scan() {
    for (const a of main.querySelectorAll('a[href*="/c/"]')) {
      const raw = a.href || a.getAttribute('href') || '';
      if (!raw) continue;
      let absolute;
      try { absolute = new URL(raw, location.origin).href; } catch { continue; }
      if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(absolute)) continue;
      scannedAnchors++;
      const owner = stableProjectId(absolute);
      if (projectKey && owner !== projectKey) {
        rejectedWrongProject++;
        continue;
      }
      const key = conversationKey(absolute);
      const title = clean(a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || 'ChatGPT conversation');
      if (!found.has(key)) found.set(key, { key, title:title.slice(0,180), url:absolute });
    }
  }

  function scrollRoots() {
    const roots = [];
    for (const el of [main, ...main.querySelectorAll('[role="tabpanel"],div,section')]) {
      const delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
      const oy = getComputedStyle(el).overflowY;
      if (delta > 80 && (el === main || oy === 'auto' || oy === 'scroll')) roots.push(el);
    }
    return [...new Set(roots)].sort((a,b) => ((b.scrollHeight||0)-(b.clientHeight||0)) - ((a.scrollHeight||0)-(a.clientHeight||0))).slice(0,4);
  }

  scan();
  const roots = scrollRoots();
  const originals = roots.map(root => ({ root, top:root.scrollTop }));
  try {
    for (const root of roots) {
      root.scrollTop = 0;
      await wait(180);
      let previous = -1;
      for (let pass = 0; pass < 40; pass++) {
        scan();
        const max = root.scrollHeight || 0;
        const view = root.clientHeight || 0;
        const pos = root.scrollTop || 0;
        if (pos + view >= max - 8 || Math.round(pos) === previous) break;
        previous = Math.round(pos);
        root.scrollTop = Math.min(max, pos + Math.max(240, view * 0.72));
        await wait(180);
      }
      scan();
    }
  } finally {
    for (const {root, top} of originals) root.scrollTop = top;
  }

  const mr = main.getBoundingClientRect();
  return {
    projectKey,
    direct:[...found.values()].slice(0,220),
    rows:[],
    rateLimited:false,
    diag:{
      strategy:'main-project-anchors',
      mainX:Math.round(mr.x),
      mainW:Math.round(mr.width),
      scannedAnchors,
      accepted:found.size,
      rejectedWrongProject,
      scrollRoots:roots.length
    }
  };
}

// Replace v0.5.8 inventory with the exact DOM shape proven by the v0.5.9 probe.
shinoStrictInventoryForProject = async function(project) {
  let result = { direct:[], rows:[], diag:null, rateLimited:false };
  await withTemporaryTab(project.url, async tab => {
    await sleep(850);
    const limited = await shinoRateLimitOnTab(tab.id).catch(() => null);
    if (limited) {
      result = { ...result, rateLimited:true, diag:{reason:'rate-limit page'} };
      return;
    }
    const injected = await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func:shinoMainProjectAnchorsInPage,
      args:[project.title]
    });
    result = injected?.[0]?.result || result;
  });

  if (result.rateLimited) {
    await shinoArmRateLimit('Too many requests while scanning project inventory');
    throw new Error('RATE_LIMITED during project inventory');
  }

  const stable = shinoStableProjectId(project.url) || result.projectKey || project.key || null;
  const ctx = { projectKey:stable, projectTitle:project.title, projectUrl:project.url };
  return {
    direct:(result.direct || []).map(thread => ({ ...thread, ...ctx })),
    rows:[],
    diag:result.diag || null
  };
};

// Main project rows are already real anchors; no click-recovery is needed.
shinoStrictRecoverRows = async function() { return []; };

// v0.5.9 intentionally disabled full backfill. The DOM shape is now known, so restore it.
const shinoProjectsButton = document.getElementById('projects');
if (shinoProjectsButton) {
  shinoProjectsButton.disabled = false;
  shinoProjectsButton.title = 'Backfill using only conversation anchors inside the active project main area.';
}

// Replace the diagnostic probe with a concise proof of the same selector used by backfill.
const shinoProbeButton = document.getElementById('probe');
const shinoCopyProbeButton = document.getElementById('copyProbe');
const shinoStatus = document.getElementById('status');
let shinoLastMainProbe = '';

async function shinoActiveProjectTab() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  return tab?.id && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '') ? tab : null;
}

if (shinoProbeButton) shinoProbeButton.onclick = async () => {
  try {
    const tab = await shinoActiveProjectTab();
    if (!tab || !/\/g\/g-p-/i.test(tab.url || '')) {
      shinoStatus.textContent = 'Open a ChatGPT project page first.';
      return;
    }
    const injected = await chrome.scripting.executeScript({target:{tabId:tab.id},func:shinoMainProjectAnchorsInPage,args:['']});
    const result = injected?.[0]?.result;
    if (!result) throw new Error('No main-anchor probe result');
    shinoLastMainProbe = JSON.stringify({url:tab.url,projectKey:result.projectKey,threads:result.direct,diag:result.diag}, null, 2);
    await chrome.storage.local.set({lastProjectProbeText:shinoLastMainProbe});
    shinoStatus.textContent = `MAIN PROJECT PROBE\n${result.direct.length} project conversation anchor${result.direct.length===1?'':'s'} found\nprojectKey: ${result.projectKey || 'NONE'}\nstrategy: main only · sidebar excluded\n${result.direct.slice(0,8).map(t=>`• ${t.title}`).join('\n')}`;
    if (shinoCopyProbeButton) shinoCopyProbeButton.disabled = false;
  } catch (e) {
    shinoStatus.textContent = 'Main project probe failed: ' + (e?.message || String(e));
  }
};

if (shinoCopyProbeButton) shinoCopyProbeButton.onclick = async () => {
  if (!shinoLastMainProbe) {
    const stored = await chrome.storage.local.get({lastProjectProbeText:''});
    shinoLastMainProbe = stored.lastProjectProbeText || '';
  }
  if (!shinoLastMainProbe) return void (shinoStatus.textContent = 'Run Probe current project first.');
  await navigator.clipboard.writeText(shinoLastMainProbe);
  shinoStatus.textContent = 'Main project probe copied.';
};
