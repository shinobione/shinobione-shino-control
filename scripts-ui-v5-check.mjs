import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const index = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/ui-v5.css','utf8');

assert.match(index, /ui-v5\.css/, 'UI v5 stylesheet missing');
assert.match(app, /controlRadarModeV5/, 'overview-first mode storage missing');
assert.match(app, /Projects to resume/, 'overview project section missing');
assert.match(app, /featureProjectCard|featuredProjectCard/, 'rich project card renderer missing');
assert.match(app, /Needs a decision/, 'attention panel missing');
assert.match(app, /Overview/, 'overview mode missing');
assert.match(css, /CONTROL UI v5/, 'UI v5 marker missing');
assert.match(css, /\.feature-project-grid\{/, 'feature project grid styles missing');
assert.match(css, /\.command-hero\{/, 'hero depth styles missing');
assert.match(css, /box-shadow:0 26px 70px/, 'hero elevation missing');
assert.match(css, /\.overview-layout\{/, 'overview layout missing');

console.log('CONTROL UI v5 checks PASS');
