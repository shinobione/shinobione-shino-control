(() => {
  const CHANNEL = 'SHINO_CONTROL_CATCHUP_V1';
  const GATE_POLL_INTERVAL_MS = 60 * 1000;
  const ACTIVE_REQUEST_STALE_MS = 5 * 60 * 1000;
  let activeRequest = null;

  function requestId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  }

  async function askBackground(type, payload = {}) {
    return chrome.runtime.sendMessage({type, ...payload});
  }

  async function clearStaleActiveRequest() {
    if (!activeRequest) return;
    const startedAt = Number(activeRequest.startedAt || 0);
    if (!startedAt || Date.now() - startedAt < ACTIVE_REQUEST_STALE_MS) return;
    const stale = activeRequest;
    activeRequest = null;
    await askBackground('CONTROL_CATCHUP_FAILED', {
      stage:`${stale.stage || 'unknown'}-watchdog`,
      error:`catch-up stage exceeded ${ACTIVE_REQUEST_STALE_MS}ms`
    }).catch(()=>{});
  }

  async function startCatchup() {
    await clearStaleActiveRequest();
    if (activeRequest) return;
    const gate = await askBackground('CONTROL_CATCHUP_SHOULD_RUN').catch(() => null);
    if (!gate?.ok || !gate.run) return;
    const id = requestId('inventory');
    activeRequest = {stage:'inventory',id,startedAt:Date.now()};
    window.postMessage({channel:CHANNEL,type:'CONTROL_CATCHUP_INVENTORY_REQUEST',requestId:id}, '*');
  }

  window.addEventListener('message', async event => {
    if (event.source !== window || event.data?.channel !== CHANNEL || !activeRequest) return;
    if (event.data.requestId !== activeRequest.id) return;

    if (event.data.type === 'CONTROL_CATCHUP_INVENTORY_RESULT' && activeRequest.stage === 'inventory') {
      if (!event.data.ok) {
        await askBackground('CONTROL_CATCHUP_FAILED',{stage:'inventory',error:event.data.error || 'inventory failed'}).catch(()=>{});
        activeRequest = null;
        return;
      }
      const planned = await askBackground('CONTROL_CATCHUP_PLAN',{inventory:event.data.result}).catch(error=>({ok:false,error:String(error)}));
      if (!planned?.ok) {
        await askBackground('CONTROL_CATCHUP_FAILED',{stage:'plan',error:planned?.error || 'planning failed'}).catch(()=>{});
        activeRequest = null;
        return;
      }
      if (!planned.plan?.length) {
        await askBackground('CONTROL_CATCHUP_COMPLETE',{plan:planned,ingested:{attempted:0,changed:0,skipped:0,failed:0}}).catch(()=>{});
        activeRequest = null;
        return;
      }
      const id = requestId('fetch');
      activeRequest = {stage:'fetch',id,plan:planned,startedAt:Date.now()};
      window.postMessage({channel:CHANNEL,type:'CONTROL_CATCHUP_FETCH_REQUEST',requestId:id,plan:planned.plan}, '*');
      return;
    }

    if (event.data.type === 'CONTROL_CATCHUP_FETCH_RESULT' && activeRequest.stage === 'fetch') {
      if (!event.data.ok) {
        await askBackground('CONTROL_CATCHUP_FAILED',{stage:'fetch',error:event.data.error || 'targeted fetch failed'}).catch(()=>{});
        activeRequest = null;
        return;
      }
      const ingested = await askBackground('CONTROL_CATCHUP_INGEST',{payloads:event.data.result?.payloads || [],failures:event.data.result?.failures || []}).catch(error=>({ok:false,error:String(error)}));
      if (!ingested?.ok) {
        await askBackground('CONTROL_CATCHUP_FAILED',{stage:'ingest',error:ingested?.error || 'ingest failed'}).catch(()=>{});
      } else {
        await askBackground('CONTROL_CATCHUP_COMPLETE',{plan:activeRequest.plan,ingested}).catch(()=>{});
      }
      activeRequest = null;
    }
  });

  const attempt = () => startCatchup().catch(()=>{});
  const boot = () => setTimeout(attempt, 5000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();

  // This is intentionally only a cheap gate poll. The background worker owns the real cooldown:
  // ~5 min after PARTIAL/error, ~30 min after a clean pass. Polling once a minute lets a partial
  // migration resume promptly instead of accidentally waiting for the old 15-minute client timer.
  setInterval(attempt, GATE_POLL_INTERVAL_MS);
  window.addEventListener('focus', attempt);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') attempt();
  });
})();
