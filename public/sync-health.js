const esc = (value='') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
let busy = false;
let timer = null;

function relativeTime(timestamp) {
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(time)) return 'unknown';
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export function syncHealthModel(catchup, now = Date.now()) {
  if (!catchup?.at) return null;
  const ageMs = Math.max(0, now - (Date.parse(catchup.at) || 0));
  const failed = Number(catchup.failedCount || 0);
  const deferred = Number(catchup.deferredCount || 0);
  const inaccessible = Number(catchup.inaccessibleCount || 0);
  let status = 'LIVE';
  if (ageMs > 45 * 60 * 1000) status = 'STALE';
  else if (failed > 0 || deferred > 0 || String(catchup.status || '').toUpperCase() === 'PARTIAL') status = 'PARTIAL';
  return {
    status,
    inventory:Number(catchup.inventoryCount || 0),
    unchanged:Number(catchup.unchangedCount || 0),
    planned:Number(catchup.plannedCount || 0),
    refreshed:Number(catchup.refreshedCount || 0),
    failed,
    deferred,
    inaccessible,
    changed:Number(catchup.changedCount || 0),
    failures:Array.isArray(catchup.failures) ? catchup.failures.slice(0,10) : [],
    inaccessibleItems:Array.isArray(catchup.inaccessible) ? catchup.inaccessible.slice(0,10) : [],
    at:catchup.at
  };
}

function failuresHtml(model) {
  const blocks = [];
  if (model.failed) {
    if (!model.failures.length) {
      blocks.push(`<div class="sync-health-note warning">${model.failed} conversation${model.failed===1?'':'s'} failed on the last pass. Detailed errors will appear after the next Collector retry.</div>`);
    } else {
      blocks.push(`<details class="sync-health-failures" open>
        <summary>${model.failed} transient conversation${model.failed===1?'':'s'} need retry</summary>
        <div class="sync-health-failure-list">${model.failures.map(item => `<div class="sync-health-failure"><strong>${esc(item.title || 'Untitled conversation')}</strong><span>${esc(item.error || 'Unknown error')}</span></div>`).join('')}</div>
      </details>`);
    }
  }
  if (model.inaccessible) {
    const detail = model.inaccessibleItems.length
      ? `<div class="sync-health-failure-list">${model.inaccessibleItems.map(item => `<div class="sync-health-failure"><strong>${esc(item.title || 'Untitled conversation')}</strong><span>ChatGPT no longer grants access. Historical CONTROL evidence is kept, but this thread is excluded from automatic retries.</span></div>`).join('')}</div>`
      : '';
    blocks.push(`<details class="sync-health-failures"><summary>${model.inaccessible} inaccessible conversation${model.inaccessible===1?'':'s'} excluded from retries</summary>${detail}</details>`);
  }
  return blocks.join('');
}

function panelHtml(model) {
  const statusClass = model.status.toLowerCase();
  const context = model.deferred
    ? `${model.planned} planned · ${model.deferred} deferred`
    : `${model.planned} planned · no deferred work`;
  return `<section class="sync-health sync-${statusClass}" data-sync-signature="${esc([model.status,model.at,model.inventory,model.refreshed,model.failed,model.deferred,model.inaccessible,model.failures.length,model.inaccessibleItems.length].join('|'))}">
    <div class="sync-health-head">
      <div><div class="sync-health-kicker">CHATGPT SYNC HEALTH</div><h3>Collector catch-up</h3></div>
      <span class="sync-health-status">${esc(model.status)}</span>
    </div>
    <div class="sync-health-metrics">
      <div><span>Known live</span><b>${model.inventory}</b></div>
      <div><span>Unchanged</span><b>${model.unchanged}</b></div>
      <div><span>Refreshed</span><b>${model.refreshed}</b></div>
      <div class="${model.failed?'metric-bad':''}"><span>Transient failed</span><b>${model.failed}</b></div>
      <div><span>Inaccessible</span><b>${model.inaccessible}</b></div>
    </div>
    <div class="sync-health-foot"><span>Last catch-up: ${esc(relativeTime(model.at))}</span><span>${esc(context)}</span></div>
    ${failuresHtml(model)}
  </section>`;
}

function isSupportedView() {
  const title = document.querySelector('.titleblock h2')?.textContent?.trim() || '';
  return title === 'Project Radar' || title === 'Sources / Sync';
}

function mount(panel) {
  const current = document.querySelector('.sync-health');
  if (current?.dataset.syncSignature === panel.dataset.syncSignature) return;
  if (current) {
    current.replaceWith(panel);
    return;
  }
  const focus = document.querySelector('.focus-now');
  if (focus) {
    focus.insertAdjacentElement('afterend', panel);
    return;
  }
  const topbar = document.querySelector('.main-inner > .topbar');
  if (topbar) topbar.insertAdjacentElement('afterend', panel);
}

async function renderSyncHealth() {
  if (busy || !isSupportedView()) return;
  busy = true;
  try {
    const response = await fetch('/api/state', {cache:'no-store'});
    if (!response.ok) return;
    const state = await response.json();
    const model = syncHealthModel(state?.settings?.lastChatgptCatchup);
    if (!model) {
      document.querySelector('.sync-health')?.remove();
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = panelHtml(model);
    mount(wrapper.firstElementChild);
  } catch {}
  finally { busy = false; }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(renderSyncHealth, 120);
}

schedule();
setInterval(renderSyncHealth, 15000);
new MutationObserver(schedule).observe(document.getElementById('app'), {childList:true,subtree:true});
