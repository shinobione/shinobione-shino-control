import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/ui-premium.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');

assert.match(index,/ui-v10\.css/,'ui-v10 structural layer missing');
assert.match(index,/ui-premium\.css/,'premium layer is not active');
assert.doesNotMatch(index,/ui-v11\.css|ui-v12\.css|ui-v13\.css/,'obsolete layered overrides are still active');
assert.match(css,/Premium Presentation Layer v1/,'premium reset marker missing');
assert.match(css,/project-hero-master\.avif/,'raster hero asset missing');
assert.match(css,/brand-emblem\.avif/,'brand emblem missing');
assert.match(css,/\.sidebar:before,\.sidebar:after\{display:none!important\}/,'sidebar stray bloom is not disabled');
assert.match(css,/\.v84-focus-art[\s\S]*border:0!important/,'focus divider reset missing');
assert.match(css,/\.v84-project-art[\s\S]*border:0!important/,'project divider reset missing');
for(const cls of ['overview-total','overview-active','overview-attention','overview-stable']){
  assert.match(css,new RegExp('\\.'+cls+'\\{--kpi:'),'KPI color token missing for '+cls);
}
for(const cls of ['state','priority','stage','issues']){
  assert.match(css,new RegExp('\\.v8-project-metrics \\.'+cls+'\\{--metric:'),'metric color token missing for '+cls);
}
assert.match(css,/font-size:48px!important/,'dashboard readability scale missing');
assert.match(css,/\.board-card h4\{font-size:8px!important/,'board readability scale missing');
assert.match(app,/function displayEvidenceSummary\(/,'evidence hygiene helper missing');
assert.match(app,/displayEvidenceSummary\(item\)/,'activity hygiene is not applied');
assert.match(app,/displayEvidenceSummary\(e\)/,'next-action evidence hygiene is not applied');

for (const file of [
  'public/assets/ui/backgrounds/project-hero-master.avif',
  'public/assets/ui/brand/brand-emblem.avif'
]) {
  assert.ok(fs.existsSync(file), file+' missing');
  assert.ok(fs.statSync(file).size > 1000, file+' unexpectedly small');
}

console.log('CONTROL premium presentation checks PASS');
