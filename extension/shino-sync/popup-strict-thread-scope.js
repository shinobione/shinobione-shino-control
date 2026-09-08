// v0.5.6 strict per-project thread inventory.
// Loaded last so it replaces the backfill handler without changing normal auto-sync/retry behavior.

async function shinoStrictInventoryInPage(projectTitle = '') {
  const sleepLocal = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const normLocal = value => clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const visible = el => {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) !== 0;
  };
  const textOf = el => clean(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
  const projectKeyFromUrlLocal = (url = location.href) => {
    try { return new URL(url, location.origin).pathname.match(/\/g\/(g-p-[^/?#]+)/i)?.[1] || null; }
    catch { return null; }
  };
  const conversationKeyLocal = (url = '') => {
    try {
      const u = new URL(url, location.origin);
      return u.pathname.match(/\/c\/([^/?#]+)/)?.[1] || `${u.pathname}${u.search}`;
    } catch { return url; }
  };
  const isUi = text => {
    const t = normLocal(text);
    if (!t || t.length < 2 || t.length > 180) return true;
    return /^(chatgpt|projects?|new chat|library|scheduled|plugins|more|pinned|recents|files|instructions|project instructions|add files|search|share|new|settings|temporary chat)$/i.test(t);
  };
  const clickableAncestor = (el, max = 5) => {
    let cur = el;
    for (let i = 0; cur && i < max; i++, cur = cur.parentElement) {
      const tag = String(cur.tagName || '').toLowerCase();
      const role = String(cur.getAttribute?.('role') || '').toLowerCase();
      const tabindex = cur.getAttribute?.('tabindex');
      const cursor = getComputedStyle(cur).cursor;
      if (tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || cursor === 'pointer' || (tabindex != null && Number(tabindex) >= 0)) return cur;
    }
    return null;
  };

  function projectTitleNode() {
    const wanted = normLocal(projectTitle);
    if (!wanted) return null;
    const candidates = [...document.querySelectorAll('h1,h2,h3,[role="heading"],button,span,div')]
      .filter(el => visible(el) && normLocal(textOf(el)) === wanted)
      .map(el => ({ el, r:el.getBoundingClientRect(), descendants:el.querySelectorAll('*').length }))
      .filter(x => x.r.height <= 120 && x.r.width <= Math.max(1200, innerWidth * .65));
    candidates.sort((a,b) => {
      if (Math.abs(a.r.left - b.r.left) > 20) return b.r.left - a.r.left; // central project title beats sidebar copy
      if (a.descendants !== b.descendants) return a.descendants - b.descendants;
      return (a.r.width * a.r.height) - (b.r.width * b.r.height);
    });
    return candidates[0]?.el || null;
  }

  const titleEl = projectTitleNode();
  const titleRect = titleEl?.getBoundingClientRect() || null;
  const minX = titleRect ? Math.max(0, titleRect.left - 140) : (innerWidth >= 900 ? Math.min(430, innerWidth * .24) : 0);
  const maxX = titleRect ? Math.min(innerWidth, titleRect.left + Math.max(1100, innerWidth * .55)) : innerWidth;

  function inProjectBand(el) {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.right >= minX && r.left <= maxX;
  }

  function contentRoot() {
    if (titleEl) {
      let cur = titleEl.parentElement;
      let fallback = null;
      for (let i = 0; cur && i < 9; i++, cur = cur.parentElement) {
        if (!visible(cur)) continue;
        const r = cur.getBoundingClientRect();
        if (r.width < 340 || r.height < 220) continue;
        if (r.right < minX || r.left > maxX) continue;
        const hasForeignNav = [...cur.querySelectorAll('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]')]
          .some(el => el !== cur && visible(el));
        if (!hasForeignNav) return cur; // smallest useful ancestor wins
        if (!fallback && r.width < innerWidth * .82) fallback = cur;
      }
      if (fallback) return fallback;
    }
    const roleMain = document.querySelector('[role="main"]');
    if (roleMain && inProjectBand(roleMain)) return roleMain;
    const main = document.querySelector('main');
    if (main && inProjectBand(main)) return main;
    return document.body;
  }

  const root = contentRoot();
  function sidebarLike(el) {
    if (!el || !(el instanceof Element)) return true;
    if (!inProjectBand(el)) return true;
    const semantic = el.closest('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]');
    return !!(semantic && semantic !== root);
  }
  const scopedNodes = selector => [...root.querySelectorAll(selector)].filter(el => visible(el) && !sidebarLike(el));

  const projectKey = projectKeyFromUrlLocal();
  const direct = new Map();
  const rows = new Map();

  function scanDirect() {
    for (const a of scopedNodes('a[href]')) {
      const raw = a.href || a.getAttribute('href') || '';
      if (!raw || !/\/c\//i.test(raw)) continue;
      let absolute;
      try { absolute = new URL(raw, location.origin).href; } catch { continue; }
      if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(absolute)) continue;
      const explicitProject = projectKeyFromUrlLocal(absolute);
      if (projectKey && explicitProject && explicitProject !== projectKey) continue;
      const key = conversationKeyLocal(absolute);
      const title = textOf(a) || 'ChatGPT conversation';
      if (!direct.has(key)) direct.set(key, { key, title:title.slice(0,180), url:absolute });
    }
  }

  function scanRows() {
    const exclude = new Set([normLocal(projectTitle), 'files', 'instructions', 'project instructions', 'add files', 'new chat']);
    for (const el of scopedNodes('a,button,[role="link"],[role="button"],[tabindex],div,span,p')) {
      const title = textOf(el);
      const key = normLocal(title);
      if (!key || exclude.has(key) || isUi(title) || title.length > 180) continue;
      if (/\b(today|yesterday|modified|created by you|shared with you)\b/i.test(title)) continue;
      if (/^\d{1,2}[:/]\d{1,2}/.test(title)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 96 || r.width < 70) continue;
      const click = clickableAncestor(el, 4);
      if (!click || sidebarLike(click)) continue;
      const clickText = textOf(click);
      if (clickText.length > 220) continue;
      const score = el.querySelectorAll('*').length * 5 + click.querySelectorAll('*').length * 2 + r.height / 3 + title.length / 100;
      const prev = rows.get(key);
      if (!prev || score < prev.score) rows.set(key, { title, score });
    }
  }

  function scrollTarget() {
    let winner = null;
    let delta = 0;
    for (const el of [root, ...root.querySelectorAll('div,section')]) {
      if (!visible(el) || sidebarLike(el)) continue;
      const d = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (d <= delta + 40) continue;
      const oy = getComputedStyle(el).overflowY;
      if (el === root || oy === 'auto' || oy === 'scroll') { winner = el; delta = d; }
    }
    return winner || document.scrollingElement || document.documentElement;
  }

  const scroll = scrollTarget();
  const isDoc = scroll === document.scrollingElement || scroll === document.documentElement || scroll === document.body;
  const original = isDoc ? window.scrollY : scroll.scrollTop;
  try {
    if (isDoc) window.scrollTo(0,0); else scroll.scrollTop = 0;
    await sleepLocal(250);
    let stable = 0;
    let last = '';
    for (let i = 0; i < 55; i++) {
      scanDirect(); scanRows();
      const max = isDoc ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) : scroll.scrollHeight;
      const pos = isDoc ? window.scrollY : scroll.scrollTop;
      const viewport = isDoc ? window.innerHeight : scroll.clientHeight;
      const fp = `${direct.size}|${rows.size}|${Math.round(max)}|${Math.round(pos)}`;
      if (fp === last) stable++; else stable = 0;
      last = fp;
      if (pos + viewport >= max - 12 && stable >= 2) break;
      const next = Math.min(max, pos + Math.max(280, viewport * .74));
      if (isDoc) window.scrollTo(0,next); else scroll.scrollTop = next;
      await sleepLocal(280);
    }
    scanDirect(); scanRows();
  } finally {
    if (isDoc) window.scrollTo(0,original); else scroll.scrollTop = original;
  }

  const rr = root.getBoundingClientRect();
  return {
    projectKey,
    direct:[...direct.values()].slice(0,220),
    rows:[...rows.values()].sort((a,b)=>a.score-b.score).slice(0,160).map(({title})=>({title})),
    diag:{ titleFound:!!titleEl, minX:Math.round(minX), rootTag:root.tagName, rootLeft:Math.round(rr.left), rootWidth:Math.round(rr.width) }
  };
}

async function shinoStrictClickInPage(projectTitle = '', rowTitle = '') {
  const sleepLocal = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const normLocal = value => clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  const visible = el => {
    if (!el || !(el instanceof Element)) return false;
    const r=el.getBoundingClientRect(); if(r.width<1||r.height<1)return false;
    const s=getComputedStyle(el); return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)!==0;
  };
  const textOf = el => clean(el?.innerText||el?.textContent||el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||'');
  const wantedProject = normLocal(projectTitle), wantedRow = normLocal(rowTitle);
  const titleCandidates=[...document.querySelectorAll('h1,h2,h3,[role="heading"],button,span,div')]
    .filter(el=>visible(el)&&normLocal(textOf(el))===wantedProject)
    .map(el=>({el,r:el.getBoundingClientRect(),d:el.querySelectorAll('*').length}));
  titleCandidates.sort((a,b)=>Math.abs(a.r.left-b.r.left)>20?b.r.left-a.r.left:a.d-b.d);
  const titleEl=titleCandidates[0]?.el||null;
  const tr=titleEl?.getBoundingClientRect()||null;
  const minX=tr?Math.max(0,tr.left-140):(innerWidth>=900?Math.min(430,innerWidth*.24):0);
  const maxX=tr?Math.min(innerWidth,tr.left+Math.max(1100,innerWidth*.55)):innerWidth;
  const inBand=el=>{if(!visible(el))return false;const r=el.getBoundingClientRect();return r.right>=minX&&r.left<=maxX;};
  let root=null;
  if(titleEl){let cur=titleEl.parentElement;for(let i=0;cur&&i<9;i++,cur=cur.parentElement){if(!visible(cur))continue;const r=cur.getBoundingClientRect();if(r.width<340||r.height<220||r.right<minX||r.left>maxX)continue;const nav=[...cur.querySelectorAll('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]')].some(el=>el!==cur&&visible(el));if(!nav){root=cur;break;}}}
  root ||= document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
  const sidebarLike=el=>{if(!inBand(el))return true;const sem=el.closest('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]');return !!(sem&&sem!==root);};
  const clickable=el=>{let cur=el;for(let i=0;cur&&i<5;i++,cur=cur.parentElement){const tag=String(cur.tagName||'').toLowerCase(),role=String(cur.getAttribute?.('role')||'').toLowerCase(),ti=cur.getAttribute?.('tabindex'),cursor=getComputedStyle(cur).cursor;if(tag==='a'||tag==='button'||role==='link'||role==='button'||cursor==='pointer'||(ti!=null&&Number(ti)>=0))return cur;}return null;};
  const realClick=el=>{const target=clickable(el)||el;target.scrollIntoView({block:'center',inline:'nearest'});const r=target.getBoundingClientRect();const x=r.left+Math.max(2,Math.min(r.width-2,r.width/2)),y=r.top+Math.max(2,Math.min(r.height-2,r.height/2));const base={bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,button:0};try{target.dispatchEvent(new PointerEvent('pointerdown',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:1}));}catch{}target.dispatchEvent(new MouseEvent('mousedown',{...base,buttons:1}));try{target.dispatchEvent(new PointerEvent('pointerup',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:0}));}catch{}target.dispatchEvent(new MouseEvent('mouseup',{...base,buttons:0}));target.dispatchEvent(new MouseEvent('click',{...base,buttons:0}));return target;};
  const scrollCandidates=[root,...root.querySelectorAll('div,section')].filter(el=>visible(el)&&!sidebarLike(el));
  let scroll=null,delta=0;for(const el of scrollCandidates){const d=(el.scrollHeight||0)-(el.clientHeight||0),oy=getComputedStyle(el).overflowY;if(d>delta+40&&(el===root||oy==='auto'||oy==='scroll')){scroll=el;delta=d;}}
  scroll ||= document.scrollingElement||document.documentElement;
  const isDoc=scroll===document.scrollingElement||scroll===document.documentElement||scroll===document.body;
  const original=isDoc?window.scrollY:scroll.scrollTop;
  try{
    if(isDoc)window.scrollTo(0,0);else scroll.scrollTop=0;
    for(let pass=0;pass<55;pass++){
      const matches=[...root.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],div,span,p')]
        .filter(el=>visible(el)&&!sidebarLike(el)&&normLocal(textOf(el))===wantedRow&&clickable(el))
        .sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length||a.getBoundingClientRect().height-b.getBoundingClientRect().height);
      if(matches.length){const t=realClick(matches[0]);return{ok:true,clicked:true,tag:t.tagName,role:t.getAttribute?.('role')||null};}
      const max=isDoc?Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0):scroll.scrollHeight;
      const pos=isDoc?window.scrollY:scroll.scrollTop,view=isDoc?window.innerHeight:scroll.clientHeight;
      if(pos+view>=max-12)break;
      const next=Math.min(max,pos+Math.max(280,view*.74));if(isDoc)window.scrollTo(0,next);else scroll.scrollTop=next;await sleepLocal(220);
    }
    return{ok:false,clicked:false,error:`Strict thread row not found: ${rowTitle}`};
  }finally{if(isDoc)window.scrollTo(0,original);else scroll.scrollTop=original;}
}

async function shinoStrictInventoryForProject(project) {
  let result = { direct:[], rows:[], diag:null };
  await withTemporaryTab(project.url, async tab => {
    await sleep(700);
    const injected = await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:shinoStrictInventoryInPage, args:[project.title] });
    result = injected?.[0]?.result || result;
  });
  const ctx = {
    projectKey:project.key || result.projectKey || projectKeyFromUrl(project.url),
    projectTitle:project.title,
    projectUrl:project.url
  };
  const direct = (result.direct || []).map(t=>({ ...t, ...ctx }));
  return { direct, rows:result.rows || [], diag:result.diag || null };
}

