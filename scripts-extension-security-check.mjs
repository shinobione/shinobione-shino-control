import assert from 'node:assert/strict';
import fs from 'node:fs';

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

console.log('CONTROL extension isolated-world security checks PASS');
