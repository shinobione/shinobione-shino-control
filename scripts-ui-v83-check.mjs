import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync('public/ui-v8.css','utf8');

assert.match(css,/v8\.3 — ultrawide calibration/,'v8.3 marker missing');
assert.match(css,/@media \(min-width:2200px\)/,'ultrawide media query missing');
assert.match(css,/\.v8-hero h1\{font-size:58px/,'ultrawide dashboard title scale missing');
assert.match(css,/\.overview-copy small\{font-size:13px/,'ultrawide KPI copy too small');
assert.match(css,/\.priority-name h4\{font-size:15px/,'ultrawide priority titles too small');
assert.match(css,/\.board-card h4\{font-size:13px/,'ultrawide board titles too small');
assert.match(css,/\.v8-project-heading h1\{font-size:50px/,'ultrawide project title too small');
assert.match(css,/\.v8-project-summary\{font-size:15px!important/,'ultrawide project summary too small');
assert.match(css,/\.v8-activity-list p\{font-size:12\.5px/,'ultrawide activity copy too small');

console.log('CONTROL UI v8.3 ultrawide checks PASS');
