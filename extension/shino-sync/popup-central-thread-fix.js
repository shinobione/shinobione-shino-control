// v0.5.8 — central-area thread inventory fallback.
// The v0.5.6 ancestor-root heuristic could select the project header card itself,
// which made every project report 0 threads. This replacement scans the whole
// rendered page but rejects the left ChatGPT sidebar geometrically + semantically.

async function shinoCentralInventoryInPage(projectTitle = '') {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  const projectKey = projectKeyFromUrlLocal();
  const pageText = clean(document.body?.innerText || '');
  if (/too many requests|temporarily limited access|making requests too quickly/i.test(pageText)) {
    return { projectKey, direct:[], rows:[], rateLimited:true, diag:{ reason:'rate-limit page' } };
  }

  function semanticSidebar(el) {
    return !!el?.closest?.('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]');
  }

  function inferSidebarRight() {
    let right = 0;
    const candidates = [...document.querySelectorAll('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]')];
    for (const el of candidates) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left > 80 || r.width > 520 || r.height < Math.min(300, innerHeight * 0.45)) continue;
      right = Math.max(right, r.right);
    }
    // ChatGPT desktop sidebar is normally ~260px. If semantic markup changes,
    // keep a conservative left exclusion band instead of falling back to body-wide scanning.
    if (innerWidth >= 900) right = Math.max(right, Math.min(340, innerWidth * 0.18));
    return right;
  }

  const sidebarRight = inferSidebarRight();
  const central = el => {
    if (!visible(el) || semanticSidebar(el)) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    return cx > sidebarRight + 18 && r.right > sidebarRight + 36;
  };

  const direct = new Map();
  const rows = new Map();
  let centralAnchorsSeen = 0;
  let centralClickablesSeen = 0;

  function clickableAncestor(el, max = 5) {
    let cur = el;
    for (let i = 0; cur && i < max; i++, cur = cur.parentElement) {
      if (!central(cur)) continue;
      const tag = String(cur.tagName || '').toLowerCase();
      const role = String(cur.getAttribute?.('role') || '').toLowerCase();
      const ti = cur.getAttribute?.('tabindex');
      const cursor = getComputedStyle(cur).cursor;
      if (tag === 'a' || tag === 'button' || role === 'link' || role === 'button' || cursor === 'pointer' || (ti != null && Number(ti) >= 0)) return cur;
    }
    return null;
  }

  const uiWords = /^(chatgpt|projects?|new chat|library|scheduled|plugins|more|pinned|recents|files|instructions|project instructions|add files|search|share|new|settings|temporary chat|upload|create|edit|delete)$/i;

  function scan() {
    for (const a of document.querySelectorAll('a[href]')) {
      if (!central(a)) continue;
      const raw = a.href || a.getAttribute('href') || '';
      if (!raw || !/\/c\//i.test(raw)) continue;
      centralAnchorsSeen++;
      let absolute;
      try { absolute = new URL(raw, location.origin).href; } catch { continue; }
      if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(absolute)) continue;
      const explicit = projectKeyFromUrlLocal(absolute);
      if (projectKey && explicit && explicit !== projectKey) continue;
      const title = textOf(a) || 'ChatGPT conversation';
      const key = conversationKeyLocal(absolute);
      if (!direct.has(key)) direct.set(key, { key, title:title.slice(0,180), url:absolute });
    }

    // Rows without href: only consider genuinely clickable central elements with compact text.
    for (const el of document.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],div,span,p')) {
      if (!central(el)) continue;
      const title = textOf(el);
      const n = normLocal(title);
      if (!n || n === normLocal(projectTitle) || title.length < 2 || title.length > 180 || uiWords.test(title)) continue;
      if (/\b(today|yesterday|modified|created by you|shared with you)\b/i.test(title)) continue;
      if (/^\d{1,2}[:/]\d{1,2}/.test(title)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 14 || r.height > 110 || r.width < 70) continue;
      const click = clickableAncestor(el, 4);
      if (!click) continue;
      centralClickablesSeen++;
      const clickText = textOf(click);
      if (!clickText || clickText.length > 240 || uiWords.test(clickText)) continue;
      const score = el.querySelectorAll('*').length * 6 + click.querySelectorAll('*').length * 2 + Math.abs(r.height - 38) / 8 + title.length / 150;
      const prev = rows.get(n);
      if (!prev || score < prev.score) rows.set(n, { title, score });
    }
  }

  function scrollables() {
    const out = [];
    const doc = document.scrollingElement || document.documentElement;
    out.push(doc);
    for (const el of document.querySelectorAll('div,section,main')) {
      if (!central(el)) continue;
      const delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (delta < 180) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') out.push(el);
    }
    return [...new Set(out)].sort((a,b) => ((b.scrollHeight||0)-(b.clientHeight||0)) - ((a.scrollHeight||0)-(a.clientHeight||0))).slice(0,4);
  }

  const roots = scrollables();
  const originals = roots.map(root => ({ root, pos: root === document.scrollingElement || root === document.documentElement ? window.scrollY : root.scrollTop }));
  try {
    scan();
    for (const root of roots) {
      const isDoc = root === document.scrollingElement || root === document.documentElement || root === document.body;
      if (isDoc) window.scrollTo(0,0); else root.scrollTop = 0;
      await wait(180);
      let last = -1;
      for (let i = 0; i < 32; i++) {
        scan();
        const max = isDoc ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) : root.scrollHeight;
        const pos = isDoc ? window.scrollY : root.scrollTop;
        const view = isDoc ? window.innerHeight : root.clientHeight;
        if (pos + view >= max - 12 || Math.round(pos) === last) break;
        last = Math.round(pos);
        const next = Math.min(max, pos + Math.max(260, view * 0.72));
        if (isDoc) window.scrollTo(0,next); else root.scrollTop = next;
        await wait(190);
      }
    }
    scan();
  } finally {
    for (const item of originals) {
      const isDoc = item.root === document.scrollingElement || item.root === document.documentElement || item.root === document.body;
      if (isDoc) window.scrollTo(0,item.pos); else item.root.scrollTop = item.pos;
    }
  }

  const directTitles = new Set([...direct.values()].map(t => normLocal(t.title)).filter(Boolean));
  const filteredRows = [...rows.values()]
    .filter(r => !directTitles.has(normLocal(r.title)))
    .sort((a,b) => a.score - b.score)
    .slice(0,80)
    .map(({title}) => ({title}));

  return {
    projectKey,
    direct:[...direct.values()].slice(0,220),
    rows:filteredRows,
    rateLimited:false,
    diag:{ sidebarRight:Math.round(sidebarRight), centralAnchorsSeen, centralClickablesSeen, scrollRoots:roots.length }
  };
}

