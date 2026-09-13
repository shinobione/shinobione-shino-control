import { cleanFocusSummary, selectFocusProject } from './focus-engine.js';

const esc = (s='') => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let timer = null;
let inFlight = false;

function sourceLinks(state, project, focus) {
  const sources = (state.sources || []).filter(s => s.projectId === project.id && s.inventoryCurrent !== false);
  const chat = sources
    .filter(s => s.type === 'chatgpt_thread' && s.url)
    .sort((a,b) => Date.parse(b.conversationUpdatedAt || b.lastObservedAt || 0) - Date.parse(a.conversationUpdatedAt || a.lastObservedAt || 0))[0];
  const pr = (state.evidence || [])
    .filter(e => e.projectId === project.id && e.sourceType === 'github_pr' && e.url && !/superseded/i.test(`${e.title || ''} ${e.summary || ''}`))
    .sort((a,b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))[0];
  const repo = project.repo ? `https://github.com/${project.repo}` : null;
  return {chat, pr, repo, evidence: focus.evidence};
}

function actionButtons(links) {
  return [
    links.chat ? `<a class="focus-btn primary" href="${esc(links.chat.url)}" target="_blank">Continue in ChatGPT</a>` : '',
    links.pr ? `<a class="focus-btn" href="${esc(links.pr.url)}" target="_blank">Open PR</a>` : '',
    links.repo ? `<a class="focus-btn ghost" href="${esc(links.repo)}" target="_blank">GitHub</a>` : ''
  ].filter(Boolean).join('');
}

function renderHtml(state, focus) {
  if (!focus) {
    return `<section class="focus-now focus-clear" data-focus-signature="clear">
      <div class="focus-kicker">FOCUS NOW</div>
      <div class="focus-clear-title">Rien d’urgent à reprendre.</div>
      <p>CONTROL ne voit actuellement aucun projet actif, bloqué ou en attente de test qui mérite de passer devant les autres.</p>
    </section>`;
  }

  const {project, derived, evidence, action, reason, score} = focus;
  const links = sourceLinks(state, project, focus);
  const summary = cleanFocusSummary(derived.summary || evidence?.summary || 'État courant disponible dans CONTROL.');
  const next = action || 'Ouvrir la source la plus récente et reprendre depuis le dernier état connu.';
  const signature = `${project.id}|${derived.status}|${derived.lastMovementAt || ''}|${next}|${Math.round(score)}`;

  return `<section class="focus-now status-${esc(String(derived.status || '').replace(/\s+/g,'-'))}" data-focus-signature="${esc(signature)}">
    <div class="focus-topline">
      <div>
        <div class="focus-kicker">FOCUS NOW</div>
        <h3>${esc(project.name)}</h3>
        <div class="focus-universe">${esc(project.universe || 'PROJECT')}</div>
      </div>
      <span class="focus-status">${esc(derived.status)}</span>
    </div>
    <div class="focus-grid">
      <div class="focus-block">
        <span>WHY THIS ONE</span>
        <p>${esc(reason)}</p>
      </div>
      <div class="focus-block action">
        <span>DO THIS NEXT</span>
        <p>${esc(next)}</p>
      </div>
      <div class="focus-block context">
        <span>CURRENT STATE</span>
        <p>${esc(summary)}</p>
      </div>
    </div>
    <div class="focus-footer">
      <div class="focus-meta">Priority score ${Math.round(score)}${derived.freshness ? ` · ${esc(derived.freshness)}` : ''}${derived.confidence ? ` · ${esc(derived.confidence)} confidence` : ''}</div>
      <div class="focus-actions">${actionButtons(links)}</div>
    </div>
  </section>`;
}

async function renderFocus() {
  if (inFlight) return;
  const topbar = document.querySelector('.main-inner > .topbar');
  if (!topbar || !document.querySelector('.titleblock h2')?.textContent?.includes('Project Radar')) return;

  inFlight = true;
  try {
    const response = await fetch('/api/state', {cache:'no-store'});
    if (!response.ok) return;
    const state = await response.json();
    const focus = selectFocusProject(state);
    const html = renderHtml(state, focus);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const nextPanel = wrapper.firstElementChild;
    const current = document.querySelector('.focus-now');
    const nextSignature = nextPanel?.dataset.focusSignature || '';
    if (current?.dataset.focusSignature === nextSignature) return;
    if (current) current.replaceWith(nextPanel);
    else topbar.insertAdjacentElement('afterend', nextPanel);
  } catch {}
  finally { inFlight = false; }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(renderFocus, 140);
}

schedule();
new MutationObserver(schedule).observe(document.getElementById('app'), {childList:true, subtree:true});
