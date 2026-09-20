import { cleanFocusSummary, selectFocusProject } from './focus-engine.js';
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
function premiumIcon(name,cls=''){
  const paths={
    dashboard:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9 20v-6h6v6"/>',
    discover:'<circle cx="12" cy="12" r="8"/><path d="m14.8 9.2-2.1 5.6-5.5 2.1 2.1-5.6 5.5-2.1Z"/>',
    sync:'<path d="M20 7h-6V1"/><path d="M20 7a8 8 0 0 0-13.7-2.7L4 6.5"/><path d="M4 17h6v6"/><path d="M4 17a8 8 0 0 0 13.7 2.7l2.3-2.2"/>',
    projects:'<path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/>',
    active:'<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>',
    attention:'<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    stable:'<path d="M20 6 9 17l-5-5"/>',
    github:'<path d="M12 3a9 9 0 0 0-2.8 17.5c.45.08.62-.2.62-.44v-1.7c-2.52.55-3.05-1.08-3.05-1.08-.41-1.05-1-1.33-1-1.33-.82-.56.06-.55.06-.55.91.06 1.39.94 1.39.94.8 1.38 2.11.98 2.63.75.08-.59.31-.98.57-1.2-2.01-.23-4.13-1-4.13-4.48 0-.99.35-1.8.94-2.44-.1-.23-.41-1.16.09-2.41 0 0 .77-.25 2.52.93A8.7 8.7 0 0 1 12 8.17a8.7 8.7 0 0 1 2.3.31c1.75-1.18 2.52-.93 2.52-.93.5 1.25.19 2.18.09 2.41.59.64.94 1.45.94 2.44 0 3.49-2.13 4.24-4.15 4.47.32.28.61.83.61 1.68v2.5c0 .25.17.53.63.44A9 9 0 0 0 12 3Z"/>',
    chatgpt:'<circle cx="12" cy="12" r="7"/><path d="M9.5 8.5h5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H12l-3 2v-2h-.5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h1"/>',
    local:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>'
  };
  return `<svg class="premium-svg ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.projects}</svg>`;
}
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
  const text=String(value||'').trim();
  return /\b(USER|ASSISTANT):|powershell|ExecutionPolicy|PROJECT API COUNT|ACTIVE-TAB|NO_API_INVENTORY_RESULT|PS [A-Z]:\\|```|\bSet-[A-Z]|\bGet-[A-Z]|BEGIN:VEVENT|DTSTART:|RRULE:|\"timing_mode\"\s*:|\"prompt\"\s*:|\"title\"\s*:/i.test(text)
    || (/^[{[]/.test(text) && /[\"'}]\s*:/.test(text))
    || text.length>900;
}
function conversationalStateText(value=''){
  const text=String(value||'').trim();
  if(!text)return false;
  return /^(et |et ensuite|bon[, ]|ok[, ]|oui[, ]|non[, ]|là[, ]|alors[, ]|franchement|du coup|ensuite[, ])/i.test(text)
    || /\b(je|j'|tu|t'|on va|on attaque|on passe|on garde|on parle|tu ressens|tu veux|je préfère|je pense)\b/i.test(text)
    || /[😀-🙏🌀-🫿]/u.test(text);
}
function structuredProjectSummary(p,d,e){
  const action=displayResume(p,d,e);
  const lead={
    BLOCKED:'Blocage à lever.',
    'NEEDS TEST':'Validation en attente.',
    ACTIVE:'Travail en cours.',
    WAITING:'En attente.',
    STABLE:'État stable.',
    DONE:'Travail terminé.',
    EMPTY:'Projet sans activité courante.',
    UNSYNCED:'Projet non synchronisé.'
  }[d.status] || 'État courant.';
  if(['STABLE','DONE'].includes(d.status)) return `${lead} ${e?.title?`Dernier mouvement : ${e.title}.`:''}`.trim();
  return `${lead} Prochaine étape : ${action}`;
}
function displaySummary(p,d,e){
  const raw=String(d.summary||'').trim();
  if(!raw || noisyStateText(raw) || conversationalStateText(raw)) return structuredProjectSummary(p,d,e);
  return raw;
}
function displayEvidenceSummary(item){
  const raw=String(item?.summary||'').trim();
  if(!raw || noisyStateText(raw)){
    if(item?.sourceType==='chatgpt_thread') return 'Conversation mise à jour — ouvrir pour retrouver le contexte utile.';
    if(item?.sourceType==='github_pr') return 'Pull request mise à jour.';
    if(item?.sourceType==='github_issue') return 'Issue mise à jour.';
    if(item?.sourceType==='github_commit') return 'Nouveau mouvement GitHub.';
    return item?.title || 'Mise à jour du projet.';
  }
  return raw;
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
  const icon={Projects:'projects',Active:'active',Attention:'attention',Stable:'stable'}[label]||'projects';
  const bars=[28,42,36,54,67,48,76,62,88,73];
  return `<button class="overview-card ${cls}" data-status-pick="${esc(filter)}"><span class="overview-icon">${premiumIcon(icon)}</span><div class="overview-copy"><small>${esc(label)}</small><strong>${esc(value)}</strong><p>${esc(subtitle)}</p></div><div class="metric-bars" aria-hidden="true">${bars.map((h,i)=>`<i style="height:${Math.max(16,Math.min(96,h+(Number(value||0)%5)*2-(i%3)*3))}%"></i>`).join('')}</div></button>`;
}
function projectBoard(buckets){
  const columns=[["attention","Attention","Blocages & validations"],["active","In progress","Projets actifs"],["stable","Stable","État confirmé"],["other","Other","Waiting / empty / unsynced"]];
  return `<div class="project-board">${columns.map(([key,title,subtitle])=>`<section class="board-column board-${key}"><header><div><h4>${esc(title)} <span>${buckets[key].length}</span></h4><p>${esc(subtitle)}</p></div><i></i></header><div class="board-stack">${buckets[key].length?buckets[key].map(boardProjectCard).join(""):`<div class="board-empty">Rien ici pour le moment.</div>`}</div></section>`).join("")}</div>`;
}
function boardProjectCard(p){
  const d=projectState(p.id); if(!d)return "";
  const e=evidenceFor(p.id)[0], c=ctAs(p), badges=sourceBadges(p.id), resume=displayResume(p,d,e);
  return `<article class="board-card ${statusClass(d.status)} ${projectVisualClass(p)}" style="${projectVisualVars(p)}" data-open-project="${p.id}"><div class="board-card-top"><span class="project-type">${esc(p.universe||"PROJECT")}</span><span class="status-tag">${esc(boardLabel(d.status))}</span></div><h4>${esc(p.name)}</h4><p class="board-resume">${esc(resume)}</p><div class="board-meta"><span class="fresh-${esc(d.freshness)}">${esc(d.freshness)}</span><span>${e?`${esc(rel(e.timestamp))} ago`:"No evidence"}</span></div><div class="board-footer"><div class="mini-sources">${badges.slice(0,2).map(g=>`<span class="${sourceClass(g.type)}">${esc(g.label)}${g.count>1?` ×${g.count}`:""}</span>`).join("")}</div>${c.chat?`<a class="quick-open" href="${esc(c.chat.url)}" target="_blank" data-stop title="Continue in ChatGPT">↗</a>`:c.pr?`<a class="quick-open" href="${esc(c.pr.url)}" target="_blank" data-stop title="Open PR">↗</a>`:""}</div></article>`;
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
      <nav class="nav">${navBtn('radar',`<span class="nav-icon">${premiumIcon('dashboard')}</span><span>Tableau de bord</span>`)}${navBtn('discovered',`<span class="nav-icon">${premiumIcon('discover')}</span><span>Découvrir</span>`)}${navBtn('sources',`<span class="nav-icon">${premiumIcon('sync')}</span><span>Sources / Sync</span>`)}</nav>
      <div class="side-spacer"></div>
      <button class="sidebar-sync" data-view="sources"><span class="sidebar-sync-icon">${premiumIcon('github')}</span><div><b>Sync GitHub</b><small>Connecté</small></div><span class="sync-arrow">${premiumIcon('sync')}</span></button>
      <div class="sidebar-facts"><span>Dernière sync</span><b>${esc(rel(state.settings?.lastGithubSync?.at || state.settings?.lastChatgptCatchup?.at || state.derivedAt))} ago</b></div>
      <div class="side-status"><span class="live-dot"></span><div><b>${state.projects.length} projets</b><small>${overallFresh()} source picture</small></div></div>
      <div class="side-foot">SHINO // CONTROL<br><span>PROJECT COMMAND</span></div>
    </aside>
    <main class="main"><div class="main-inner"><div class="mobile-menu actions"><button class="btn" data-view="radar">Dashboard</button><button class="btn" data-view="discovered">Découvrir</button><button class="btn" data-view="sources">Sources</button></div>${view==='radar'?(modalProject?projectPage(modalProject):radarView(s)):view==='discovered'?discoveredView():sourcesView()}</div></main>
  </div>`;
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
function dashboardHero(){
  const build=window.SHINO_CONTROL_BUILD?.version||'';
  const focus=selectFocusProject(state)?.project;
  return `<section class="v8-hero">
    <div class="v8-hero-copy">
      <span class="v8-welcome">BIENVENUE DANS</span>
      <h1>SHINO <em>//</em> CONTROL</h1>
      <p>Interface centrale pour piloter tes projets, dépôts GitHub, tâches ChatGPT et orchestrer tout ton workflow.</p>
      <div class="v8-hero-search"><span>⌕</span><input data-search placeholder="Rechercher un projet, un dépôt, une tâche… (Ctrl + K)" value="${esc(query)}"><kbd>CTRL</kbd><kbd>K</kbd></div>
      <div class="v8-hero-actions"><button class="v8-primary" data-scroll-projects>Explorer les projets →</button>${focus?`<button class="v8-secondary v9-focus-cta" data-open-project="${focus.id}">◎ Continuer le focus</button>`:''}</div>
    </div>
    <div class="v8-hero-art" aria-hidden="true">
      <span class="v8-build">BUILD v${esc(build)}</span>
      <img class="v11-brand-emblem" src="./assets/ui/brand/brand-emblem.avif" alt="" loading="eager" decoding="async"><div class="v8-logo-stack"><span>S<small>//</small></span></div>
      <div class="v8-art-copy"><small>BUILD</small><small>IDEAS</small><small>AUTOMATE</small><small>CREATE</small><b>FURTHER</b></div>
    </div>
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
  const value=String(p?.name||p?.id||'project'); let hash=0;
  for(let i=0;i<value.length;i++) hash=((hash<<5)-hash)+value.charCodeAt(i);
  return `accent-${Math.abs(hash)%6}`;
}
const PROJECT_VISUAL_FAMILIES=[
  {family:'audio',motif:'wave',accent:'#815dff',accent2:'#35d8ff',glow:'rgba(120,83,255,.34)',match:['suno bridge','shinobiwan music','studio','lrc maker','analyse ia de musique','canva spotify gem','track-to-market']},
  {family:'system',motif:'nodes',accent:'#2d8cff',accent2:'#43e2ff',glow:'rgba(45,140,255,.32)',match:['shino-os','shino // control','shino codes','web app','control']},
  {family:'hardware',motif:'telemetry',accent:'#f0a93b',accent2:'#40d7df',glow:'rgba(239,169,59,.28)',match:['touch+ revival','risotools','shinoastea','matos informatique']},
  {family:'product',motif:'panels',accent:'#35cfc0',accent2:'#8f63ff',glow:'rgba(53,207,192,.28)',match:['trân closet','tran closet','french tranquille','naughty share','launchpad']},
  {family:'personal',motif:'data',accent:'#d9aa55',accent2:'#5ea8ff',glow:'rgba(217,170,85,.25)',match:['personnel','nicehash']}
];
function visualProjectKey(p){
  return String(`${p?.id||''} ${p?.name||''}`).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
}
function projectVisualProfile(p){
  const key=visualProjectKey(p);
  const spec=PROJECT_VISUAL_FAMILIES.find(item=>item.match.some(token=>key.includes(token.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')))) ||
    {family:'generic',motif:'layers',accent:'#647cff',accent2:'#bb5cff',glow:'rgba(100,124,255,.28)'};
  return {...spec,code:projectGlyph(p)};
}
function projectVisualClass(p){const v=projectVisualProfile(p);return `family-${v.family} motif-${v.motif}`;}
function projectVisualVars(p){const v=projectVisualProfile(p);return `--accent:${v.accent};--accent2:${v.accent2};--family-glow:${v.glow};`;}
function projectGlyph(p){
  const words=String(p?.name||'P').replace(/[^A-Za-z0-9À-ÿ]+/g,' ').trim().split(/\s+/).filter(Boolean);
  if(words.length>1) return esc((words[0][0]+words[1][0]).toUpperCase());
  return esc(String(words[0]||'P').slice(0,2).toUpperCase());
}
function premiumPriorityCard(p){
  const d=projectState(p.id); if(!d)return '';
  const e=evidenceFor(p.id)[0], c=ctAs(p), badges=sourceBadges(p.id), resume=displayResume(p,d,e), summary=displaySummary(p,d,e);
  return `<article class="priority-tile ${statusClass(d.status)} ${projectAccent(p)} ${projectVisualClass(p)}" style="${projectVisualVars(p)}" data-open-project="${p.id}"><div class="priority-tile-top"><div class="priority-symbol">${projectGlyph(p)}</div><div class="priority-name"><h4>${esc(p.name)}</h4><p>${esc(summary)}</p></div><span class="status-tag">${esc(boardLabel(d.status))}</span></div><div class="signal-track"><i></i></div><div class="priority-tile-foot"><div class="tile-tags">${[esc(p.universe||'PROJECT'),...badges.slice(0,1).map(g=>esc(g.label))].map(x=>`<span>${x}</span>`).join('')}</div><div class="tile-time"><span>${e?`${esc(rel(e.timestamp))} ago`:'—'}</span>${c.chat?`<a href="${esc(c.chat.url)}" target="_blank" data-stop>↗</a>`:''}</div></div><div class="tile-next" title="${esc(resume)}">${esc(resume)}</div></article>`;
}

function v84PriorityMiniCard(p){
  const d=projectState(p.id); if(!d)return '';
  const e=evidenceFor(p.id)[0], badges=sourceBadges(p.id), progress=projectProgress(d.status);
  return `<article class="v84-priority-mini ${statusClass(d.status)} ${projectAccent(p)} ${projectVisualClass(p)}" style="${projectVisualVars(p)}" data-open-project="${p.id}">
    <div class="v84-mini-head"><span class="v84-mini-glyph">${projectGlyph(p)}</span><div><h4>${esc(p.name)}</h4><p>${esc(displaySummary(p,d,e))}</p></div><span class="v84-mini-star">★</span></div>
    <div class="v84-mini-progress"><i style="width:${progress}%"></i><b>${progress}%</b></div>
    <div class="v84-mini-tags">${[esc(p.universe||'PROJECT'),...badges.slice(0,2).map(g=>esc(g.label))].slice(0,3).map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="v84-mini-meta"><span>${e?esc(rel(e.timestamp))+' ago':'—'}</span><span>${esc(boardLabel(d.status))}</span></div>
  </article>`;
}
function focusTodayPanel(projects){
  const focus=selectFocusProject(state);
  const p=focus?.project || priorityProjects(projects,1)[0];
  if(!p)return '';
  const d=projectState(p.id), e=evidenceFor(p.id)[0], cta=ctAs(p);
  if(!d)return '';
  const action=focus?.action || displayResume(p,d,e);
  const summary=cleanFocusSummary(displaySummary(p,d,e),220);
  const progress=projectProgress(d.status);
  const visual=projectVisualProfile(p);
  return `<section class="v84-focus-panel ${projectAccent(p)} ${projectVisualClass(p)}" style="${projectVisualVars(p)}" data-open-project="${p.id}">
    <div class="v84-focus-copy">
      <div class="v84-focus-kicker"><span>FOCUS AUJOURD'HUI</span><b>${esc(boardLabel(d.status))}</b></div>
      <div class="v84-focus-title"><span class="v84-focus-glyph">${projectGlyph(p)}</span><div><small>PROJET PRINCIPAL</small><h3>${esc(p.name)}</h3></div></div>
      <p>${esc(summary)}</p>
      <div class="v84-focus-progress"><i style="width:${progress}%"></i><b>${progress}%</b></div>
      <div class="v84-focus-next"><span>→</span><div><small>Prochaine étape</small><strong>${esc(action)}</strong></div></div>
      <div class="v84-focus-actions"><button class="v8-primary" data-open-project="${p.id}">Ouvrir le projet →</button>${cta.chat?`<a class="v8-secondary" href="${esc(cta.chat.url)}" target="_blank" data-stop>Continuer dans ChatGPT</a>`:''}</div>
    </div>
    <div class="v84-focus-art" aria-hidden="true"><div class="v11-family-motif"><span>${projectGlyph(p)}</span><i></i><b>${esc(visual.family)}</b></div><em>Ideas<br>into<br>motion</em></div>
  </section>`;
}
function projectPipelinePanel(d, progress){
  const rows=workflowSteps(d.status);
  return `<section class="v84-pipeline"><div class="v8-section-head"><div><span class="v8-section-icon">↯</span><h2>Pipeline de validation</h2></div><strong>${progress}%</strong></div>
    <div class="v84-pipeline-track"><i style="width:${progress}%"></i></div>
    <ul class="v84-pipeline-steps">${rows}</ul>
  </section>`;
}
function systemStatusPanel(){
  const m=state.settings?.lastChatgptCatchup;
  const failed=Number(m?.failedCount||0)+Number(m?.deferredCount||0);
  const healthy=failed===0;
  const hasGithub=state.sources.some(s=>String(s.type||'').startsWith('github_'));
  const hasChat=state.sources.some(s=>s.type==='chatgpt_thread');
  const row=(icon,label,value,ok=true)=>`<div class="v8-system-row"><span class="v8-system-icon">${premiumIcon(icon)}</span><div><small>${label}</small><b><i class="${ok?'ok':'warn'}"></i>${value}</b></div></div>`;
  return `<section class="v8-system-panel"><div class="v8-system-head"><span>SYSTEM</span><b>${healthy?'Tout OK':'À surveiller'}</b></div>${row('stable','Environnement',healthy?'Opérationnel':'À surveiller',healthy)}${row('github','GitHub',hasGithub?'Connecté':'Non détecté',hasGithub)}${row('chatgpt','ChatGPT',hasChat?'Connecté':'Non détecté',hasChat)}${row('local','Environnement local','Opérationnel',true)}</section>`;
}
function premiumRail(){
  const rows=latestEvidenceRows(6), discovered=state.discovered?.length||0;
  return `<aside class="v8-rail">${systemStatusPanel()}
    <section class="v8-rail-card"><div class="v8-rail-head"><h3>Activité récente</h3><button>Voir tout →</button></div><div class="v8-activity">${rows.length?rows.map(activityItem).join(''):'<div class="rail-empty">Aucune activité récente.</div>'}</div></section>
    ${syncMiniPanel()}
    <section class="v8-rail-card v8-sort"><div class="v8-rail-head"><h3>À trier</h3><span>${discovered}</span></div><div class="v8-sort-body"><div class="v8-sort-icon">▣</div><div><b>${discovered}</b><small>élément${discovered===1?'':'s'} à organiser</small></div><button data-view="discovered">Ouvrir dans Discover →</button></div></section>
  </aside>`;
}
function githubPulse(){
  const now=Date.now(), days=Array.from({length:14},(_,i)=>{const dayStart=new Date();dayStart.setHours(0,0,0,0);dayStart.setDate(dayStart.getDate()-(13-i));const start=dayStart.getTime(),end=start+86400000;const count=state.evidence.filter(e=>e.sourceType==='github_commit'&&Date.parse(e.timestamp)>=start&&Date.parse(e.timestamp)<end).length;return count;});
  const max=Math.max(1,...days), total=days.reduce((a,b)=>a+b,0);
  return `<section class="github-pulse"><div class="pulse-icon">‹›</div><div class="pulse-copy"><b>Activité GitHub</b><span>Progression sur les 14 derniers jours</span></div><div class="pulse-bars">${days.map(n=>`<i style="height:${18+Math.round((n/max)*70)}%"></i>`).join('')}</div><strong>+${total}</strong><small>commits</small></section>`;
}
function premiumProjectBoard(buckets){
  const columns=[['attention','Attention','Bloquants & validations'],['active','En cours','En développement'],['stable','Stables','Fonctionnels'],['other','Autres','Veille / idées']];
  return `<div class="project-board premium-project-board">${columns.map(([key,title,subtitle])=>{const items=buckets[key]||[],shown=items.slice(0,3),more=Math.max(0,items.length-shown.length);return `<section class="board-column board-${key}"><header><div><h4>${esc(title)} <span>${items.length}</span></h4><p>${esc(subtitle)}</p></div><i></i></header><div class="board-stack">${shown.length?shown.map(boardProjectCard).join(''):`<div class="board-empty">Rien ici pour le moment.</div>`}${more?`<button class="board-more" data-project-view="list">+ ${more} autre${more===1?'':'s'}</button>`:''}</div></section>`}).join('')}</div>`;
}
function allProjectsPanel(projects,buckets){
  const mode=(id,label)=>`<button class="view-chip ${projectView===id?'active':''}" data-project-view="${id}">${label}</button>`;
  return `<section class="all-projects-panel"><div class="all-projects-head"><div><span class="projects-head-icon">▦</span><h3>Tous les projets</h3><small>${projects.length} projets dans votre écosystème</small></div><div class="all-projects-tools"><div class="project-search"><span>⌕</span><input data-search placeholder="Rechercher un projet…" value="${esc(query)}"></div><select id="statusFilter" class="select compact-filter">${['ALL','ACTIVE','NEEDS TEST','BLOCKED','STABLE','WAITING','DONE','EMPTY','UNSYNCED'].map(x=>`<option ${statusFilter===x?'selected':''}>${x}</option>`).join('')}</select><div class="view-chips">${mode('board','Colonnes')}${mode('list','Liste')}</div></div></div>${projectView==='board'?premiumProjectBoard(buckets):projectListV3(projects)}</section>`;
}
function radarView(s){
  const projects=visibleProjects();
  const buckets={attention:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='attention'),active:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='active'),stable:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='stable'),other:projects.filter(p=>boardBucket(projectState(p.id)?.status)==='other')};
  const attentionCount=s.blocked+s.test, focus=selectFocusProject(state)?.project || priorityProjects(projects,1)[0];
  const priorities=priorityProjects(projects,5).filter(p=>p.id!==focus?.id).slice(0,3);
  return `<div class="v8-dashboard"><section class="v8-dashboard-main">${dashboardHero()}<section class="overview-grid">${overviewCard('Projects',state.projects.length,'Tous les projets suivis','overview-total','ALL')}${overviewCard('Active',s.active,'En développement','overview-active','ACTIVE')}${overviewCard('Attention',attentionCount,'Nécessitent un suivi','overview-attention',attentionCount?'NEEDS TEST':'ALL')}${overviewCard('Stable',s.stable,'À jour et OK','overview-stable','STABLE')}</section><section class="v84-workspace-row">${focusTodayPanel(projects)}<section class="v84-priority-panel"><div class="premium-section-head"><div><span>★</span><h3>Projets prioritaires</h3><p>Trois chantiers à garder dans le champ.</p></div><button data-scroll-projects>Voir tous →</button></div><div class="v84-priority-grid">${priorities.map(v84PriorityMiniCard).join('')}</div></section></section>${allProjectsPanel(projects,buckets)}${githubPulse()}</section>${premiumRail()}</div>`;
}
function controlPriority(status){
  return ({BLOCKED:'Critique','NEEDS TEST':'Haute',ACTIVE:'Moyenne',WAITING:'Moyenne',STABLE:'Basse',DONE:'Basse',EMPTY:'Basse',UNSYNCED:'Moyenne'})[status]||'Moyenne';
}
function projectProgress(status){
  return ({BLOCKED:28,'NEEDS TEST':72,ACTIVE:58,WAITING:44,STABLE:100,DONE:100,EMPTY:8,UNSYNCED:20})[status]||45;
}
function projectIssueCount(id){
  return evidenceFor(id).filter(e=>e.sourceType==='github_issue'&&!/closed|resolved/i.test(`${e.title||''} ${e.summary||''}`)).length;
}
function projectStage(p,d,e){
  return d.status==='NEEDS TEST'?'Validation & tests':d.status==='BLOCKED'?'Blocage à lever':d.status==='STABLE'?'Stable / maintenance':e?.sourceType==='github_pr'?'Pull request active':d.status==='ACTIVE'?'Développement actif':boardLabel(d.status);
}
function extractProjectFiles(id){
  const found=new Set();
  for(const e of evidenceFor(id)){
    const txt=`${e.title||''} ${e.summary||''}`;
    for(const m of txt.matchAll(new RegExp('\\b(?:src|lib|public|docs|tests|scripts|app|packages)/[A-Za-z0-9_./-]+\\.(?:js|mjs|ts|tsx|jsx|json|md|css|html|py|ps1|cs)\\b','g'))) found.add(m[0]);
    if(found.size>=5) break;
  }
  return [...found].slice(0,5);
}
function workflowSteps(status){
  const rows=status==='STABLE'||status==='DONE'?[['Implémentation','done'],['Tests','done'],['Validation','done'],['Stable','done']]
    :status==='NEEDS TEST'?[['Implémentation','done'],['Tests en cours','active'],['Validation','todo'],['Merge / clôture','todo']]
    :status==='BLOCKED'?[['Implémentation','done'],['Blocage','blocked'],['Validation','todo'],['Reprise','todo']]
    :[['Travail en cours','active'],['Revue','todo'],['Validation','todo'],['Clôture','todo']];
  return rows.map(([label,cls])=>`<li class="${cls}"><i></i><span>${label}</span></li>`).join('');
}
function projectEventMeta(item){
  const type=String(item?.sourceType||'');
  if(type==='github_pr')return {glyph:'PR',cls:'pr'};
  if(type==='github_commit')return {glyph:'‹›',cls:'commit'};
  if(type==='github_issue')return {glyph:'!',cls:'issue'};
  if(type==='chatgpt_thread')return {glyph:'AI',cls:'chat'};
  if(type==='github_component')return {glyph:'↯',cls:'component'};
  return {glyph:'•',cls:'other'};
}
function projectPage(id){
  const p=projectById(id), d=projectState(id); if(!p||!d)return radarView(stats());
  const ev=evidenceFor(id), src=sourcesFor(id), cta=ctAs(p), e=ev[0], files=extractProjectFiles(id);
  const summary=displaySummary(p,d,e), resume=displayResume(p,d,e), recent=ev.slice(0,5);
  const progress=projectProgress(d.status), issueCount=projectIssueCount(id), build=window.SHINO_CONTROL_BUILD?.version||'';
  const actionLinks=[
    cta.pr?`<a class="v8-action primary" href="${esc(cta.pr.url)}" target="_blank">Ouvrir PR ↗</a>`:'',
    cta.chat?`<a class="v8-action violet" href="${esc(cta.chat.url)}" target="_blank">Continuer</a>`:'',
    cta.repo?`<a class="v8-action" href="${esc(cta.repo)}" target="_blank">GitHub</a>`:''
  ].join('');
  const sourcePanel=src.slice(0,5).map(s=>`<div class="v9-source-row"><span class="v9-source-icon ${sourceClass(s.type)}">${s.type==='chatgpt_thread'?'AI':String(s.type||'').startsWith('github_')?'GH':'•'}</span><div><b>${esc(sourceLabel(s))}</b><small>${esc(s.title||s.state||'Source enregistrée')}</small></div><time>${esc(rel(s.conversationUpdatedAt||s.lastObservedAt))} ago</time></div>`).join('');
  const visual=projectVisualProfile(p);
  return `<div class="v8-project ${statusClass(d.status)} ${projectAccent(p)} ${projectVisualClass(p)}" style="${projectVisualVars(p)}">
    <header class="v8-project-top"><div class="v8-breadcrumb"><button id="closeModal">←</button><span>Projets</span><i>›</i><b>${esc(p.name)}</b></div><div class="v8-project-search"><span>⌕</span><input data-global-project-search placeholder="Rechercher un projet, un fichier, une commande…"><kbd>CTRL K</kbd></div><span class="v8-project-build">BUILD v${esc(build)}</span></header>
    <div class="v9-project-shell">
      <main class="v9-project-core">
        <section class="v8-project-hero">
          <div class="v8-project-identity"><div class="v8-project-heading"><span class="project-emblem large">${projectGlyph(p)}</span><div><div class="v8-project-chips"><span>Projet</span><span>${esc(p.universe||'CONTROL')}</span><span class="status-tag">${esc(boardLabel(d.status))}</span></div><h1>${esc(p.name)}</h1><p class="v8-project-subtitle">${esc(projectStage(p,d,e))}</p></div></div><p class="v8-project-summary">${esc(summary)}</p><div class="v8-project-actions">${actionLinks}<button class="v8-action" data-scroll-activity>Voir l’activité</button></div></div>
          <div class="v8-project-art v84-project-art"><div class="v11-project-visual" aria-hidden="true"><div class="v11-family-motif project-motif"><span>${projectGlyph(p)}</span><i></i><b>${esc(visual.family)}</b></div><div class="v11-visual-copy"><small>${esc(visual.family.toUpperCase())}</small><strong>${esc(projectStage(p,d,e))}</strong><span>SHINO // CONTROL</span></div></div><div class="v8-pj-words" aria-hidden="true"><span>BUILD</span><span>TEST</span><span>SHIP</span><strong>PROGRESS</strong></div><div class="v950-project-pulse"><div class="v950-pulse-head"><span>PROJECT PULSE</span><b>${progress}%</b></div><div class="v950-pulse-track"><i style="width:${progress}%"></i></div><div class="v950-pulse-grid"><div><small>ÉTAT</small><strong>${esc(boardLabel(d.status))}</strong></div><div><small>DERNIER MOUVEMENT</small><strong>${e?esc(rel(e.timestamp))+' ago':'—'}</strong></div><div><small>SOURCES</small><strong>${src.length}</strong></div></div></div></div>
        </section>
        <section class="v8-project-metrics">
          <article class="state"><span>◌</span><div><small>État</small><b>${esc(boardLabel(d.status))}</b><p>${esc(d.freshness)}</p></div><div class="v8-mini-bars">${[35,52,64,48,78,90].map(h=>`<i style="height:${h}%"></i>`).join('')}</div></article>
          <article class="priority"><span>!</span><div><small>Priorité CONTROL</small><b>${esc(controlPriority(d.status))}</b><p>${d.status==='BLOCKED'?'Action requise':d.status==='NEEDS TEST'?'Tests / validation':'Suivi courant'}</p></div><div class="v8-mini-bars">${[28,44,69,82,63,91].map(h=>`<i style="height:${h}%"></i>`).join('')}</div></article>
          <article class="stage"><span>▱</span><div><small>Étape actuelle</small><b>${esc(projectStage(p,d,e))}</b><p>${src.length} source${src.length===1?'':'s'} connectée${src.length===1?'':'s'}</p></div><div class="v8-mini-bars">${[38,62,50,74,86,71].map(h=>`<i style="height:${h}%"></i>`).join('')}</div></article>
          <article class="issues"><span>▤</span><div><small>Issues ouvertes</small><b>${issueCount}</b><p>${issueCount?'À examiner':'Aucune issue ouverte détectée'}</p></div><div class="v8-mini-bars">${[20,32,48,62,55,76].map(h=>`<i style="height:${h}%"></i>`).join('')}</div></article>
        </section>
        <div class="v84-action-row"><section class="v8-next-action"><div class="v8-next-copy"><span class="v8-section-icon">◎</span><div><small>PROCHAINE ACTION</small><h2>${esc(resume)}</h2><p>${e?esc(displayEvidenceSummary(e)):'Ouvrir la source la plus récente et reprendre le contexte.'}</p><div class="v8-project-actions">${actionLinks}</div></div></div><aside><div><small>Statut</small><b>${esc(boardLabel(d.status))}</b></div><div><small>Dernier mouvement</small><b>${e?esc(rel(e.timestamp))+' ago':'—'}</b></div><div><small>Sources</small><b>${src.length}</b></div></aside></section>${projectPipelinePanel(d,progress)}</div>
        <section class="v8-activity-panel" data-activity-section><div class="v8-section-head"><div><span class="v8-section-icon">⌘</span><h2>Activité du projet</h2></div><div class="v8-tabs"><button class="active">Toutes</button><button>Commits</button><button>Pull requests</button><button>Issues</button></div></div><div class="v8-activity-list">${recent.length?recent.map(item=>{const meta=projectEventMeta(item);return `<article class="event-${meta.cls}"><span class="event-icon">${meta.glyph}</span><div><time>${esc(rel(item.timestamp))} ago · ${esc(item.sourceType)}</time><h3>${esc(item.title)}</h3><p>${esc(displayEvidenceSummary(item))}</p></div>${item.url?`<a href="${esc(item.url)}" target="_blank">Voir →</a>`:''}</article>`}).join(''):'<div class="project-empty">Aucune activité courante.</div>'}</div></section>
      </main>
      <aside class="v8-project-side v9-project-side">
        <section class="v8-side-card"><div class="v8-section-head"><div><span class="v8-section-icon">↗</span><h2>Connexions</h2></div><span class="v8-good">Connecté</span></div>${['GitHub','ChatGPT','Environnement local'].map(label=>{const ok=label==='GitHub'?src.some(s=>String(s.type||'').startsWith('github_')):label==='ChatGPT'?src.some(s=>s.type==='chatgpt_thread'):true;return `<div class="v8-connection"><b>${label}</b><span><i class="${ok?'ok':'warn'}"></i>${ok?'Connecté':'Non détecté'}</span></div>`}).join('')}</section>
        <section class="v8-side-card"><div class="v8-section-head"><div><span class="v8-section-icon">?</span><h2>Pourquoi cet état ?</h2></div></div><p class="v8-why">${d.status==='EMPTY'?'CONTROL connaît le projet mais aucune conversation courante n’est rattachée.':`CONTROL dérive cet état depuis ${d.evidenceIds.length} élément${d.evidenceIds.length===1?'':'s'} récent${d.evidenceIds.length===1?'':'s'}.`}</p><ul class="v8-why-list">${d.evidenceIds.slice(0,5).map(eid=>{const item=state.evidence.find(x=>x.id===eid&&x.inventoryCurrent!==false);return item?`<li>${esc(item.title)}</li>`:''}).join('')}</ul></section>
        <section class="v8-side-card"><div class="v8-section-head"><div><span class="v8-section-icon">▣</span><h2>Fichiers clés</h2></div></div>${files.length?files.map(path=>`<div class="v8-file"><span>‹›</span><b>${esc(path)}</b></div>`).join(''):'<p class="v8-empty-note">Aucun chemin de fichier détecté dans les évidences courantes.</p>'}</section>
        <section class="v8-side-card v9-sources-card"><div class="v8-section-head"><div><span class="v8-section-icon">◎</span><h2>Sources du projet</h2></div><span class="v8-good">${src.length}</span></div>${sourcePanel||'<p class="v8-empty-note">Aucune source courante.</p>'}</section>
      </aside>
    </div>
  </div>`;
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
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;modalProject=null;render()});
  document.querySelectorAll('[data-search]').forEach(el=>el.addEventListener('input',e=>{query=e.target.value;render()}));
  $('#statusFilter')?.addEventListener('change',e=>{statusFilter=e.target.value;render()});
  document.querySelectorAll('[data-status-pick]').forEach(b=>b.addEventListener('click',()=>{statusFilter=b.dataset.statusPick||'ALL';render()}));
  document.querySelectorAll('[data-scroll-projects]').forEach(b=>b.addEventListener('click',()=>document.querySelector('.all-projects-panel')?.scrollIntoView({behavior:'smooth',block:'start'})));
  document.querySelectorAll('[data-scroll-activity]').forEach(b=>b.addEventListener('click',()=>document.querySelector('[data-activity-section]')?.scrollIntoView({behavior:'smooth',block:'start'})));
  document.querySelectorAll('[data-global-project-search]').forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter'){query=e.target.value;modalProject=null;view='radar';render();}}));
  document.querySelectorAll('[data-project-view]').forEach(b=>b.addEventListener('click',()=>{projectView=b.dataset.projectView||'board';localStorage.setItem('controlProjectView',projectView);render()}));
  $('#syncBtn')?.addEventListener('click',()=>{view='sources';render();setTimeout(()=>$('#ghToken')?.focus(),0)});
  $('#syncBtn2')?.addEventListener('click',syncGithub);
  document.querySelectorAll('[data-open-project]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-stop],[data-why]'))return;modalProject=el.dataset.openProject;render()});
  document.querySelectorAll('[data-why]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();modalProject=b.dataset.why;render()}));
  document.querySelectorAll('[data-stop]').forEach(el=>el.addEventListener('click',e=>e.stopPropagation()));
  $('#closeModal')?.addEventListener('click',()=>{modalProject=null;render()});
  document.querySelectorAll('[data-map]').forEach(b=>b.onclick=async()=>{const id=b.dataset.map;const projectId=$(`[data-map-select="${id}"]`).value;await api('/api/remap',{method:'POST',body:JSON.stringify({discoveredId:id,projectId})});await load();toast('Source mapped')});
  document.querySelectorAll('[data-ignore]').forEach(b=>b.onclick=async()=>{await api('/api/discovered/ignore',{method:'POST',body:JSON.stringify({id:b.dataset.ignore})});await load();toast('Source ignored')});
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modalProject){modalProject=null;render()}});
load().catch(e=>{$('#app').innerHTML=`<div style="padding:30px;color:white">Failed to load CONTROL: ${esc(e.message)}</div>`});