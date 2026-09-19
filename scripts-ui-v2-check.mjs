import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const index = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/ui-v2.css','utf8');

assert.match(index, /ui-v2\.css/, 'UI v2 stylesheet is not loaded');
assert.match(app, /class="app view-\$\{view\}"/, 'active view class is not exposed on the app shell');
assert.match(css, /CONTROL UI v2/, 'UI v2 marker missing');
assert.match(css, /grid-template-areas:"head resume movement actions"/, 'project rows are not using compact row layout');
assert.match(css, /\.view-radar \.sync-health-metrics[\s\S]*display:none/, 'Radar sync diagnostics are not collapsed');
assert.match(css, /\.modal-backdrop[\s\S]*place-items:stretch end/, 'project details are not rendered as a right-side drawer');
assert.match(css, /\.view-radar \.summary\{display:none\}/, 'dense card summary is still visible on Radar');

console.log('CONTROL UI v2 checks PASS');