async function shinoCentralClickInPage(projectTitle = '', rowTitle = '') {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const normLocal = value => clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  const visible = el => {
    if (!el || !(el instanceof Element)) return false;
    const r=el.getBoundingClientRect();
    if(r.width<1||r.height<1)return false;
    const s=getComputedStyle(el);
    return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)!==0;
  };
  const textOf = el => clean(el?.innerText||el?.textContent||el?.getAttribute?.('aria-label')||el?.getAttribute?.('title')||'');
  const semanticSidebar = el => !!el?.closest?.('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]');
  let sidebarRight=0;
  for(const el of document.querySelectorAll('aside,nav,[role="navigation"],[data-testid*="sidebar" i],[class*="sidebar" i],[id*="sidebar" i]')){
    if(!visible(el))continue;
    const r=el.getBoundingClientRect();
    if(r.left<=80&&r.width<=520&&r.height>=Math.min(300,innerHeight*.45))sidebarRight=Math.max(sidebarRight,r.right);
  }
  if(innerWidth>=900)sidebarRight=Math.max(sidebarRight,Math.min(340,innerWidth*.18));
  const central=el=>{if(!visible(el)||semanticSidebar(el))return false;const r=el.getBoundingClientRect();return r.left+r.width/2>sidebarRight+18&&r.right>sidebarRight+36;};
  const clickable=el=>{let cur=el;for(let i=0;cur&&i<5;i++,cur=cur.parentElement){if(!central(cur))continue;const tag=String(cur.tagName||'').toLowerCase(),role=String(cur.getAttribute?.('role')||'').toLowerCase(),ti=cur.getAttribute?.('tabindex'),cursor=getComputedStyle(cur).cursor;if(tag==='a'||tag==='button'||role==='link'||role==='button'||cursor==='pointer'||(ti!=null&&Number(ti)>=0))return cur;}return null;};
  const realClick=el=>{const target=clickable(el)||el;target.scrollIntoView({block:'center',inline:'nearest'});const r=target.getBoundingClientRect();const x=r.left+Math.max(2,Math.min(r.width-2,r.width/2)),y=r.top+Math.max(2,Math.min(r.height-2,r.height/2));const base={bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,button:0};try{target.dispatchEvent(new PointerEvent('pointerdown',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:1}));}catch{}target.dispatchEvent(new MouseEvent('mousedown',{...base,buttons:1}));try{target.dispatchEvent(new PointerEvent('pointerup',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:0}));}catch{}target.dispatchEvent(new MouseEvent('mouseup',{...base,buttons:0}));target.dispatchEvent(new MouseEvent('click',{...base,buttons:0}));return target;};
  const wanted=normLocal(rowTitle);
  const roots=[document.scrollingElement||document.documentElement,...document.querySelectorAll('div,section,main')]
    .filter((el,i,arr)=>arr.indexOf(el)===i&&(!el.getBoundingClientRect||central(el))&&((el.scrollHeight||0)-(el.clientHeight||0)>160||i===0))
    .slice(0,5);
  for(const root of roots){
    const isDoc=root===document.scrollingElement||root===document.documentElement||root===document.body;
    const original=isDoc?window.scrollY:root.scrollTop;
    try{
      if(isDoc)window.scrollTo(0,0);else root.scrollTop=0;
      for(let pass=0;pass<32;pass++){
        const matches=[...document.querySelectorAll('a,button,[role="link"],[role="button"],[tabindex],div,span,p')]
          .filter(el=>central(el)&&normLocal(textOf(el))===wanted&&clickable(el))
          .sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length||a.getBoundingClientRect().height-b.getBoundingClientRect().height);
        if(matches.length){const t=realClick(matches[0]);return{ok:true,clicked:true,tag:t.tagName,role:t.getAttribute?.('role')||null};}
        const max=isDoc?Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0):root.scrollHeight;
        const pos=isDoc?window.scrollY:root.scrollTop,view=isDoc?window.innerHeight:root.clientHeight;
        if(pos+view>=max-12)break;
        const next=Math.min(max,pos+Math.max(260,view*.72));
        if(isDoc)window.scrollTo(0,next);else root.scrollTop=next;
        await wait(180);
      }
    } finally { if(isDoc)window.scrollTo(0,original);else root.scrollTop=original; }
  }
  return{ok:false,clicked:false,error:`Central thread row not found: ${rowTitle}`};
}

