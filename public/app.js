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
let state = null, view='radar', query='', statusFilter='ALL', modalProject=null;

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
  const rank={BLOCKED:500,'NEEDS TEST':400,ACTIVE:300,WAITING:200,STABLE:100,UNSYNCED:0}[d.status]??50;
  const age=d.lastMovementAt?Math.max(0,30-(Date.now()-new Date(d.lastMovementAt))/86400000):0;
  return rank+age;
}
function isAttention(p){
  const d=projectState(p.id);
  return !!d && ['BLOCKED','NEEDS TEST'].includes(d.status);
}
function syncedProjects(){return state.projects.filter(p=>projectState(p.id)?.status!=='UNSYNCED'&&matchesFilter(p)).sort((a,b)=>priorityScore(b)-priorityScore(a))}
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

function render(){
  const s=stats();
  $('#app').innerHTML=`<div class="app">
    <aside class="sidebar">
      <div class="brand"><h1>SHINO <span>//</span> CONTROL</h1><p>SOURCE-DERIVED PROJECT RADAR</p></div>
      <nav class="nav">${navBtn('radar','◉  Radar')}${navBtn('discovered','⌁  Discovered')}${navBtn('sources','⇄  Sources / Sync')}</nav>
      <div class="side-foot">Derived ${esc(rel(state.derivedAt))} ago<br><span class="fresh-${overallFresh()}">${overallFresh()}</span> source picture</div>
    </aside>
    <main class="main"><div class="main-inner">
      <div class="mobile-menu actions"><button class="btn" data-view="radar">Radar</button><button class="btn" data-view="discovered">Discovered</button><button class="btn" data-view="sources">Sources</button></div>
      ${view==='radar'?radarView(s):view==='discovered'?discoveredView():sourcesView()}
    </div></main>
  </div>${modalProject?projectModal(modalProject):''}`;
  bind();
}

