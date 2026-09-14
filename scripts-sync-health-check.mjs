import fs from 'node:fs';
import assert from 'node:assert/strict';

const background = fs.readFileSync('extension/control-collector/background.js','utf8');
const client = fs.readFileSync('extension/control-collector/catchup-client.js','utf8');
const main = fs.readFileSync('extension/control-collector/catchup-main.js','utf8');
const server = fs.readFileSync('server-entry.mjs','utf8');
const ui = fs.readFileSync('public/sync-health.js','utf8');
const html = fs.readFileSync('public/index.html','utf8');

assert.match(background,/const partial = failed > 0 \|\| deferred > 0/);
assert.match(background,/catchupLastStatus:partial \? 'partial' : 'complete'/);
assert.match(background,/unchangedCount:plan\.unchanged/);
assert.match(background,/failures:Array\.isArray\(ingested\.failures\)/);
assert.match(background,/\['error','partial'\]\.includes\(status\) \|\| staleRunning/);
assert.match(background,/CATCHUP_RUNNING_STALE_MS = 5 \* 60 \* 1000/);
assert.match(background,/catchupLastStateSchemaUpgrades/);
assert.match(client,/const GATE_POLL_INTERVAL_MS = 60 \* 1000/);
assert.match(client,/ACTIVE_REQUEST_STALE_MS = 5 \* 60 \* 1000/);
assert.match(client,/setInterval\(attempt, GATE_POLL_INTERVAL_MS\)/);
assert.match(client,/CONTROL_CATCHUP_FAILED/);
assert.doesNotMatch(client,/15 \* 60 \* 1000/);
assert.match(main,/DEFAULT_FETCH_TIMEOUT_MS = 15000/);
assert.match(main,/FETCH_CONCURRENCY = 4/);
assert.match(main,/AbortController/);
assert.match(main,/CHATGPT_FETCH_TIMEOUT_/);
assert.match(main,/Promise\.all\(chunk\.map/);
assert.match(server,/lastChatgptCatchup/);
assert.match(server,/unchangedCount:Number\(payload\.unchangedCount/);
assert.match(server,/failures = Array\.isArray\(payload\.failures\)/);
assert.match(server,/status:Number\(payload\.failedCount/);
assert.match(ui,/CHATGPT SYNC HEALTH/);
assert.match(ui,/Known live/);
assert.match(ui,/need retry/);
assert.match(html,/sync-health\.css/);
assert.match(html,/sync-health\.js/);

console.log('ChatGPT Sync Health checks passed');
