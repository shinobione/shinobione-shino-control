import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const index = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/ui-v3.css','utf8');

assert.match(index, /ui-v3\.css/, 'UI v3 stylesheet is not loaded');
assert.doesNotMatch(index, /ui-v2\.css/, 'legacy UI v2 stylesheet should not be loaded');
assert.match(app, /Project Command Center/, 'dashboard heading missing');
assert.match(app, /projectBoard\(/, 'board renderer missing');
assert.match(app, /projectListV3\(/, 'list renderer missing');
assert.match(app, /activityRail\(/, 'activity rail missing');
assert.match(app, /data-radar-mode/, 'Board/List switch missing');
assert.match(app, /data-status-pick/, 'overview quick filters missing');
assert.match(css, /CONTROL UI v3/, 'UI v3 marker missing');
assert.match(css, /\.project-board\{display:grid/, 'project board layout missing');
assert.match(css, /\.activity-rail\{display:grid/, 'activity rail layout missing');
assert.match(css, /\.overview-grid\{display:grid/, 'overview cards missing');
assert.match(css, /\.dashboard-layout\{display:grid/, 'dashboard layout missing');

console.log('CONTROL UI v3 checks PASS');
