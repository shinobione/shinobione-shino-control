const $ = (s, root=document) => root.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmt = ts => ts ? new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(ts)) : '—';
const rel = ts => { if(!ts) return 'unknown'; const d=(Date.now()-new Date(ts))/1000; if(d<60)return 'à l’instant'; if(d<3600)return `${Math.round(d/60)} min`; if(d<86400)return `${Math.round(d/3600)} h`; return `${Math.round(d/86400)} j`; };
let state = null, view='radar', query='', statusFilter='ALL', modalProject=null;

async function api(path, options={}) {
  const r = await fetch(path, {headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data = await r.json().catch(()=>({})); if(!r.ok) throw new Error(data.error || r.statusText); return data;
}
async function load(){ state=await api('/api/state'); render(); }
function toast(msg){ const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),2800); }
function projectState(id){return state.derived.find(d=>d.projectId===id)}
function evidenceFor(id){return state.evidence.filter(e=>e.projectId===id).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))}
function sourcesFor(id){return state.sources.filter(s=>s.projectId===id)}
function projectById(id){return state.projects.find(p=>p.id===id)}
function ctAs(p,d){
  const ev=evidenceFor(p.id); const chat=sourcesFor(p.id).find(s=>s.type==='chatgpt_thread'&&s.url); const pr=ev.find(e=>e.sourceType==='github_pr'&&e.url&&!/superseded/i.test(`${e.title} ${e.summary}`)); const repo=p.repo?`https://github.com/${p.repo}`:null;
  return {chat,pr,repo};
}
function stats(){const ds=state.derived;return {active:ds.filter(d=>d.status==='ACTIVE').length,test:ds.filter(d=>d.status==='NEEDS TEST').length,blocked:ds.filter(d=>d.status==='BLOCKED').length,stable:ds.filter(d=>d.status==='STABLE').length,stale:ds.filter(d=>['AGING','STALE','UNKNOWN'].includes(d.freshness)).length}}

