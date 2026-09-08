// v0.5.7 polite backfill pacing + ChatGPT rate-limit guard.
// Loaded last: wraps captureTab, replaces shinoIngestQueue, and guards full/retry buttons.

const SHINO_RATE_LIMIT_COOLDOWN_MS = 8 * 60 * 1000;

function shinoJitter(min, max) {
  return Math.round(min + Math.random() * Math.max(0, max - min));
}

async function shinoRateLimitStorage() {
  return chrome.storage.local.get({ rateLimitUntil:0, lastRateLimitText:'' });
}

async function shinoCooldownRemainingMs() {
  const { rateLimitUntil } = await shinoRateLimitStorage();
  return Math.max(0, Number(rateLimitUntil || 0) - Date.now());
}

async function shinoArmRateLimit(text = '') {
  const until = Date.now() + SHINO_RATE_LIMIT_COOLDOWN_MS;
  await chrome.storage.local.set({
    rateLimitUntil:until,
    lastRateLimitText:text || 'ChatGPT temporarily limited requests',
    lastRateLimitAt:Date.now()
  });
  return until;
}

async function shinoClearExpiredRateLimit() {
  const { rateLimitUntil } = await shinoRateLimitStorage();
  if (rateLimitUntil && Number(rateLimitUntil) <= Date.now()) {
    await chrome.storage.local.set({ rateLimitUntil:0, lastRateLimitText:'' });
  }
}

async function shinoRateLimitOnTab(tabId) {
  const result = await messageTab(tabId, { type:'SHINO_RATE_LIMIT_STATUS' }).catch(() => null);
  return result?.rateLimited ? result : null;
}

const shinoOriginalCaptureTab = captureTab;
captureTab = async function(tab, reason = 'manual', projectContext = null) {
  const limited = tab?.id ? await shinoRateLimitOnTab(tab.id) : null;
  if (limited) {
    await shinoArmRateLimit(limited.text || 'Too many requests');
    return { ok:false, rateLimited:true, error:'RATE_LIMITED', detail:limited.text || '' };
  }
  const out = await shinoOriginalCaptureTab(tab, reason, projectContext);
  if (out?.rateLimited || /RATE_LIMITED|too many requests|temporarily limited/i.test(String(out?.error || ''))) {
    await shinoArmRateLimit(out?.detail || out?.error || 'Too many requests');
    return { ...out, ok:false, rateLimited:true, error:'RATE_LIMITED' };
  }
  return out;
};

shinoIngestQueue = async function(queue, label = 'Backfill') {
  await shinoClearExpiredRateLimit();
  const remaining = await shinoCooldownRemainingMs();
  if (remaining > 0) {
    const mins = Math.max(1, Math.ceil(remaining / 60000));
    throw new Error(`ChatGPT cooldown active. Wait about ${mins} min before retrying.`);
  }

  const counts = { mapped:0, discovered:0, failed:0 };
  const failedThreads = [];
  let done = 0;
  let rateLimited = false;
  let deferred = 0;

  for (let i = 0; i < queue.length; i++) {
    const thread = queue[i];

    if (i > 0) {
      const delay = shinoJitter(3200, 5200);
      $('status').textContent = `${label} ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}\nPolite pacing: waiting ${(delay / 1000).toFixed(1)}s…`;
      await sleep(delay);
    }
    if (i > 0 && i % 8 === 0) {
      const cool = shinoJitter(9000, 14000);
      $('status').textContent = `${label} ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}\nSafety cooldown ${(cool / 1000).toFixed(0)}s after ${i} page loads…`;
      await sleep(cool);
    }

    let failure = null;
    let limited = false;
    try {
      await withTemporaryTab(thread.url, async tab => {
        const out = await captureTab(tab, label === 'Retry' ? 'retry-failed-backfill' : 'all-project-backfill', {
          projectKey:thread.projectKey,
          projectTitle:thread.projectTitle,
          projectUrl:thread.projectUrl
        });
        if (out?.ok) out.body?.discovered ? counts.discovered++ : counts.mapped++;
        else {
          failure = out?.error || 'capture failed';
          limited = !!out?.rateLimited || failure === 'RATE_LIMITED';
        }
      });
    } catch (e) {
      failure = e?.message || String(e);
      limited = /RATE_LIMITED|too many requests|temporarily limited/i.test(failure);
    }

    done++;
    if (failure) {
      failedThreads.push({ ...thread, lastError:failure });
      counts.failed++;
    }

    if (limited) {
      rateLimited = true;
      const rest = queue.slice(i + 1).map(t => ({ ...t, lastError:'DEFERRED_AFTER_RATE_LIMIT' }));
      failedThreads.push(...rest);
      deferred = rest.length;
      counts.failed += rest.length;
      await shinoArmRateLimit(failure || 'Too many requests');
      $('status').textContent = `RATE LIMIT DETECTED — STOPPED SAFELY\n${done}/${queue.length} attempted · ${counts.mapped} mapped · ${counts.discovered} discovered\n${failedThreads.length} queued for retry (${deferred} never opened).\nNo more ChatGPT pages will be opened during this run.`;
      break;
    }

    $('status').textContent = `${label} ${done}/${queue.length} · mapped ${counts.mapped} · discovered ${counts.discovered} · failed ${counts.failed}`;
  }

  await chrome.storage.local.set({ lastFailedBackfill:failedThreads });
  await shinoSetRetryState(failedThreads);
  return { counts, failedThreads, rateLimited, deferred };
};

async function shinoGuardButtonRun() {
  await shinoClearExpiredRateLimit();
  const remaining = await shinoCooldownRemainingMs();
  if (!remaining) return false;
  const mins = Math.max(1, Math.ceil(remaining / 60000));
  const { lastRateLimitText } = await shinoRateLimitStorage();
  $('status').textContent = `ChatGPT rate-limit cooldown active (~${mins} min remaining).\nBackfill/retry is intentionally blocked so SHINO Sync does not hammer ChatGPT again.${lastRateLimitText ? `\n${lastRateLimitText.slice(0,220)}` : ''}`;
  return true;
}

function shinoWrapRateLimitGuard(id) {
  const button = $(id);
  if (!button?.onclick) return;
  const original = button.onclick;
  button.onclick = async event => {
    if (await shinoGuardButtonRun()) return;
    await original.call(button, event);
    const { rateLimitUntil } = await shinoRateLimitStorage();
    if (Number(rateLimitUntil || 0) > Date.now()) {
      const remaining = Number(rateLimitUntil) - Date.now();
      $('status').textContent += `\nRATE-LIMIT SAFETY: retry locked for ~${Math.max(1, Math.ceil(remaining / 60000))} min.`;
    }
  };
}

shinoWrapRateLimitGuard('projects');
shinoWrapRateLimitGuard('retry');
shinoClearExpiredRateLimit().catch(() => {});