shinoStrictInventoryForProject = async function(project) {
  let result={direct:[],rows:[],diag:null,rateLimited:false};
  await withTemporaryTab(project.url,async tab=>{
    await sleep(850);
    const limited=await shinoRateLimitOnTab(tab.id).catch(()=>null);
    if(limited){result={...result,rateLimited:true,diag:{reason:'rate-limit page'}};return;}
    const injected=await chrome.scripting.executeScript({target:{tabId:tab.id},func:shinoCentralInventoryInPage,args:[project.title]});
    result=injected?.[0]?.result||result;
  });
  if(result.rateLimited){
    await shinoArmRateLimit('Too many requests while scanning project inventory');
    throw new Error('RATE_LIMITED during project inventory');
  }
  const ctx={projectKey:project.key||result.projectKey||projectKeyFromUrl(project.url),projectTitle:project.title,projectUrl:project.url};
  return{direct:(result.direct||[]).map(t=>({...t,...ctx})),rows:result.rows||[],diag:result.diag||null};
};

shinoStrictRecoverRows = async function(project,rows,directThreads=[]){
  if(!rows?.length)return[];
  const knownTitles=new Set((directThreads||[]).map(t=>norm(t.title)).filter(Boolean));
  const candidates=rows.filter(r=>!knownTitles.has(norm(r.title))).slice(0,45);
  if(!candidates.length)return[];
  const worker=await chrome.tabs.create({url:project.url,active:false});
  const recovered=new Map();
  const expectedProjectKey=project.key||projectKeyFromUrl(project.url);
  try{
    await waitForTab(worker.id);
    for(let i=0;i<candidates.length;i++){
      if(i>0){
        await sleep(shinoJitter?.(650,1050) || 800);
        await chrome.tabs.update(worker.id,{url:project.url});
        await waitForTab(worker.id).catch(()=>null);
        await sleep(500);
      }
      const limited=await shinoRateLimitOnTab(worker.id).catch(()=>null);
      if(limited){await shinoArmRateLimit(limited.text||'Too many requests');break;}
      const row=candidates[i];
      const before=(await chrome.tabs.get(worker.id)).url;
      const injected=await chrome.scripting.executeScript({target:{tabId:worker.id},func:shinoCentralClickInPage,args:[project.title,row.title]}).catch(()=>null);
      const clicked=injected?.[0]?.result;
      if(!clicked?.clicked)continue;
      const nav=await waitForNavigation(worker.id,before,url=>isChatGptUrl(url)&&/\/c\//i.test(url),4200);
      if(!nav?.url)continue;
      const explicit=projectKeyFromUrl(nav.url);
      if(expectedProjectKey&&explicit&&explicit!==expectedProjectKey)continue;
      const key=conversationKeyFromUrl(nav.url);
      if(!recovered.has(key))recovered.set(key,{key,title:row.title,url:nav.url,projectKey:expectedProjectKey,projectTitle:project.title,projectUrl:project.url});
    }
    return[...recovered.values()];
  }finally{await chrome.tabs.remove(worker.id).catch(()=>{});}
};
