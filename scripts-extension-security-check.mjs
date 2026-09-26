import assert from 'node:assert/strict';
import fs from 'node:fs';
import { controlEndpointFor } from './extension/control-collector/control-endpoint.js';

const manifest = JSON.parse(fs.readFileSync('extension/control-collector/manifest.json','utf8'));
const background = fs.readFileSync('extension/control-collector/background.js','utf8');
const api = fs.readFileSync('extension/control-collector/catchup-api.js','utf8');
const client = fs.readFileSync('extension/control-collector/catchup-client.js','utf8');

assert.equal(manifest.version, '0.2.9');
assert.equal(JSON.stringify(manifest).includes('"world":"MAIN"'), false, 'MAIN world must not be used');
assert.equal(fs.existsSync('extension/control-collector/catchup-main.js'), false, 'legacy MAIN-world bridge must be removed');

const scripts = manifest.content_scripts?.flatMap(item => item.js || []) || [];
assert.deepEqual(scripts, ['collector.js','catchup-api.js','catchup-client.js'], 'isolated scripts must load in dependency order');
assert.match(api, /__SHINO_CONTROL_CHATGPT_API_V1__/);
assert.match(api, /api\/auth\/session/);
assert.match(api, /\/backend-api\/conversation\//);
assert.doesNotMatch(api, /window\.postMessage/);
assert.doesNotMatch(api, /addEventListener\(['"]message/);
assert.doesNotMatch(client, /window\.postMessage/);
assert.doesNotMatch(client, /addEventListener\(['"]message/);
assert.match(client, /chatgptApi\(\)/);
assert.match(client, /CLIENT_VERSION = '0\.2\.9'/);
assert.match(background, /CATCHUP_RECOVERY_FILES = \['collector\.js','catchup-api\.js','catchup-client\.js'\]/);

// Legacy credentials must not be sent by the Collector, and stored endpoint
// overrides must never turn the local browser sensor into a remote client.
assert.ok(background.includes("import { controlEndpointFor } from './control-endpoint.js'"));
assert.ok(background.includes("chrome.storage.local.remove('token')"));
assert.doesNotMatch(background, /Authorization|Bearer|cfg\.token|current\.token/);
assert.equal(
  controlEndpointFor('http://127.0.0.1:4177/api/ingest/chatgpt-delta','/api/chatgpt/catchup-plan'),
  'http://127.0.0.1:4177/api/chatgpt/catchup-plan'
);
assert.equal(
  controlEndpointFor('http://localhost:4211/legacy?secret=bad#fragment','/api/chatgpt/catchup-report'),
  'http://localhost:4211/api/chatgpt/catchup-report'
);
for (const endpoint of [
  'https://127.0.0.1:4177/',
  'http://example.com:4177/',
  'http://127.0.0.2:4177/',
  'http://evil@localhost:4177/',
  'file:///etc/passwd',
  'not a URL'
]) {
  assert.throws(() => controlEndpointFor(endpoint,'/api/ingest/chatgpt-delta'), /loopback/);
}
assert.throws(() => controlEndpointFor('http://localhost:4177/','https://evil.invalid'), /API path/);

console.log('CONTROL extension isolated-world security checks PASS');