function render(){
  const s=stats();
  $('#app').innerHTML=`<div class="app">
    <aside class="sidebar"><div class="brand"><h1>SHINO <span>//</span> CONTROL</h1><p>SOURCE-DERIVED PROJECT RADAR</p></div>
      <nav class="nav">
        ${navBtn('radar','◉  Radar')}${navBtn('discovered','⌁  Discovered')}${navBtn('sources','⇄  Sources / Sync')}
      </nav><div class="side-foot">Derived ${esc(rel(state.derivedAt))} ago<br><span class="fresh-${overallFresh()}">${overallFresh()}</span> source picture</div>
    </aside>
    <main class="main">
      <div class="mobile-menu actions"><button class="btn" data-view="radar">Radar</button><button class="btn" data-view="discovered">Discovered</button><button class="btn" data-view="sources">Sources</button></div>
      ${view==='radar'?radarView(s):view==='discovered'?discoveredView():sourcesView()}
    </main></div>${modalProject?projectModal(modalProject):''}`;
  bind();
}
function navBtn(id,label){return `<button class="${view===id?'active':''}" data-view="${id}">${label}</button>`}
function overallFresh(){const fs=state.derived.map(d=>d.freshness);return fs.includes('STALE')?'AGING':fs.includes('AGING')?'AGING':'RECENT'}
function radarView(s){
  let list=state.projects.filter(p=>{const d=projectState(p.id);return (!query||`${p.name} ${p.universe} ${d?.summary||''}`.toLowerCase().includes(query.toLowerCase()))&&(statusFilter==='ALL'||d?.status===statusFilter)});
  list.sort((a,b)=>new Date(projectState(b.id)?.lastMovementAt||0)-new Date(projectState(a.id)?.lastMovementAt||0));
  return `<div class="topbar"><div class="titleblock"><h2>Project Radar</h2><p>État réel, dernière preuve, point de reprise. Zéro post-it.</p></div><div class="actions"><button class="btn gold" id="syncBtn">↻ Sync GitHub</button></div></div>
  <section class="stats"><div class="stat"><span>Active</span><b>${s.active}</b></div><div class="stat"><span>Needs test</span><b>${s.test}</b></div><div class="stat"><span>Blocked</span><b>${s.blocked}</b></div><div class="stat"><span>Stable</span><b>${s.stable}</b></div><div class="stat"><span>Aging sources</span><b>${s.stale}</b></div></section>
  <div class="toolbar"><input id="search" class="search" placeholder="Search project, evidence, repo…" value="${esc(query)}"><select id="statusFilter" class="select">${['ALL','ACTIVE','NEEDS TEST','BLOCKED','STABLE','DORMANT','WAITING','DONE'].map(x=>`<option ${statusFilter===x?'selected':''}>${x}</option>`).join('')}</select></div>
  <section class="grid">${list.map(projectCard).join('')}</section>`;
}
function projectCard(p){const d=projectState(p.id); const src=sourcesFor(p.id); const e=evidenceFor(p.id)[0]; const c=ctAs(p,d);
  return `<article class="card" data-open-project="${p.id}"><div class="card-head"><div><h3>${esc(p.name)}</h3><div class="universe">${esc(p.universe)}</div></div><span class="pill ${esc(d.status)}">${esc(d.status)}</span></div>
    <div class="summary">${esc(d.summary)}</div>
    <div class="movement"><div class="meta-label">Last real movement · <span class="fresh-${d.freshness}">${esc(d.freshness)}</span></div><p>${e?`${esc(e.title)} · ${esc(rel(e.timestamp))} ago`:'No evidence'}</p></div>
    <div class="resume"><div class="meta-label">Resume from here</div><p>${esc(d.nextAction)}</p></div>
    <div class="source-row">${src.map(s=>`<span class="chip">${s.type==='github_repo'?'GitHub':s.type==='chatgpt_thread'?'ChatGPT':esc(s.type)}</span>`).join('')}<span class="confidence">${esc(d.confidence)} confidence</span></div>
    <div class="card-actions">${c.chat?`<a class="btn small gold" href="${esc(c.chat.url)}" target="_blank" data-stop>Continue in ChatGPT</a>`:''}${c.pr?`<a class="btn small" href="${esc(c.pr.url)}" target="_blank" data-stop>Open PR</a>`:''}${c.repo?`<a class="btn small ghost" href="${esc(c.repo)}" target="_blank" data-stop>GitHub</a>`:''}<button class="btn small ghost" data-why="${p.id}" data-stop>Why this state?</button></div>
  </article>`;
}
function discoveredView(){return `<div class="topbar"><div class="titleblock"><h2>Discovered</h2><p>Sources détectées mais pas encore rattachées à un projet.</p></div></div><div class="panel"><div class="discover-list">${state.discovered.length?state.discovered.map(d=>`<div class="discover-item"><strong>${esc(d.title)}</strong><p>${esc(d.preview||'')}</p><div class="actions"><select class="select" data-map-select="${d.id}">${state.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn gold small" data-map="${d.id}">Map source</button><button class="btn small ghost" data-ignore="${d.id}">Ignore</button><a class="btn small" href="${esc(d.url)}" target="_blank">Open</a></div></div>`).join(''):'<div class="empty">Nothing unmapped. New ChatGPT threads or repos will land here if CONTROL can’t confidently resolve them.</div>'}</div></div>`}
function sourcesView(){const gh=state.sources.filter(s=>s.type==='github_repo'), chats=state.sources.filter(s=>s.type==='chatgpt_thread');return `<div class="topbar"><div class="titleblock"><h2>Sources / Sync</h2><p>GitHub + SHINO Sync feed the radar. Manual state editing is deliberately secondary.</p></div></div>
  <div class="panel" style="margin-bottom:12px"><h3>GitHub sync</h3><p class="note">Public repos sync without a token. For private repos like LaunchPAD, set <code>GITHUB_TOKEN</code> before starting the server, or paste a fine-grained token here for this one sync only. The server never writes that token to disk.</p><div class="config-row"><input id="ghToken" type="password" placeholder="Fine-grained GitHub token (optional, one sync only)"><button class="btn gold" id="syncBtn2">Sync configured repos</button></div></div>
  <div class="panel" style="margin-bottom:12px"><h3>SHINO Sync / ChatGPT</h3><p class="note">Load the Chrome extension from <code>extension/shino-sync</code>. Default local endpoint: <code>http://127.0.0.1:4177/api/ingest/chatgpt</code>. Historical conversations are NOT faked: until a real URL is captured they stay UNSYNCED.</p></div>
  <div class="panel"><h3>Registered sources</h3><div class="source-list">${[...gh,...chats].map(sourceItem).join('')}</div></div>`}
function sourceItem(s){const p=projectById(s.projectId);return `<div class="source-item"><div><strong>${esc(s.title||s.type)}</strong><p>${esc(p?.name||'Unmapped')} · ${esc(s.type)} · observed ${esc(rel(s.lastObservedAt))} ago ${s.state?`· ${esc(s.state)}`:''}</p>${s.url?`<a class="link" href="${esc(s.url)}" target="_blank">${esc(s.url)}</a>`:''}</div><span class="chip">${s.lastObservedAt?'REGISTERED':'NEEDS SYNC'}</span></div>`}
function projectModal(id){const p=projectById(id),d=projectState(id),ev=evidenceFor(id),src=sourcesFor(id),c=ctAs(p,d);return `<div class="modal-backdrop" id="modalBackdrop"><section class="modal"><div class="modal-head"><div><div class="universe">${esc(p.universe)}</div><h2 style="margin:4px 0 0">${esc(p.name)} <span class="pill ${esc(d.status)}">${esc(d.status)}</span></h2></div><button class="btn ghost" id="closeModal">✕</button></div><div class="modal-body"><div><p class="big-state">${esc(d.summary)}</p><div class="info-grid"><div class="info"><span class="meta-label">Last known movement</span><b>${esc(fmt(d.lastMovementAt))}</b></div><div class="info"><span class="meta-label">Freshness</span><b class="fresh-${d.freshness}">${esc(d.freshness)}</b></div><div class="info"><span class="meta-label">Confidence</span><b>${esc(d.confidence)}</b></div></div><div class="panel" style="margin-bottom:12px"><span class="meta-label">Recommended resume point</span><p style="line-height:1.5;color:#f1dfb7">${esc(d.nextAction)}</p><div class="actions">${c.chat?`<a class="btn gold" href="${esc(c.chat.url)}" target="_blank">Continue in ChatGPT</a>`:`<button class="btn" disabled>No synced ChatGPT thread yet</button>`}${c.pr?`<a class="btn" href="${esc(c.pr.url)}" target="_blank">Open PR</a>`:''}${c.repo?`<a class="btn ghost" href="${esc(c.repo)}" target="_blank">Open repo</a>`:''}</div></div><h3>Evidence timeline</h3><div class="timeline">${ev.map(e=>`<div class="event"><time>${esc(fmt(e.timestamp))} · ${esc(e.sourceType)}</time><strong>${esc(e.title)}</strong><p>${esc(e.summary)}</p>${e.url?`<a class="link" href="${esc(e.url)}" target="_blank">Open evidence ↗</a>`:''}</div>`).join('')}</div></div><aside><div class="why-box"><h3 style="margin-top:0">Why this state?</h3><p class="note">CONTROL derived <b>${esc(d.status)}</b> from ${d.evidenceIds.length} recent, non-superseded evidence items. Newer acceptance/merge evidence beats older draft intent; explicit pending/test gates become resume candidates.</p><ul class="note">${d.evidenceIds.map(id=>{const e=state.evidence.find(x=>x.id===id);return e?`<li>${esc(e.title)}</li>`:''}).join('')}</ul></div><div class="panel" style="margin-top:12px"><h3>Source health</h3>${src.map(s=>`<p class="note"><b>${esc(s.type)}</b><br>${esc(s.state||'registered')} · ${esc(rel(s.lastObservedAt))} ago</p>`).join('')}</div></aside></div></section></div>`}

async function syncGithub(){const input=$('#ghToken');const token=input?.value||'';toast('GitHub sync started…');try{const out=await api('/api/sync/github',{method:'POST',body:JSON.stringify({token})});state=out.state;toast('GitHub sync complete');render();}catch(e){toast(`Sync failed: ${e.message}`)}}
function bind(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});$('#search')?.addEventListener('input',e=>{query=e.target.value;render()});$('#statusFilter')?.addEventListener('change',e=>{statusFilter=e.target.value;render()});$('#syncBtn')?.addEventListener('click',()=>{view='sources';render();setTimeout(()=>$('#ghToken')?.focus(),0)});$('#syncBtn2')?.addEventListener('click',syncGithub);document.querySelectorAll('[data-open-project]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-stop]'))return;modalProject=el.dataset.openProject;render()});document.querySelectorAll('[data-why]').forEach(b=>b.onclick=e=>{e.stopPropagation();modalProject=b.dataset.why;render()});document.querySelectorAll('[data-stop]').forEach(el=>el.onclick=e=>e.stopPropagation());$('#closeModal')?.addEventListener('click',()=>{modalProject=null;render()});$('#modalBackdrop')?.addEventListener('click',e=>{if(e.target.id==='modalBackdrop'){modalProject=null;render()}});document.querySelectorAll('[data-map]').forEach(b=>b.onclick=async()=>{const id=b.dataset.map;const projectId=$(`[data-map-select="${id}"]`).value;await api('/api/remap',{method:'POST',body:JSON.stringify({discoveredId:id,projectId})});await load();toast('Source mapped')});document.querySelectorAll('[data-ignore]').forEach(b=>b.onclick=async()=>{await api('/api/discovered/ignore',{method:'POST',body:JSON.stringify({id:b.dataset.ignore})});await load()})}
load().catch(e=>{$('#app').innerHTML=`<div style="padding:30px;color:white">Failed to load CONTROL: ${esc(e.message)}</div>`});
