const $ = (s, root=document) => root.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmt = ts => ts ? new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(ts)) : '—';
const rel = ts => {
  if(!ts) return 'unknown';
  const d=(Date.now()-new Date(ts))/1000;
  if(d<60) return 'à l’instant';
  if(d<3600) return `${Math.round(d/60)} min`;
  if(d<86400) return `${Math.round(d/3600)} h`;
  return `${Math.round(d/86400)} j`;
};
const statusClass = status => `status-${String(status||'UNKNOWN').replace(/[^A-Z0-9]+/gi,'-').replace(/^-|-$/g,'')}`;
const sourceClass = type => type==='github_repo'?'source-github':type==='chatgpt_thread'?'source-chatgpt':type==='github_component'?'source-component':'source-other';
const sourceLabel = s => s.type==='github_repo'?'GitHub':s.type==='chatgpt_thread'?'ChatGPT':s.type==='chatgpt_archived'?'ChatGPT archive':s.type==='github_component'?(s.title||'Component'):s.type;
let state = null, view='radar', query='', statusFilter='ALL', modalProject=null, projectView=localStorage.getItem('controlProjectView') || 'board';

async function api(path, options={}) {
  const r = await fetch(path, {headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
async function load(){ state=await api('/api/state'); render(); }
function toast(msg){ const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3000); }
function projectState(id){return state.derived.find(d=>d.projectId===id)}
function evidenceFor(id){return state.evidence.filter(e=>e.projectId===id&&e.inventoryCurrent!==false).sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0))}
function sourcesFor(id,{archives=false}={}){return state.sources.filter(s=>s.projectId===id&&(archives?s.type==='chatgpt_archived':s.type!=='chatgpt_archived'))}
function projectById(id){return state.projects.find(p=>p.id===id)}
function latestChatSource(id){return sourcesFor(id).filter(s=>s.type==='chatgpt_thread'&&s.url).sort((a,b)=>new Date(b.conversationUpdatedAt||b.lastObservedAt||0)-new Date(a.conversationUpdatedAt||a.lastObservedAt||0))[0]||null}
function ctAs(p){
  const ev=evidenceFor(p.id);
  const chat=latestChatSource(p.id);
  const pr=ev.find(e=>e.sourceType==='github_pr'&&e.url&&!/superseded/i.test(`${e.title} ${e.summary}`));
  const repo=p.repo?`https://github.com/${p.repo}`:null;
  return {chat,pr,repo};
}
function sourceBadges(id){
  const groups=new Map();
  for(const s of sourcesFor(id)){
    const key=s.type==='github_component'?`${s.type}:${s.title||''}`:s.type;
    const g=groups.get(key)||{type:s.type,label:sourceLabel(s),count:0};
    g.count++; groups.set(key,g);
  }
  return [...groups.values()];
}
function stats(){
  const ds=state.derived;
  return {
    active:ds.filter(d=>d.status==='ACTIVE').length,
    test:ds.filter(d=>d.status==='NEEDS TEST').length,
    blocked:ds.filter(d=>d.status==='BLOCKED').length,
    stable:ds.filter(d=>d.status==='STABLE').length,
    empty:ds.filter(d=>d.status==='EMPTY').length,
    unsynced:ds.filter(d=>d.status==='UNSYNCED').length
  };
}
function overallFresh(){const fs=state.derived.map(d=>d.freshness);return fs.includes('STALE')?'AGING':fs.includes('AGING')?'AGING':'RECENT'}
function navBtn(id,label){return `<button class="${view===id?'active':''}" data-view="${id}">${label}</button>`}
function matchesFilter(p){
  const d=projectState(p.id); if(!d)return false;
  const hay=`${p.name} ${p.universe||''} ${d.summary||''} ${d.nextAction||''}`.toLowerCase();
  return (!query||hay.includes(query.toLowerCase()))&&(statusFilter==='ALL'||d.status===statusFilter);
}
function priorityScore(p){
  const d=projectState(p.id); if(!d)return -1;
  const rank={BLOCKED:500,'NEEDS TEST':400,ACTIVE:300,WAITING:200,STABLE:100,EMPTY:-50,UNSYNCED:-100}[d.status]??50;
  const age=d.lastMovementAt?Math.max(0,30-(Date.now()-new Date(d.lastMovementAt))/86400000):0;
  return rank+age;
}
function isAttention(p){
  const d=projectState(p.id);
  return !!d && ['BLOCKED','NEEDS TEST'].includes(d.status);
}
function syncedProjects(){return state.projects.filter(p=>!['UNSYNCED','EMPTY'].includes(projectState(p.id)?.status)&&matchesFilter(p)).sort((a,b)=>priorityScore(b)-priorityScore(a))}
function emptyProjects(){return state.projects.filter(p=>projectState(p.id)?.status==='EMPTY'&&matchesFilter(p)).sort((a,b)=>a.name.localeCompare(b.name))}
function unsyncedProjects(){return state.projects.filter(p=>projectState(p.id)?.status==='UNSYNCED'&&matchesFilter(p)).sort((a,b)=>a.name.localeCompare(b.name))}
function noisyStateText(value=''){
  const text=String(value||'');
  return /\b(USER|ASSISTANT):|powershell|ExecutionPolicy|PROJECT API COUNT|ACTIVE-TAB|NO_API_INVENTORY_RESULT|PS [A-Z]:\\|```|\bSet-[A-Z]|\bGet-[A-Z]/i.test(text) || text.length>900;
}
function displaySummary(p,d,e){
  if(e?.sourceType==='chatgpt_thread' && noisyStateText(d.summary)) return `Dernière activité ChatGPT : ${e.title || p.name}.`;
  return d.summary || (e ? e.title : 'État non résumé.');
}
function displayResume(p,d,e){
  const raw=String(d.nextAction||'');
  if(!raw || /Continue in the synced ChatGPT thread|Review the newest evidence and choose the next safe action/i.test(raw) || noisyStateText(raw)) {
    if(e?.sourceType==='chatgpt_thread') return `Reprendre « ${e.title || p.name} » dans ChatGPT.`;
  }
  return raw || 'Ouvrir la source la plus récente.';
}


function boardBucket(status="") {
  if (["BLOCKED","NEEDS TEST"].includes(status)) return "attention";
  if (status === "ACTIVE") return "active";
  if (["STABLE","DONE"].includes(status)) return "stable";
  return "other";
}
function boardLabel(status="") {
  return ({BLOCKED:"Blocked","NEEDS TEST":"Needs test",ACTIVE:"Active",STABLE:"Stable",DONE:"Done",WAITING:"Waiting",EMPTY:"Empty",UNSYNCED:"Unsynced"})[status] || status || "Unknown";
}
function visibleProjects(){
  return state.projects.filter(matchesFilter).sort((a,b)=>priorityScore(b)-priorityScore(a) || a.name.localeCompare(b.name));
}
function latestEvidenceRows(limit=8){
  return [...state.evidence].filter(e=>e.inventoryCurrent!==false && e.timestamp).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,limit);
}
function overviewCard(label,value,subtitle,cls,filter){
  return `<button class="overview-card ${cls}" data-status-pick="${esc(filter)}"><span class="overview-icon"></span><div><small>${esc(label)}</small><strong>${esc(value)}</strong><p>${esc(subtitle)}</p></div></button>`;
}
function projectBoard(buckets){
  const columns=[["attention","Attention","Blocages & validations"],["active","In progress","Projets actifs"],["stable","Stable","État confirmé"],["other","Other","Waiting / empty / unsynced"]];
  return `<div class="project-board">${columns.map(([key,title,subtitle])=>`<section class="board-column board-${key}"><header><div><h4>${esc(title)} <span>${buckets[key].length}</span></h4><p>${esc(subtitle)}</p></div><i></i></header><div class="board-stack">${buckets[key].length?buckets[key].map(boardProjectCard).join(""):`<div class="board-empty">Rien ici pour le moment.</div>`}</div></section>`).join("")}</div>`;
}
function boardProjectCard(p){
  const d=projectState(p.id); if(!d)return "";
  const e=evidenceFor(p.id)[0], c=ctAs(p), badges=sourceBadges(p.id), resume=displayResume(p,d,e);
  return `<article class="board-card ${statusClass(d.status)}" data-open-project="${p.id}"><div class="board-card-top"><span class="project-type">${esc(p.universe||"PROJECT")}</span><span class="status-tag">${esc(boardLabel(d.status))}</span></div><h4>${esc(p.name)}</h4><p class="board-resume">${esc(resume)}</p><div class="board-meta"><span class="fresh-${esc(d.freshness)}">${esc(d.freshness)}</span><span>${e?`${esc(rel(e.timestamp))} ago`:"No evidence"}</span></div><div class="board-footer"><div class="mini-sources">${badges.slice(0,2).map(g=>`<span class="${sourceClass(g.type)}">${esc(g.label)}${g.count>1?` ×${g.count}`:""}</span>`).join("")}</div>${c.chat?`<a class="quick-open" href="${esc(c.chat.url)}" target="_blank" data-stop title="Continue in ChatGPT">↗</a>`:c.pr?`<a class="quick-open" href="${esc(c.pr.url)}" target="_blank" data-stop title="Open PR">↗</a>`:""}</div></article>`;
}
function projectListV3(projects){
  return `<div class="project-list-v3">${projects.length?projects.map(listProjectCardV3).join(""):`<div class="empty compact-empty">Aucun projet dans ce filtre.</div>`}</div>`;
}
function listProjectCardV3(p){
  const d=projectState(p.id); if(!d)return "";
  const e=evidenceFor(p.id)[0], c=ctAs(p), resume=displayResume(p,d,e);
  return `<article class="list-project ${statusClass(d.status)}" data-open-project="${p.id}"><div class="list-project-main"><span class="status-dot"></span><div><h4>${esc(p.name)}</h4><small>${esc(p.universe||"PROJECT")}</small></div></div><span class="status-tag">${esc(boardLabel(d.status))}</span><p>${esc(resume)}</p><div class="list-project-age"><b class="fresh-${esc(d.freshness)}">${esc(d.freshness)}</b><span>${e?`${esc(rel(e.timestamp))} ago`:"—"}</span></div>${c.chat?`<a class="btn small gold" href="${esc(c.chat.url)}" target="_blank" data-stop>Continue</a>`:c.pr?`<a class="btn small" href="${esc(c.pr.url)}" target="_blank" data-stop>Open PR</a>`:"<span></span>"}</article>`;
}
function activityRail(){
  const rows=latestEvidenceRows(7), discovered=state.discovered?.length||0;
  return `<aside class="activity-rail"><section class="rail-panel"><div class="rail-head"><div><span class="eyebrow">LIVE FEED</span><h3>Recent activity</h3></div><span class="rail-count">${rows.length}</span></div><div class="activity-list">${rows.length?rows.map(activityItem).join(""):"<div class=\"rail-empty\">Aucune activité récente.</div>"}</div></section><section class="rail-panel quick-panel"><div class="rail-head"><div><span class="eyebrow">INBOX</span><h3>Needs sorting</h3></div><span class="rail-count">${discovered}</span></div><p>${discovered?`${discovered} source${discovered===1?"":"s"} attend${discovered===1?"":"ent"} un rattachement.`:"Tout est correctement rattaché."}</p><button class="rail-action" data-view="discovered">${discovered?"Open Discovered":"View inbox"}</button></section></aside>`;
}
function activityItem(item){
  const p=projectById(item.projectId), kind=item.sourceType?.startsWith("github_")?"GH":item.sourceType==="chatgpt_thread"?"AI":"•";
  const type=item.sourceType==="chatgpt_thread"?"chatgpt_thread":item.sourceType?.startsWith("github_")?"github_repo":"other";
  return `<div class="activity-item"><span class="activity-icon ${sourceClass(type)}">${kind}</span><div><strong>${esc(p?.name||item.title||"Activity")}</strong><p>${esc(item.title||item.summary||"Update")}</p><small>${esc(rel(item.timestamp))} ago</small></div></div>`;
}

function render(){
  const s=stats();
  $('#app').innerHTML=`<div class="app view-${view}">
    <aside class="sidebar premium-sidebar">
      <div class="brand"><div class="brand-lockup"><div class="brand-mark">S</div><div><h1>SHINO // CONTROL</h1><p>PROJECT COMMAND</p></div></div></div>
      <nav class="nav">${navBtn('radar','<span class="nav-icon">⌂</span><span>Tableau de bord</span>')}${navBtn('discovered','<span class="nav-icon">◉</span><span>Découvrir</span>')}${navBtn('sources','<span class="nav-icon">↔</span><span>Sources / Sync</span>')}</nav>
      <div class="side-spacer"></div>
      <button class="sidebar-sync" data-view="sources"><span class="live-dot"></span><div><b>Sync GitHub</b><small>Connecté</small></div><span>↻</span></button>
      <div class="sidebar-facts"><span>Dernière sync</span><b>${esc(rel(state.settings?.lastGithubSync?.at || state.settings?.lastChatgptCatchup?.at || state.derivedAt))} ago</b></div>
      <div class="side-status"><span class="live-dot"></span><div><b>${state.projects.length} projets</b><small>${overallFresh()} source picture</small></div></div>
      <div class="side-foot">SHINO // CONTROL<br><span>BUILD ${esc(window.CONTROL_BUILD?.version || '')}</span></div>
    </aside>
    <main class="main"><div class="main-inner"><div class="mobile-menu actions"><button class="btn" data-view="radar">Dashboard</button><button class="btn" data-view="discovered">Découvrir</button><button class="btn" data-view="sources">Sources</button></div>${view==='radar'?radarView(s):view==='discovered'?discoveredView():sourcesView()}</div></main>
  </div>${modalProject?projectModal(modalProject):''}`;
  bind();
}

function priorityProjects(projects, limit=4){
  return [...projects].filter(p=>!['EMPTY','UNSYNCED'].includes(projectState(p.id)?.status)).sort((a,b)=>priorityScore(b)-priorityScore(a)).slice(0,limit);
}
function heroProject(projects){
  return priorityProjects(projects,1)[0] || projects[0] || null;
}
function priorityProjectCard(p){
  const d=projectState(p.id); if(!d)return '';
  const e=evidenceFor(p.id)[0], c=ctAs(p);
  const summary=displaySummary(p,d,e), resume=displayResume(p,d,e);
  return `<article class="priority-card ${statusClass(d.status)}" data-open-project="${p.id}">
    <div class="priority-card-head"><div><span class="project-type">${esc(p.universe||'PROJECT')}</span><h4>${esc(p.name)}</h4></div><span class="status-tag">${esc(boardLabel(d.status))}</span></div>
    <p class="priority-summary">${esc(summary)}</p>
    <div class="priority-next"><span>Next</span><p>${esc(resume)}</p></div>
    <div class="priority-footer"><div><b class="fresh-${esc(d.freshness)}">${esc(d.freshness)}</b><small>${e?`${esc(rel(e.timestamp))} ago`:'No evidence'}</small></div>${c.chat?`<a class="priority-open" href="${esc(c.chat.url)}" target="_blank" data-stop>Continue ↗</a>`:c.pr?`<a class="priority-open" href="${esc(c.pr.url)}" target="_blank" data-stop>Open PR ↗</a>`:''}</div>
  </article>`;
}
function heroPanel(projects){
  const p=heroProject(projects);
  if(!p)return '';
  const d=projectState(p.id), e=evidenceFor(p.id)[0], c=ctAs(p);
  const summary=displaySummary(p,d,e), resume=displayResume(p,d,e);
  return `<section class="command-hero ${statusClass(d.status)}">
    <div class="hero-copy"><span class="eyebrow">FOCUS NOW</span><h2>${esc(p.name)}</h2><p class="hero-summary">${esc(summary)}</p><div class="hero-next"><span>Do this next</span><strong>${esc(resume)}</strong></div><div class="hero-actions">${c.chat?`<a class="btn hero-primary" href="${esc(c.chat.url)}" target="_blank">Continue in ChatGPT</a>`:''}<button class="btn hero-secondary" data-open-project="${p.id}">Open project</button></div></div>
    <div class="hero-visual"><div class="hero-orbit orbit-a"></div><div class="hero-orbit orbit-b"></div><div class="hero-shape shape-a"></div><div class="hero-shape shape-b"></div><div class="hero-monogram">S<span>//</span></div><div class="hero-status"><small>STATUS</small><b>${esc(boardLabel(d.status))}</b><span>${esc(d.freshness||'')}</span></div></div>
  </section>`;
}
function syncMiniPanel(){
  const m=state.settings?.lastChatgptCatchup;
  if(!m?.at)return '';
  const failed=Number(m.failedCount||0), deferred=Number(m.deferredCount||0), quarantined=Number(m.quarantinedCount||0);
  const health=failed||deferred?'PARTIAL':'LIVE';
  return `<section class="rail-panel sync-mini"><div class="rail-head"><div><span class="eyebrow">SYSTEM</span><h3>Sync health</h3></div><span class="health-pill health-${health.toLowerCase()}">${health}</span></div><div class="sync-mini-grid"><div><b>${Number(m.inventoryCount||0)}</b><span>Known</span></div><div><b>${Number(m.refreshedCount||0)}</b><span>Refreshed</span></div><div><b>${quarantined}</b><span>Quarantine</span></div></div><p>Last catch-up ${esc(rel(m.at))} ago</p></section>`;
}
function activityRailV4(){
  const rows=latestEvidenceRows(6), discovered=state.discovered?.length||0;
  return `<aside class="activity-rail">
    <section class="rail-panel"><div class="rail-head"><div><span class="eyebrow">LIVE FEED</span><h3>Recent activity</h3></div><span class="rail-count">${rows.length}</span></div><div class="activity-list">${rows.length?rows.map(activityItem).join(''):'<div class="rail-empty">Aucune activité récente.</div>'}</div></section>
    ${syncMiniPanel()}
    <section class="rail-panel quick-panel"><div class="rail-head"><div><span class="eyebrow">INBOX</span><h3>Needs sorting</h3></div><span class="rail-count">${discovered}</span></div><p>${discovered?`${discovered} source${discovered===1?'':'s'} attend${discovered===1?'':'ent'} un rattachement.`:'Tout est correctement rattaché.'}</p><button class="rail-action" data-view="discovered">${discovered?'Open Discovered':'View inbox'}</button></section>
  </aside>`;
}
function projectAccent(p){
  const value=String(p?.name||p?.id||'project');
  let hash=0;
  for(let i=0;i<value.length;i++) hash=((hash<<5)-hash)+value.charCodeAt(i);
  return `accent-${Math.abs(hash)%6}`;
}
function projectGlyph(p){
  const words=String(p?.name||'P').replace(/[^A-Za-z0-9À-ÿ]+/g,' ').trim().split(/\s+/).filter(Boolean);
  if(words.length>1) return esc((words[0][0]+words[1][0]).toUpperCase());
  return esc(String(words[0]||'P').slice(0,2).toUpperCase());
}
function featuredProjectCard(p){
  const d=projectState(p.id); if(!d)return '';
  const e=evidenceFor(p.id)[0], c=ctAs(p), badges=sourceBadges(p.id);
  const summary=displaySummary(p,d,e), resume=displayResume(p,d,e);
  return `<article class="feature-project ${statusClass(d.status)} ${projectAccent(p)}" data-open-project="${p.id}">
    <div class="feature-project-glow"></div>
    <div class="feature-project-head">
      <div class="project-emblem">${projectGlyph(p)}</div>
      <div class="feature-title"><span>${esc(p.universe||'PROJECT')}</span><h4>${esc(p.name)}</h4></div>
      <span class="status-tag">${esc(boardLabel(d.status))}</span>
    </div>
    <p class="feature-summary">${esc(summary)}</p>
    <div class="feature-next"><small>REPRENDRE ICI</small><strong>${esc(resume)}</strong></div>
    <div class="feature-project-foot">
      <div class="feature-meta"><span class="fresh-${esc(d.freshness)}">${esc(d.freshness)}</span><span>${e?`${esc(rel(e.timestamp))} ago`:'No evidence'}</span></div>
      <div class="feature-actions">${badges.slice(0,2).map(g=>`<span class="${sourceClass(g.type)}">${esc(g.label)}</span>`).join('')}${c.chat?`<a href="${esc(c.chat.url)}" target="_blank" data-stop>Continue ↗</a>`:c.pr?`<a href="${esc(c.pr.url)}" target="_blank" data-stop>Open PR ↗</a>`:''}</div>
    </div>
  </article>`;
}
function attentionItem(p){
  const d=projectState(p.id); if(!d)return '';
  const e=evidenceFor(p.id)[0], c=ctAs(p), resume=displayResume(p,d,e);
  return `<article class="attention-item ${statusClass(d.status)}" data-open-project="${p.id}">
    <span class="attention-led"></span>
    <div class="attention-copy"><div><b>${esc(p.name)}</b><span>${esc(boardLabel(d.status))}</span></div><p>${esc(resume)}</p></div>
    <small>${e?`${esc(rel(e.timestamp))} ago`:'—'}</small>
    ${c.chat?`<a href="${esc(c.chat.url)}" target="_blank" data-stop>Open ↗</a>`:''}
  </article>`;
}
function overviewWorkspace(projects){
  const top=priorityProjects(projects,6);
  const attention=projects.filter(isAttention).slice(0,4);
  return `<div class="overview-layout">
    <section class="overview-main">
      <div class="section-title-row"><div><span class="eyebrow">WORKSPACE</span><h3>Projects to resume</h3><p>Les chantiers les plus utiles à reprendre maintenant.</p></div><button class="text-action" data-radar-mode="list">See all projects →</button></div>
      <div class="feature-project-grid">${top.map(featuredProjectCard).join('')}</div>
      ${attention.length?`<section class="attention-panel"><div class="section-title-row compact"><div><span class="eyebrow">ATTENTION</span><h3>Needs a decision</h3></div><span class="section-count">${attention.length}</span></div><div class="attention-list">${attention.map(attentionItem).join('')}</div></section>`:''}
    </section>
    ${activityRailV4()}
  </div>`;
}
function fullProjectsWorkspace(projects,buckets){
  return `<section class="dashboard-workspace full-workspace"><div class="workspace-head"><div><span class="eyebrow">PROJECTS</span><h3>${radarMode==='board'?'Project board':'Project list'}</h3><p>${projects.length} projet${projects.length===1?'':'s'} dans la vue actuelle</p></div><span class="workspace-hint">Clique une carte pour ouvrir le détail</span></div>${radarMode==='board'?projectBoard(buckets):projectListV3(projects)}</section>`;
}

function radarView(s){
  const projects=visibleProjects();
  const buckets={attention:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='attention'),active:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='active'),stable:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='stable'),other:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='other')};
  const attentionCount=s.blocked+s.test;
  const modeButton=(id,label)=>`<button class="mode-btn ${radarMode===id?'active':''}" data-radar-mode="${id}">${label}</button>`;
  return `<div class="topbar hub-topbar"><div class="hub-title"><span class="eyebrow">SHINO // CONTROL</span><h2>Project Hub</h2><p>Vue d’ensemble, reprise rapide et signaux utiles.</p></div><div class="dashboard-tools"><div class="command-search"><span>⌕</span><input id="search" placeholder="Rechercher un projet, un état, une source…" value="${esc(query)}"></div><select id="statusFilter" class="select command-filter">${['ALL','ACTIVE','NEEDS TEST','BLOCKED','STABLE','WAITING','DONE','EMPTY','UNSYNCED'].map(x=>`<option ${statusFilter===x?'selected':''}>${x}</option>`).join('')}</select><div class="mode-switch">${modeButton('overview','◫ Overview')}${modeButton('board','▦ Board')}${modeButton('list','☷ List')}</div><button class="btn gold sync-command" id="syncBtn">↻ Sync</button></div></div>
  ${radarMode==='overview'?heroPanel(projects):''}
  <section class="overview-grid">${overviewCard('Projects',state.projects.length,'Tous les projets suivis','overview-total','ALL')}${overviewCard('Active',s.active,'Travail en cours','overview-active','ACTIVE')}${overviewCard('Attention',attentionCount,`${s.blocked} blocked · ${s.test} needs test`,'overview-attention',attentionCount?'NEEDS TEST':'ALL')}${overviewCard('Stable',s.stable,'État confirmé','overview-stable','STABLE')}</section>
  ${radarMode==='overview'?overviewWorkspace(projects):fullProjectsWorkspace(projects,buckets)}`;
}

function sectionHeading(title, subtitle, cls=''){return `<div class="section-head ${cls}"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div></div>`}
function projectCard(p){
  const d=projectState(p.id); if(!d)return '';
  const e=evidenceFor(p.id)[0]; const c=ctAs(p); const badges=sourceBadges(p.id);
  const summary=displaySummary(p,d,e), resume=displayResume(p,d,e);
  return `<article class="card ${statusClass(d.status)}" data-open-project="${p.id}">
    <div class="card-head"><div><h3>${esc(p.name)}</h3><div class="universe">${esc(p.universe||'PROJECT')}</div></div><span class="pill ${esc(d.status)}">${esc(d.status)}</span></div>
    <div class="summary">${esc(summary)}</div>
    <div class="movement"><div class="meta-label">Last real movement · <span class="fresh-${d.freshness}">${esc(d.freshness)}</span></div><p>${e?`${esc(e.title)} · ${esc(rel(e.timestamp))} ago`:'No evidence'}</p></div>
    <div class="resume"><div class="meta-label">Resume from here</div><p>${esc(resume)}</p></div>
    <div class="source-row">${badges.map(g=>`<span class="chip ${sourceClass(g.type)}">${esc(g.label)}${g.count>1?` ×${g.count}`:''}</span>`).join('')}<span class="confidence">${esc(d.confidence)} confidence</span></div>
    <div class="card-actions">${c.chat?`<a class="btn small gold" href="${esc(c.chat.url)}" target="_blank" data-stop>Continue in ChatGPT</a>`:''}${c.pr?`<a class="btn small" href="${esc(c.pr.url)}" target="_blank" data-stop>Open PR</a>`:''}${c.repo?`<a class="btn small ghost" href="${esc(c.repo)}" target="_blank" data-stop>GitHub</a>`:''}<button class="btn small why" data-why="${p.id}">Why this state?</button></div>
  </article>`;
}
function emptyCard(p){
  const d=projectState(p.id);
  return `<article class="unsynced-card" data-open-project="${p.id}">
    <div><strong>${esc(p.name)}</strong><span>EMPTY · ${esc(p.universe||'PROJECT')} · No conversations yet</span></div>
    <div class="unsynced-actions"><button class="mini-link" data-why="${p.id}">Why?</button></div>
  </article>`;
}
function unsyncedCard(p){
  const repo=p.repo?`https://github.com/${p.repo}`:null;
  return `<article class="unsynced-card" data-open-project="${p.id}">
    <div><strong>${esc(p.name)}</strong><span>${esc(p.universe||'PROJECT')}</span></div>
    <div class="unsynced-actions">${repo?`<a class="mini-link" href="${esc(repo)}" target="_blank" data-stop>GitHub</a>`:''}<button class="mini-link" data-why="${p.id}">Why?</button></div>
  </article>`;
}
function discoveredView(){return `<div class="topbar"><div class="titleblock"><h2>Discovered</h2><p>Sources détectées mais pas encore rattachées à un projet.</p></div></div><div class="panel"><div class="discover-list">${state.discovered.length?state.discovered.map(d=>`<div class="discover-item"><strong>${esc(d.title)}</strong><p>${esc(d.preview||'')}</p><div class="actions"><select class="select" data-map-select="${d.id}">${state.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn gold small" data-map="${d.id}">Map source</button><button class="btn small ghost" data-ignore="${d.id}">Ignore</button><a class="btn small" href="${esc(d.url)}" target="_blank">Open</a></div></div>`).join(''):'<div class="empty">Nothing unmapped. New ChatGPT threads or repos land here only when CONTROL cannot resolve them confidently.</div>'}</div></div>`}
function sourcesView(){
  const current=state.sources.filter(s=>s.type!=='chatgpt_archived');
  const gh=current.filter(s=>s.type==='github_repo'), comps=current.filter(s=>s.type==='github_component'), chats=current.filter(s=>s.type==='chatgpt_thread');
  const archives=state.sources.filter(s=>s.type==='chatgpt_archived');
  const mappedProjectKeys=Object.keys(state.settings?.chatgptProjectMappings||{}).length;
  const inv=state.settings?.lastChatgptInventory;
  return `<div class="topbar"><div class="titleblock"><h2>Sources / Sync</h2><p>GitHub + ChatGPT alimentent le radar. Les sources archivées restent conservées mais n'influencent plus l'état courant.</p></div></div>
  <div class="panel panel-github" style="margin-bottom:14px"><h3>GitHub sync</h3><p class="note">Public repos sync without a token. For private repos, set <code>GITHUB_TOKEN</code> before starting the server, or paste a fine-grained token here for this sync only.</p><div class="config-row"><input id="ghToken" type="password" placeholder="Fine-grained GitHub token (optional)"><button class="btn gold" id="syncBtn2">Sync configured repos</button></div></div>
  <div class="panel panel-chatgpt" style="margin-bottom:14px"><h3>ChatGPT sync</h3><p class="note"><b>${mappedProjectKeys} project routes remembered.</b>${inv?` Latest API inventory: <b>${esc(inv.conversationCount)} conversations / ${esc(inv.projectCount)} projects</b>, ${esc(rel(inv.observedAt))} ago.`:''} Archived legacy/out-of-inventory chats: <b>${archives.length}</b>.</p></div>
  <div class="panel"><h3>Registered current sources</h3><div class="source-list">${[...gh,...comps,...chats].map(sourceItem).join('')}</div></div>
  ${archives.length?`<div class="panel" style="margin-top:14px"><h3>Archived ChatGPT sources</h3><p class="note">Kept for history; excluded from Radar derivation and current source counts.</p><div class="source-list">${archives.map(sourceItem).join('')}</div></div>`:''}`;
}
function sourceItem(s){const p=projectById(s.projectId);return `<div class="source-item ${sourceClass(s.type)}"><div><strong>${esc(s.title||s.type)}</strong><p>${esc(p?.name||'Unmapped')} · ${esc(s.type)} · observed ${esc(rel(s.lastObservedAt||s.inventoryObservedAt))} ago ${s.state?`· ${esc(s.state)}`:''}</p>${s.url?`<a class="link" href="${esc(s.url)}" target="_blank">${esc(s.url)}</a>`:''}</div><span class="chip ${sourceClass(s.type)}">${s.type==='chatgpt_archived'?'ARCHIVED':s.lastObservedAt?'REGISTERED':'NEEDS SYNC'}</span></div>`}
function projectModal(id){
  const p=projectById(id),d=projectState(id);if(!p||!d)return '';
  const ev=evidenceFor(id),src=sourcesFor(id),c=ctAs(p),e=ev[0];
  const summary=displaySummary(p,d,e),resume=displayResume(p,d,e);
  return `<div class="modal-backdrop" id="modalBackdrop"><section class="modal ${statusClass(d.status)}">
    <div class="modal-head"><div><div class="universe">${esc(p.universe||'PROJECT')}</div><h2>${esc(p.name)} <span class="pill ${esc(d.status)}">${esc(d.status)}</span></h2></div><button class="btn ghost" id="closeModal">✕</button></div>
    <div class="modal-body"><div><p class="big-state">${esc(summary)}</p><div class="info-grid"><div class="info"><span class="meta-label">Last known movement</span><b>${esc(fmt(d.lastMovementAt))}</b></div><div class="info"><span class="meta-label">Freshness</span><b class="fresh-${d.freshness}">${esc(d.freshness)}</b></div><div class="info"><span class="meta-label">Confidence</span><b>${esc(d.confidence)}</b></div></div>
      <div class="panel resume-panel"><span class="meta-label">Recommended resume point</span><p>${esc(resume)}</p><div class="actions">${c.chat?`<a class="btn gold" href="${esc(c.chat.url)}" target="_blank">Continue in ChatGPT</a>`:`<button class="btn" disabled>${d.status==='EMPTY'?'No conversations yet':'No synced ChatGPT thread yet'}</button>`}${c.pr?`<a class="btn" href="${esc(c.pr.url)}" target="_blank">Open PR</a>`:''}${c.repo?`<a class="btn ghost" href="${esc(c.repo)}" target="_blank">Open repo</a>`:''}</div></div>
      <h3 class="timeline-title">Evidence timeline</h3><div class="timeline">${ev.length?ev.map(item=>`<div class="event ${sourceClass(item.sourceType==='chatgpt_thread'?'chatgpt_thread':item.sourceType==='github_component'?'github_component':item.sourceType?.startsWith('github_')?'github_repo':'other')}"><time>${esc(fmt(item.timestamp))} · ${esc(item.sourceType)}</time><strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p>${item.url?`<a class="link" href="${esc(item.url)}" target="_blank">Open evidence ↗</a>`:''}</div>`).join(''):'<div class="empty compact-empty">No current evidence ingested yet.</div>'}</div>
    </div><aside><div class="why-box"><h3>Why this state?</h3><p class="note">${d.status==='EMPTY'?`CONTROL connaît ce projet ChatGPT et son mapping, mais l’inventaire courant ne contient aucune conversation.`:`CONTROL derived <b>${esc(d.status)}</b> from ${d.evidenceIds.length} recent evidence items. Archived/out-of-inventory chats are excluded from this current view.`}</p><ul class="note">${d.evidenceIds.map(id=>{const item=state.evidence.find(x=>x.id===id&&x.inventoryCurrent!==false);return item?`<li>${esc(item.title)}</li>`:''}).join('')}</ul></div><div class="panel source-health"><h3>Source health</h3>${src.length?src.map(s=>`<p class="note"><b>${esc(sourceLabel(s))}</b><br>${esc(s.state||'registered')} · ${esc(rel(s.conversationUpdatedAt||s.lastObservedAt))} ago</p>`).join(''):'<p class="note">No current source yet.</p>'}</div></aside></div>
  </section></div>`;
}

async function syncGithub(){const input=$('#ghToken');const token=input?.value||'';toast('GitHub sync started…');try{const out=await api('/api/sync/github',{method:'POST',body:JSON.stringify({token})});state=out.state;toast('GitHub sync complete');render();}catch(e){toast(`Sync failed: ${e.message}`)}}
function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
  $('#search')?.addEventListener('input',e=>{query=e.target.value;render()});
  $('#statusFilter')?.addEventListener('change',e=>{statusFilter=e.target.value;render()});
  document.querySelectorAll('[data-radar-mode]').forEach(b=>b.addEventListener('click',()=>{radarMode=b.dataset.radarMode;localStorage.setItem('controlRadarModeV5',radarMode);render()}));
  document.querySelectorAll('[data-status-pick]').forEach(b=>b.addEventListener('click',()=>{statusFilter=b.dataset.statusPick||'ALL';render()}));
  $('#syncBtn')?.addEventListener('click',()=>{view='sources';render();setTimeout(()=>$('#ghToken')?.focus(),0)});
  $('#syncBtn2')?.addEventListener('click',syncGithub);
  document.querySelectorAll('[data-open-project]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-stop],[data-why]'))return;modalProject=el.dataset.openProject;render()});
  document.querySelectorAll('[data-why]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();modalProject=b.dataset.why;render()}));
  document.querySelectorAll('[data-stop]').forEach(el=>el.addEventListener('click',e=>e.stopPropagation()));
  $('#closeModal')?.addEventListener('click',()=>{modalProject=null;render()});
  $('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop'){modalProject=null;render()}});
  document.querySelectorAll('[data-map]').forEach(b=>b.onclick=async()=>{const id=b.dataset.map;const projectId=$(`[data-map-select="${id}"]`).value;await api('/api/remap',{method:'POST',body:JSON.stringify({discoveredId:id,projectId})});await load();toast('Source mapped')});
  document.querySelectorAll('[data-ignore]').forEach(b=>b.onclick=async()=>{await api('/api/discovered/ignore',{method:'POST',body:JSON.stringify({id:b.dataset.ignore})});await load();toast('Source ignored')});
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modalProject){modalProject=null;render()}});
load().catch(e=>{$('#app').innerHTML=`<div style="padding:30px;color:white">Failed to load CONTROL: ${esc(e.message)}</div>`});