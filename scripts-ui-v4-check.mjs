import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const index = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/ui-v4.css','utf8');

assert.match(index, /ui-v3\.css/, 'UI v3 base stylesheet missing');
assert.match(index, /ui-v4\.css/, 'UI v4 stylesheet missing');
assert.match(app, /FOCUS NOW/, 'hero focus panel missing');
assert.match(app, /Priority projects|Projects to resume/, 'priority project section missing');
assert.match(app, /activityRailV4\(/, 'v4 activity rail missing');
assert.match(app, /syncMiniPanel\(/, 'sync mini panel missing');
assert.match(app, /priorityProjectCard\(/, 'priority card renderer missing');
assert.match(css, /CONTROL UI v4/, 'UI v4 marker missing');
assert.match(css, /\.command-hero\{/, 'hero layout missing');
assert.match(css, /\.priority-grid\{/, 'priority grid missing');
assert.match(css, /\.hub-layout\{/, 'hub layout missing');
assert.match(css, /\.sync-mini-grid\{/, 'sync mini panel styles missing');

console.log('CONTROL UI v4 checks PASS');
