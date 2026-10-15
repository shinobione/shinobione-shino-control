import { UNIVERSES, ACTION_STATUSES, safeUrl, isOverdue, projectUniverse } from './hq-model.js';

export const escapeHtml = (value='') => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function externalLink(url,label,cls='hq-link') {
  const href=safeUrl(url);
  return href ? `<a class="${escapeHtml(cls)}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} <span aria-hidden="true">↗</span></a>` : '';
}
export const dateLabel = value => value ? new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`)) : 'Sans échéance';
export const empty = (title,detail='') => `<div class="hq-empty"><span aria-hidden="true">◇</span><p>${escapeHtml(title)}</p>${detail?`<small>${escapeHtml(detail)}</small>`:''}</div>`;
export const universeTag = value => `<span class="hq-universe" data-universe="${escapeHtml(value)}">${escapeHtml(UNIVERSES[value]?.label || value)}</span>`;
export function renderAction(action,state={},today) {
  const late=isOverdue(action,today),project=state.projects?.find(p=>p.id===action.projectId);
  return `<article class="hq-action ${action.status==='DONE'?'is-done':''}">
    <button class="hq-check" data-complete="${escapeHtml(action.id)}" aria-label="${action.status==='DONE'?'Réouvrir':'Terminer'} : ${escapeHtml(action.title)}" title="${action.status==='DONE'?'Réouvrir':'Terminer'}">${action.status==='DONE'?'✓':'○'}</button>
    <div class="hq-action-body"><button class="hq-text-button hq-action-title" data-edit="actions" data-id="${escapeHtml(action.id)}">${escapeHtml(action.title)}</button>
      <div class="hq-meta">${universeTag(action.universe)}<span class="hq-priority ${escapeHtml(action.priority)}">${escapeHtml(action.priority)}</span><span>${escapeHtml(ACTION_STATUSES[action.status])}</span>${project?`<span>${escapeHtml(project.name)}</span>`:''}${action.category?`<span>${escapeHtml(action.category)}</span>`:''}
      ${action.dueDate?`<span class="${late?'hq-late':''}">${late?'En retard · ':''}${escapeHtml(dateLabel(action.dueDate))}</span>`:''}</div>
      ${action.description?`<p class="hq-description">${escapeHtml(action.description)}</p>`:''}
      ${action.amount!==null && action.amount!==undefined?`<small>${escapeHtml(action.amount)} ${escapeHtml(action.currency)}</small>`:''}
    </div>${externalLink(action.sourceUrl,'Source')}<button class="hq-icon-button" data-edit="actions" data-id="${escapeHtml(action.id)}" aria-label="Modifier : ${escapeHtml(action.title)}">⋯</button>
  </article>`;
}
export function renderProject(project,derived={},state={}) {
  const repo=typeof project.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(project.repo) ? `https://github.com/${project.repo}` : '';
  const sources=(state.sources || []).filter(s=>s.projectId===project.id && !s.control?.archived);
  const evidence=(state.evidence || []).filter(e=>e.projectId===project.id && e.inventoryCurrent !== false);
  const chat=sources.filter(s=>s.type==='chatgpt_thread' && s.inventoryCurrent !== false).sort((a,b)=>String(b.conversationUpdatedAt || b.lastObservedAt || '').localeCompare(String(a.conversationUpdatedAt || a.lastObservedAt || ''))).find(s=>safeUrl(s.url));
  const latest=type=>evidence.filter(e=>e.sourceType===type).sort((a,b)=>String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0];
  const ci=latest('github_ci'),pr=latest('github_pr'),commit=latest('github_commit');
  return `<article class="hq-project"><div class="hq-card-top">${universeTag(projectUniverse(project,state.hq))}<span class="hq-state" data-status="${escapeHtml(derived.status || 'UNSYNCED')}">${escapeHtml(derived.status || 'UNSYNCED')}</span></div>
    <h3><a href="#control/${encodeURIComponent(project.id)}">${escapeHtml(project.name)}</a></h3>
    <p class="hq-project-summary">${escapeHtml(derived.summary || 'Aucune source synchronisée pour ce projet.')}</p>
    <div class="hq-next"><small>PROCHAINE ÉTAPE · RESUME ENGINE</small><p>${escapeHtml(derived.nextAction || 'Ouvrir CONTROL pour examiner les sources.')}</p></div>
    <div class="hq-project-links"><a href="#control/${encodeURIComponent(project.id)}">Reprendre →</a>${externalLink(chat?.url,'Conversation')}${externalLink(pr?.url,'PR')}${externalLink(repo,'Dépôt')}${externalLink(repo ? `${repo}/issues` : '','Issues')}</div>
    ${repo?`<details class="hq-evidence"><summary>Sources GitHub et CI</summary><p>${ci?`${externalLink(ci.url,'CI')} · ${escapeHtml(ci.summary)}`:'CI · Non disponible dans CONTROL'}</p><p>${commit?externalLink(commit.url,commit.title):'Commit · Non disponible dans CONTROL'}</p><p>Issues : ${latest('github_issue')?'preuves enregistrées dans CONTROL':'flux non synchronisé ; lien GitHub disponible'}</p></details>`:''}
    <label class="hq-project-universe">Univers<select data-project-universe="${escapeHtml(project.id)}" aria-label="Univers du projet ${escapeHtml(project.name)}">${Object.entries(UNIVERSES).map(([key,u])=>`<option value="${key}" ${projectUniverse(project,state.hq)===key?'selected':''}>${u.name}</option>`).join('')}</select></label>
  </article>`;
}
