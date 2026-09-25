(() => {
  if (globalThis.__SHINO_CONTROL_CATCHUP_CLIENT_V1__) return;
  globalThis.__SHINO_CONTROL_CATCHUP_CLIENT_V1__ = true;

  const ACTIVE_REQUEST_STALE_MS = 20 * 60 * 1000;
  const CLIENT_RUNNING_STALE_MS = 20 * 60 * 1000;
  const CLIENT_PARTIAL_COOLDOWN_MS = 10 * 60 * 1000;
  const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
  const EXECUTION_PLAN_LIMIT = 8;
  const CLIENT_VERSION = '0.2.9';
  let activeRequest = null;

  async function askBackground(type, payload = {}) {
    return chrome.runtime.sendMessage({type, ...payload});
  }

  function chatgptApi() {
    const api = globalThis.__SHINO_CONTROL_CHATGPT_API_V1__;
    if (!api || typeof api.inventory !== 'function' || typeof api.fetchChanged !== 'function') {
      throw new Error('CONTROL_ISOLATED_CHATGPT_API_UNAVAILABLE');
    }
    return api;
  }

  async function clientCooldownAllowsAttempt() {
    const stored = await chrome.storage.local.get({
      catchupLastStatus:'',
      catchupLastAttemptAt:'',
      catchupLastCompletedAt:'',
      catchupRateLimitedUntil:0
    });
    const now = Date.now();
    const rateLimitedUntil = Number(stored.catchupRateLimitedUntil || 0);
    if (rateLimitedUntil > now) return false;

    const status = String(stored.catchupLastStatus || '');
    const lastAttempt = Date.parse(stored.catchupLastAttemptAt || '') || 0;
    const lastCompleted = Date.parse(stored.catchupLastCompletedAt || '') || 0;

    if (status === 'running' && lastAttempt && now - lastAttempt < CLIENT_RUNNING_STALE_MS) return false;
    if (['partial','error'].includes(status)) {
      const baseline = Math.max(lastAttempt,lastCompleted);
      if (baseline && now - baseline < CLIENT_PARTIAL_COOLDOWN_MS) return false;
    }
    return true;
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

  async function fail(stage, error) {
    const text = String(error?.message || error || 'catch-up failed');
    await askBackground('CONTROL_CATCHUP_FAILED',{stage,error:text}).catch(()=>{});
    activeRequest = null;
  }

  async function startCatchup() {
    await clearStaleActiveRequest();
    if (activeRequest) return;
    if (!await clientCooldownAllowsAttempt()) return;

    const gate = await askBackground('CONTROL_CATCHUP_SHOULD_RUN').catch(() => null);
    if (!gate?.ok || !gate.run) return;

    const startedAt = Date.now();
    try {
      const api = chatgptApi();

      activeRequest = {stage:'inventory',startedAt};
      const inventory = await api.inventory();

      activeRequest = {stage:'plan',startedAt};
      const planned = await askBackground('CONTROL_CATCHUP_PLAN',{inventory})
        .catch(error=>({ok:false,error:String(error?.message || error)}));
      if (!planned?.ok) throw new Error(planned?.error || 'planning failed');

      if (!planned.plan?.length) {
        activeRequest = {stage:'complete',startedAt,plan:planned};
        const completed = await askBackground('CONTROL_CATCHUP_COMPLETE',{
          plan:planned,
          ingested:{attempted:0,changed:0,skipped:0,failed:0}
        }).catch(error=>({ok:false,error:String(error?.message || error)}));
        if (!completed?.ok) throw new Error(completed?.error || 'completion failed');
        activeRequest = null;
        return;
      }

      const fullPlan = Array.isArray(planned.plan) ? planned.plan : [];
      const plan = fullPlan.slice(0,EXECUTION_PLAN_LIMIT);
      const executionPlan = {
        ...planned,
        plan,
        deferredCount:Number(planned.deferredCount || 0) + Math.max(0, fullPlan.length - plan.length)
      };

      activeRequest = {stage:'fetch',startedAt,plan:executionPlan};
      const fetchResult = await api.fetchChanged(plan);
      const unprocessedCount = Math.max(0, Number(fetchResult?.unprocessedCount || 0));
      if (unprocessedCount) {
        activeRequest.plan = {
          ...activeRequest.plan,
          deferredCount:Number(activeRequest.plan?.deferredCount || 0) + unprocessedCount
        };
      }
      if (fetchResult?.rateLimited) {
        await chrome.storage.local.set({catchupRateLimitedUntil:Date.now() + RATE_LIMIT_COOLDOWN_MS}).catch(()=>{});
      }

      activeRequest.stage = 'ingest';
      const ingested = await askBackground('CONTROL_CATCHUP_INGEST',{
        payloads:fetchResult?.payloads || [],
        failures:fetchResult?.failures || []
      }).catch(error=>({ok:false,error:String(error?.message || error)}));
      if (!ingested?.ok) throw new Error(ingested?.error || 'ingest failed');

      activeRequest.stage = 'complete';
      const completed = await askBackground('CONTROL_CATCHUP_COMPLETE',{
        plan:activeRequest.plan,
        ingested
      }).catch(error=>({ok:false,error:String(error?.message || error)}));
      if (!completed?.ok) throw new Error(completed?.error || 'completion failed');
      activeRequest = null;
    } catch (error) {
      await fail(activeRequest?.stage || 'api', error);
    }
  }

  const attempt = () => startCatchup().catch(()=>{});
  const boot = () => setTimeout(attempt, 5000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'CONTROL_CATCHUP_PING') {
      sendResponse({ok:true,version:CLIENT_VERSION,active:Boolean(activeRequest),stage:activeRequest?.stage || null});
      return false;
    }
    if (message?.type !== 'CONTROL_CATCHUP_TICK') return;
    attempt();
    sendResponse({ok:true,version:CLIENT_VERSION,active:Boolean(activeRequest),stage:activeRequest?.stage || null});
    return false;
  });

  window.addEventListener('focus', attempt);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') attempt();
  });
})();