async function shinoStrictRecoverRows(project, rows, directThreads = []) {
  if (!rows?.length) return [];
  const knownTitles = new Set((directThreads || []).map(t=>norm(t.title)).filter(Boolean));
  const candidates = rows.filter(r=>!knownTitles.has(norm(r.title))).slice(0,90);
  if (!candidates.length) return [];
  const worker = await chrome.tabs.create({url:project.url,active:false});
  const recovered = new Map();
  const expectedProjectKey = project.key || projectKeyFromUrl(project.url);
  try {
    await waitForTab(worker.id);
    let attempted=0;
    for(const row of candidates){
      if(attempted>0){await chrome.tabs.update(worker.id,{url:project.url});await waitForTab(worker.id).catch(()=>null);await sleep(350);}
      const before=(await chrome.tabs.get(worker.id)).url;
      const injected=await chrome.scripting.executeScript({target:{tabId:worker.id},func:shinoStrictClickInPage,args:[project.title,row.title]}).catch(()=>null);
      attempted++;
      const clicked=injected?.[0]?.result;
      if(!clicked?.clicked)continue;
      const nav=await waitForNavigation(worker.id,before,url=>isChatGptUrl(url)&&/\/c\//i.test(url),4800);
      if(!nav?.url)continue;
      const explicit=projectKeyFromUrl(nav.url);
      if(expectedProjectKey&&explicit&&explicit!==expectedProjectKey)continue;
      const key=conversationKeyFromUrl(nav.url);
      if(!recovered.has(key))recovered.set(key,{key,title:row.title,url:nav.url,projectKey:expectedProjectKey,projectTitle:project.title,projectUrl:project.url});
    }
    return [...recovered.values()];
  } finally { await chrome.tabs.remove(worker.id).catch(()=>{}); }
}

// Replace only the full-backfill handler. Retry-failed-only remains provided by popup-thread-patch.js.
$('projects').onclick = async () => {
  try {
    const cfg=await readUiAndSave();
    if(!cfg.enabled)return void($('status').textContent='Turn on Auto-sync this browser first');
    const seed=await activeChatTab();
    if(!seed)return void($('status').textContent='Open ChatGPT first');
    $('status').textContent='Opening full ChatGPT Projects index…';
    const pageInfo=await messageTab(seed.id,{type:'SHINO_FIND_PROJECTS_PAGE'}).catch(()=>null);
    const projectsPage=pageInfo?.url||`${new URL(seed.url).origin}/projects`;
    let directProjects=[];
    await withTemporaryTab(projectsPage,async tab=>{const result=await messageTab(tab.id,{type:'SHINO_DISCOVER_ALL_PROJECTS'}).catch(()=>null);directProjects=result?.projects||[];});
    const rowRecovery=await shinoDiscoverProjectUrlsByRows(projectsPage,directProjects).catch(()=>({rows:[],projects:[]}));
    let projects=mergeProjects(directProjects,rowRecovery.projects||[]);
    if(!projects.length){const fallback=await messageTab(seed.id,{type:'SHINO_DISCOVER_PINNED_PROJECTS'}).catch(()=>null);projects=mergeProjects(fallback?.projects||[]);}
    if(!projects.length)return void($('status').textContent='No project routes recovered.');

    $('status').textContent=`STRICT PROJECT INVENTORY: ${projects.length}\n${projects.map(p=>p.title).join(' · ')}`;
    await sleep(500);

    const threads=new Map();
    const ownerByKey=new Map();
    const collisions=[];
    const perProject=[];
    let done=0;

    for(const project of projects){
      let inv={direct:[],rows:[],diag:null};
      try{inv=await shinoStrictInventoryForProject(project);}catch(e){perProject.push({title:project.title,total:0,error:e?.message||String(e)});done++;continue;}
      let recovered=[];
      if(inv.rows.length)recovered=await shinoStrictRecoverRows(project,inv.rows,inv.direct).catch(()=>[]);
      const merged=shinoMergeThreads(inv.direct,recovered);
      for(const thread of merged){
        const key=thread.key||conversationKeyFromUrl(thread.url);
        const previous=ownerByKey.get(key);
        if(previous&&previous!==project.title){collisions.push({key,a:previous,b:project.title,title:thread.title});continue;}
        ownerByKey.set(key,project.title);
        if(!threads.has(key))threads.set(key,thread);
      }
      perProject.push({title:project.title,total:merged.length,direct:inv.direct.length,recovered:recovered.length,rows:inv.rows.length,diag:inv.diag});
      done++;
      $('status').textContent=`STRICT THREAD INVENTORY ${done}/${projects.length}\n${project.title}: ${merged.length} (${inv.direct.length} href + ${recovered.length} recovered)\nTOTAL UNIQUE: ${threads.size}${collisions.length?` · COLLISIONS: ${collisions.length}`:''}`;
    }

    const report=perProject.map(x=>`${x.title}: ${x.total}`).join(' · ');
    if(collisions.length){
      const sample=collisions.slice(0,8).map(c=>`${c.a} ↔ ${c.b}: ${c.title||c.key}`).join('\n');
      const msg=`INVENTORY SAFETY STOP — ${collisions.length} cross-project conversation collision${collisions.length===1?'':'s'} detected.\nNothing was ingested.\n${sample}\n${report}`;
      $('status').textContent=msg;
      await chrome.storage.local.set({lastStatus:msg,lastError:'Cross-project inventory contamination',lastBackfillProjectReport:perProject});
      return;
    }

    const queue=[...threads.values()].slice(0,400);
    if(!queue.length)return void($('status').textContent=`${projects.length} projects recovered, but 0 strict conversation routes found.\n${report}`);
    $('status').textContent=`STRICT INVENTORY COMPLETE: ${queue.length} unique conversations\n${report}\nStarting ingestion…`;
    await sleep(700);
    const {counts,failedThreads}=await shinoIngestQueue(queue,'Backfill');
    const final=`ALL-project backfill complete\n${projects.length} projects · ${queue.length} strict unique conversations\n${counts.mapped} mapped · ${counts.discovered} discovered · ${counts.failed} failed\n${report}${failedThreads.length?`\nRetry button armed for ${failedThreads.length} failures`:''}`;
    $('status').textContent=final;
    await chrome.storage.local.set({lastStatus:final,lastError:'',lastBackfillProjectReport:perProject});
  } catch(e) {
    $('status').textContent='Strict project backfill failed: '+(e.message||String(e));
  }
};
