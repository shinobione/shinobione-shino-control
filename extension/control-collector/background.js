const DEFAULTS = {
  enabled: true,
  endpoint: 'http://127.0.0.1:4177/api/ingest/chatgpt-delta',
  token: ''
};
const CATCHUP_SUCCESS_INTERVAL_MS = 30 * 60 * 1000;
const CATCHUP_RETRY_INTERVAL_MS = 5 * 60 * 1000;

async function config() {
  return chrome.storage.local.get(DEFAULTS);
}

async function recordStatus(patch) {
  await chrome.storage.local.set({
    collectorLastObservedAt: new Date().toISOString(),
    ...patch
  });
}

async function controlPost(pathname, body = {}) {
  const cfg = await config();
  if (!cfg.enabled) return {ok:true,skipped:true,reason:'collector disabled'};
  if (!cfg.endpoint) throw new Error('CONTROL Collector endpoint is not configured');
  const endpoint = new URL(cfg.endpoint);
  endpoint.pathname = pathname;
  endpoint.search = '';
  endpoint.hash = '';
  const response = await fetch(endpoint.href, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      ...(cfg.token ? {Authorization:`Bearer ${cfg.token}`} : {})
    },
    body:JSON.stringify(body)
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || `CONTROL HTTP ${response.status}`);
  return data;
}

async function ingestDelta(payload) {
  return controlPost('/api/ingest/chatgpt-delta', payload || {});
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({
    enabled: current.enabled ?? DEFAULTS.enabled,
    endpoint: current.endpoint || DEFAULTS.endpoint,
    token: current.token || ''
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('CONTROL_')) return;

  (async () => {
    try {
      if (message.type === 'CONTROL_COLLECT_DELTA') {
        const body = await ingestDelta(message.payload || {});
        await recordStatus({
          collectorLastStatus: body.skipped ? 'unchanged' : body.mapped === false ? 'discovered' : 'synced',
          collectorLastError:'',
          collectorLastProjectId:body.projectId || null,
          collectorLastConversationKey:body.conversationKey || message.payload?.conversationKey || null
        });
        return sendResponse({ok:true,body});
      }

      if (message.type === 'CONTROL_CATCHUP_SHOULD_RUN') {
        const cfg = await config();
        if (!cfg.enabled) return sendResponse({ok:true,run:false,reason:'collector disabled'});
        const stored = await chrome.storage.local.get({
          catchupLastAttemptAt:'', catchupLastCompletedAt:'', catchupLastStatus:''
        });
        const now = Date.now();
        const lastAttempt = Date.parse(stored.catchupLastAttemptAt || '') || 0;
        const lastCompleted = Date.parse(stored.catchupLastCompletedAt || '') || 0;
        const retryWindow = stored.catchupLastStatus === 'error' ? CATCHUP_RETRY_INTERVAL_MS : CATCHUP_SUCCESS_INTERVAL_MS;
        const baseline = stored.catchupLastStatus === 'error' ? lastAttempt : Math.max(lastAttempt,lastCompleted);
        if (baseline && now - baseline < retryWindow) {
          return sendResponse({ok:true,run:false,reason:'catch-up cooldown'});
        }
        const at = new Date().toISOString();
        await chrome.storage.local.set({catchupLastAttemptAt:at,catchupLastStatus:'running',catchupLastError:''});
        return sendResponse({ok:true,run:true,startedAt:at});
      }

      if (message.type === 'CONTROL_CATCHUP_PLAN') {
        const inventory = message.inventory || {};
        const result = await controlPost('/api/chatgpt/catchup-plan', {
          ...inventory,
          maxPlan:32
        });
        await chrome.storage.local.set({
          catchupLastInventoryCount:result.inventoryCount || 0,
          catchupLastChangedCount:result.changedCount || 0,
          catchupLastUnchangedCount:result.unchanged || 0,
          catchupLastNewCount:result.newCount || 0,
          catchupLastBaselineMissing:result.baselineMissing || 0
        });
        return sendResponse({ok:true,...result});
      }

      if (message.type === 'CONTROL_CATCHUP_INGEST') {
        const payloads = Array.isArray(message.payloads) ? message.payloads.slice(0,32) : [];
        const fetchFailures = Array.isArray(message.failures) ? message.failures : [];
        const counts = {attempted:payloads.length,changed:0,skipped:0,failed:fetchFailures.length};
        const failures = [...fetchFailures];
        for (const payload of payloads) {
          try {
            const body = await ingestDelta(payload);
            if (body?.changed) counts.changed++;
            else counts.skipped++;
          } catch (error) {
            counts.failed++;
            failures.push({key:payload?.conversationKey || '',title:payload?.title || '',error:String(error?.message || error)});
          }
        }
        return sendResponse({ok:true,...counts,failures});
      }

      if (message.type === 'CONTROL_CATCHUP_COMPLETE') {
        const at = new Date().toISOString();
        const plan = message.plan || {};
        const ingested = message.ingested || {};
        await chrome.storage.local.set({
          catchupLastCompletedAt:at,
          catchupLastStatus:'complete',
          catchupLastError:'',
          catchupLastPlanCount:plan.plan?.length || 0,
          catchupLastChangedCount:plan.changedCount || 0,
          catchupLastIngestedChanged:ingested.changed || 0,
          catchupLastFailed:ingested.failed || 0
        });
        await controlPost('/api/chatgpt/catchup-report', {
          inventoryCount:plan.inventoryCount || 0,
          plannedCount:plan.plan?.length || 0,
          refreshedCount:ingested.changed || 0,
          failedCount:ingested.failed || 0,
          deferredCount:plan.deferredCount || 0
        }).catch(()=>{});
        return sendResponse({ok:true,completedAt:at});
      }

      if (message.type === 'CONTROL_CATCHUP_FAILED') {
        const text = String(message.error || 'catch-up failed');
        await chrome.storage.local.set({
          catchupLastStatus:'error',
          catchupLastError:text,
          catchupLastFailureStage:message.stage || 'unknown'
        });
        return sendResponse({ok:true});
      }
    } catch (error) {
      const text = String(error?.message || error);
      if (message.type === 'CONTROL_COLLECT_DELTA') {
        await recordStatus({collectorLastStatus:'error',collectorLastError:text});
      } else {
        await chrome.storage.local.set({catchupLastStatus:'error',catchupLastError:text});
      }
      sendResponse({ok:false,error:text});
    }
  })();

  return true;
});
