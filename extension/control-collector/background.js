const DEFAULTS = {
  enabled: true,
  endpoint: 'http://127.0.0.1:4177/api/ingest/chatgpt-delta',
  token: ''
};
const CATCHUP_SUCCESS_INTERVAL_MS = 30 * 60 * 1000;
const CATCHUP_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const CATCHUP_RUNNING_STALE_MS = 5 * 60 * 1000;
const CATCHUP_ALARM_NAME = 'shino-control-catchup-tick';
const CATCHUP_ALARM_PERIOD_MINUTES = 1;

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

async function ensureCatchupAlarm() {
  const existing = await chrome.alarms.get(CATCHUP_ALARM_NAME);
  if (existing) return;
  await chrome.alarms.create(CATCHUP_ALARM_NAME, {
    delayInMinutes:CATCHUP_ALARM_PERIOD_MINUTES,
    periodInMinutes:CATCHUP_ALARM_PERIOD_MINUTES
  });
}

async function dispatchCatchupTick() {
  const at = new Date().toISOString();
  const tabs = await chrome.tabs.query({
    url:['https://chatgpt.com/*','https://chat.openai.com/*']
  }).catch(()=>[]);
  const candidates = [...tabs].sort((a,b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
  let delivered = false;
  let tabId = null;

  for (const tab of candidates) {
    if (!tab?.id) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {type:'CONTROL_CATCHUP_TICK'});
      if (response?.ok !== false) {
        delivered = true;
        tabId = tab.id;
        break;
      }
    } catch {}
  }

  await chrome.storage.local.set({
    catchupSchedulerLastTickAt:at,
    catchupSchedulerLastTickStatus:delivered ? 'delivered' : candidates.length ? 'no-listener' : 'no-chatgpt-tab',
    catchupSchedulerLastTabId:tabId
  });
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm?.name !== CATCHUP_ALARM_NAME) return;
  dispatchCatchupTick().catch(async error => {
    await chrome.storage.local.set({
      catchupSchedulerLastTickAt:new Date().toISOString(),
      catchupSchedulerLastTickStatus:'error',
      catchupSchedulerLastTickError:String(error?.message || error)
    }).catch(()=>{});
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureCatchupAlarm().catch(()=>{});
});

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({
    enabled: current.enabled ?? DEFAULTS.enabled,
    endpoint: current.endpoint || DEFAULTS.endpoint,
    token: current.token || ''
  });
  await ensureCatchupAlarm();
});

ensureCatchupAlarm().catch(()=>{});

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
        const status = stored.catchupLastStatus || '';
        const staleRunning = status === 'running' && lastAttempt && now - lastAttempt >= CATCHUP_RUNNING_STALE_MS;
        const needsRetry = ['error','partial'].includes(status) || staleRunning;
        const retryWindow = needsRetry ? CATCHUP_RETRY_INTERVAL_MS : CATCHUP_SUCCESS_INTERVAL_MS;
        const baseline = needsRetry ? lastAttempt : Math.max(lastAttempt,lastCompleted);
        if (baseline && now - baseline < retryWindow) {
          return sendResponse({ok:true,run:false,reason:'catch-up cooldown'});
        }
        const at = new Date().toISOString();
        await chrome.storage.local.set({
          catchupLastAttemptAt:at,
          catchupLastStatus:'running',
          catchupLastError:'',
          catchupRecoveredStaleRunning:Boolean(staleRunning)
        });
        return sendResponse({ok:true,run:true,startedAt:at,recoveredStaleRunning:Boolean(staleRunning)});
      }

      if (message.type === 'CONTROL_CATCHUP_PLAN') {
        const inventory = message.inventory || {};
        const result = await controlPost('/api/chatgpt/catchup-plan', {...inventory,maxPlan:32});
        await chrome.storage.local.set({
          catchupLastInventoryCount:result.inventoryCount || 0,
          catchupLastChangedCount:result.changedCount || 0,
          catchupLastUnchangedCount:result.unchanged || 0,
          catchupLastNewCount:result.newCount || 0,
          catchupLastBaselineMissing:result.baselineMissing || 0,
          catchupLastStateSchemaUpgrades:result.stateSchemaUpgrades || 0,
          catchupLastDeferredCount:result.deferredCount || 0
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
        const failed = Number(ingested.failed || 0);
        const deferred = Number(plan.deferredCount || 0);
        const partial = failed > 0 || deferred > 0;
        const errorText = failed > 0
          ? `${failed} conversation(s) need retry`
          : deferred > 0 ? `${deferred} conversation(s) deferred to next catch-up batch` : '';

        await chrome.storage.local.set({
          catchupLastCompletedAt:at,
          catchupLastStatus:partial ? 'partial' : 'complete',
          catchupLastError:errorText,
          catchupLastPlanCount:plan.plan?.length || 0,
          catchupLastChangedCount:plan.changedCount || 0,
          catchupLastIngestedChanged:ingested.changed || 0,
          catchupLastFailed:failed,
          catchupLastDeferredCount:deferred,
          catchupLastStateSchemaUpgrades:plan.stateSchemaUpgrades || 0,
          catchupLastFailures:Array.isArray(ingested.failures) ? ingested.failures.slice(0,10) : []
        });
        await controlPost('/api/chatgpt/catchup-report', {
          inventoryCount:plan.inventoryCount || 0,
          knownCount:plan.known || 0,
          unchangedCount:plan.unchanged || 0,
          changedCount:plan.changedCount || 0,
          newCount:plan.newCount || 0,
          baselineMissingCount:plan.baselineMissing || 0,
          stateSchemaUpgrades:Number(plan.stateSchemaUpgrades || 0),
          plannedCount:plan.plan?.length || 0,
          refreshedCount:ingested.changed || 0,
          skippedCount:ingested.skipped || 0,
          failedCount:failed,
          deferredCount:deferred,
          failures:Array.isArray(ingested.failures) ? ingested.failures.slice(0,10) : []
        }).catch(()=>{});
        return sendResponse({ok:true,completedAt:at,status:partial ? 'partial' : 'complete'});
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
