import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/ui-v13.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');

assert.match(index,/ui-v13\.css/,'UI v13 stylesheet is not active');
assert.match(css,/VISUAL COHERENCE \/ NATIVE 3440/,'v13 marker missing');
assert.match(css,/\.sidebar:before,[\s\S]*\.sidebar:after\{display:none!important\}/,'stray sidebar glow not disabled');
assert.match(css,/\.v8-hero[\s\S]*dashboard-hero-master\.avif/,'dashboard hero asset not integrated directly');
assert.match(css,/\.v8-hero-art:before[\s\S]*project-hero-master\.avif/,'dashboard montage layer missing');
assert.match(css,/\.v84-focus-art[\s\S]*border-left:0!important/,'focus seam not removed');
assert.match(css,/\.v8-project-hero[\s\S]*project-hero-master\.avif/,'project hero asset not integrated directly');
assert.match(css,/\.v8-project-hero:before\{display:none!important\}/,'old project hero split layer still active');
assert.match(css,/\.v84-project-art[\s\S]*border-left:0!important/,'project art divider not removed');

for(const cls of ['overview-total','overview-active','overview-attention','overview-stable']){
  assert.match(css,new RegExp('\\.'+cls+'\\{[\\s\\S]*--kpi-glow'),'missing KPI-specific glow for '+cls);
}
for(const cls of ['state','priority','stage','issues']){
  assert.match(css,new RegExp('\\.v8-project-metrics \\.'+cls+'\\{[\\s\\S]*--metric-glow'),'missing metric-specific glow for '+cls);
}
assert.match(css,/\.v9-project-side \.v8-side-card:nth-child\(4\)[\s\S]*--rail-glow/,'rail color mapping incomplete');
assert.match(app,/BEGIN:VEVENT\|DTSTART:\|RRULE:/,'raw schedule payload filtering missing');
assert.match(app,/"timing_mode"\\s\*:/,'raw JSON payload filtering missing');

console.log('CONTROL UI v13 visual coherence checks PASS');
