import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync('public/ui-v8.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');

assert.match(css,/v8\.2 — readability-first override/,'v8.2 marker missing');
assert.match(css,/\.v8-hero h1\{font-size:44px/,'dashboard title not large enough');
assert.match(css,/\.overview-copy small\{font-size:11px/,'KPI labels still too small');
assert.match(css,/\.priority-name h4\{font-size:13px/,'priority titles still too small');
assert.match(css,/\.board-card h4\{font-size:11px/,'board titles still too small');
assert.match(css,/\.v8-project-heading h1\{font-size:40px/,'project title still too small');
assert.match(css,/\.v8-project-summary\{font-size:13px!important/,'project summary still too small');
assert.match(css,/\.v8-activity-list p\{font-size:11px/,'activity copy still too small');
assert.match(css,/Do not shrink typography on short desktop windows/,'short-window scroll policy missing');
assert.match(css,/\.side-foot\{display:none!important\}/,'duplicate sidebar footer/build not hidden');
assert.match(app,/recent=ev\.slice\(0,5\)/,'project activity row cap missing');

console.log('CONTROL UI v8.2 readability-first checks PASS');
