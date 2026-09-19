import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('public/ui-v6.css','utf8');

assert.match(css, /v6\.2 — restore missing structural hero rules/, 'v6.2 marker missing');
assert.match(css, /\.command-hero\{[\s\S]*display:grid;[\s\S]*grid-template-columns:/, 'hero grid structure missing');
assert.match(css, /\.hero-visual\{[\s\S]*position:relative/, 'hero visual structure missing');
assert.match(css, /\.hero-orbit,[\s\S]*\.hero-status\{position:absolute\}/, 'hero absolute layers missing');
assert.match(css, /\.board-attention:before/, 'attention column tint missing');
assert.match(css, /\.board-active:before/, 'active column tint missing');
assert.match(css, /\.board-stable:before/, 'stable column tint missing');
assert.match(css, /\.priority-tile:before/, 'priority tile depth layer missing');

console.log('CONTROL UI v6.2 composition checks PASS');