function radarView(s){
  const synced=syncedProjects();
  const attention=synced.filter(isAttention);
  const regular=synced.filter(p=>!isAttention(p));
  const unsynced=unsyncedProjects();
  return `<div class="topbar">
    <div class="titleblock"><h2>Project Radar</h2><p>Les blocages et tests d’abord. Les projets actifs restent visibles sans être artificiellement urgents.</p></div>
    <div class="actions"><button class="btn gold" id="syncBtn">↻ Sync GitHub</button></div>
  </div>
  <section class="stats">
    <div class="stat stat-active"><span>Active</span><b>${s.active}</b></div>
    <div class="stat stat-test"><span>Needs test</span><b>${s.test}</b></div>
    <div class="stat stat-blocked"><span>Blocked</span><b>${s.blocked}</b></div>
    <div class="stat stat-stable"><span>Stable</span><b>${s.stable}</b></div>
    <div class="stat stat-unsynced"><span>Unsynced</span><b>${s.unsynced}</b></div>
  </section>
  <div class="toolbar"><input id="search" class="search" placeholder="Search project, evidence, repo…" value="${esc(query)}"><select id="statusFilter" class="select">${['ALL','ACTIVE','NEEDS TEST','BLOCKED','STABLE','WAITING','DONE','UNSYNCED'].map(x=>`<option ${statusFilter===x?'selected':''}>${x}</option>`).join('')}</select></div>
  ${sectionHeading('Needs attention', `${attention.length} projet${attention.length===1?'':'s'} avec blocage ou test explicite`, 'attention-title')}
  ${attention.length?`<section class="grid attention-grid">${attention.map(projectCard).join('')}</section>`:'<div class="empty compact-empty">Aucun blocage ni test explicite dans le filtre actuel.</div>'}
  ${sectionHeading('Synced projects', `${regular.length} projet${regular.length===1?'':'s'} avec état reconstruit`, '')}
  ${regular.length?`<section class="grid">${regular.map(projectCard).join('')}</section>`:'<div class="empty compact-empty">Aucun autre projet synchronisé dans ce filtre.</div>'}
  ${sectionHeading('Not synced yet', `${unsynced.length} projet${unsynced.length===1?'':'s'} sans preuve exploitable`, 'muted-title')}
  ${unsynced.length?`<section class="unsynced-grid">${unsynced.map(unsyncedCard).join('')}</section>`:'<div class="empty compact-empty">Tout ce qui correspond au filtre possède déjà une source.</div>'}`;
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
      <div class="panel resume-panel"><span class="meta-label">Recommended resume point</span><p>${esc(resume)}</p><div class="actions">${c.chat?`<a class="btn gold" href="${esc(c.chat.url)}" target="_blank">Continue in ChatGPT</a>`:`<button class="btn" disabled>No synced ChatGPT thread yet</button>`}${c.pr?`<a class="btn" href="${esc(c.pr.url)}" target="_blank">Open PR</a>`:''}${c.repo?`<a class="btn ghost" href="${esc(c.repo)}" target="_blank">Open repo</a>`:''}</div></div>
      <h3 class="timeline-title">Evidence timeline</h3><div class="timeline">${ev.length?ev.map(item=>`<div class="event ${sourceClass(item.sourceType==='chatgpt_thread'?'chatgpt_thread':item.sourceType==='github_component'?'github_component':item.sourceType?.startsWith('github_')?'github_repo':'other')}"><time>${esc(fmt(item.timestamp))} · ${esc(item.sourceType)}</time><strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p>${item.url?`<a class="link" href="${esc(item.url)}" target="_blank">Open evidence ↗</a>`:''}</div>`).join(''):'<div class="empty compact-empty">No current evidence ingested yet.</div>'}</div>
    </div><aside><div class="why-box"><h3>Why this state?</h3><p class="note">CONTROL derived <b>${esc(d.status)}</b> from ${d.evidenceIds.length} recent evidence items. Archived/out-of-inventory chats are excluded from this current view.</p><ul class="note">${d.evidenceIds.map(id=>{const item=state.evidence.find(x=>x.id===id&&x.inventoryCurrent!==false);return item?`<li>${esc(item.title)}</li>`:''}).join('')}</ul></div><div class="panel source-health"><h3>Source health</h3>${src.length?src.map(s=>`<p class="note"><b>${esc(sourceLabel(s))}</b><br>${esc(s.state||'registered')} · ${esc(rel(s.conversationUpdatedAt||s.lastObservedAt))} ago</p>`).join(''):'<p class="note">No current source yet.</p>'}</div></aside></div>
  </section></div>`;
}

async function syncGithub(){const input=$('#ghToken');const token=input?.value||'';toast('GitHub sync started…');try{const out=await api('/api/sync/github',{method:'POST',body:JSON.stringify({token})});state=out.state;toast('GitHub sync complete');render();}catch(e){toast(`Sync failed: ${e.message}`)}}
function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
  $('#search')?.addEventListener('input',e=>{query=e.target.value;render()});
  $('#statusFilter')?.addEventListener('change',e=>{statusFilter=e.target.value;render()});
  $('#syncBtn')?.addEventListener('click',()=>{view='sources';render();setTimeout(()=>$('#ghToken')?.focus(),0)});
  $('#syncBtn2')?.addEventListener('click',syncGithub);
  document.querySelectorAll('[data-open-project]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-stop],[data-why]'))return;modalProject=el.dataset.openProject;render()});
  document.querySelectorAll('[data-why]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();modalProject=b.dataset.why;render()}));
  document.querySelectorAll('[data-stop]').forEach(el=>el.addEventListener('click',e=>e.stopPropagation()));
  $('#closeModal')?.addEventListener('click',()=>{modalProject=null;render()});
  $('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop'){modalProject=null;render()}});
  document.querySelectorAll('[data-map]').forEach(b=>b.onclick=async()=>{const id=b.dataset.map;const projectId=$(`[data-map-select="${id}"]`).value;await api('/api/remap',{method:'POST',body:JSON.stringify({discoveredId:id,projectId})});await load();toast('Source mapped')});
  document.querySelectorAll('[data-ignore]').forEach(b=>b.onclick=async()=>{await api('/api/discovered/ignore',{method:'POST',body:JSON.stringify({id:b.dataset.ignore})});await load()});
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modalProject){modalProject=null;render()}});
load().catch(e=>{$('#app').innerHTML=`<div style="padding:30px;color:white">Failed to load CONTROL: ${esc(e.message)}</div>`});