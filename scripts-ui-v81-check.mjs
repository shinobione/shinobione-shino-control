import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync('public/ui-v8.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');

assert.match(css,/v8\.1 — readability rescue/,'v8.1 readability marker missing');
assert.match(css,/grid-template-columns:clamp\(220px,7vw,250px\)/,'readable sidebar width missing');
assert.match(css,/\.v8-dashboard\{grid-template-columns:minmax\(0,1fr\) clamp\(320px,10\.5vw,380px\)/,'readable dashboard rail width missing');
assert.match(css,/\.v8-hero h1\{font-size:38px\}/,'dashboard hero title scale missing');
assert.match(css,/\.overview-copy small\{font-size:10px\}/,'KPI readable copy scale missing');
assert.match(css,/\.board-card h4\{font-size:9px/,'board readable title scale missing');
assert.match(css,/\.v8-project-heading h1\{font-size:34px/,'project heading readable scale missing');
assert.match(css,/\.v8-activity-list p\{font-size:9px/,'project activity readable copy missing');
assert.match(css,/Smaller 1080p class desktops: preserve legibility and allow vertical scroll instead of microscopic text/,'1080p legibility fallback missing');
assert.match(app,/PROJECT COMMAND/,'sidebar footer should not duplicate build number');

console.log('CONTROL UI v8.1 readability checks PASS');
