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
assert.match(css,/NATIVE 3440 READABILITY CONTRACT/,'native readability contract missing');
assert.match(css,/\.board-card h4\{font-size:10px!important/,'board readable title floor missing');
assert.match(css,/\.v8-project-heading h1\{font-size:42px!important/,'project title readable floor missing');
assert.match(css,/\.v11-family-motif>i,[\s\S]*display:none!important/,'legacy motif internals are still visible');
assert.match(css,/@media\(min-width:2200px\)/,'ultrawide readability calibration missing');
assert.match(css,/\.v8-hero h1\{font-size:58px!important/,'ultrawide hero scale missing');
assert.match(css,/READABLE DENSITY PASS/,'readable density pass missing');
assert.match(css,/\.board-card h4\{font-size:12\.5px!important/,'ultrawide board title scale missing');
assert.match(css,/\.board-resume\{font-size:11px!important/,'ultrawide board body scale missing');
assert.match(css,/\.activity-item strong\{font-size:12px!important/,'dashboard rail title scale missing');
assert.match(css,/\.v8-project-heading h1\{font-size:56px!important/,'project hero title scale missing');
assert.match(css,/\.v8-project-summary\{font-size:14\.5px!important/,'project summary scale missing');
assert.match(css,/\.v8-activity-list p\{font-size:11px!important/,'activity body scale missing');
assert.match(css,/\.v8-why\{font-size:11\.5px!important/,'project rail body scale missing');
assert.match(app,/function displayEvidenceSummary\(/,'evidence hygiene helper missing');
assert.match(app,/displayEvidenceSummary\(item\)/,'activity hygiene is not applied');
assert.match(app,/displayEvidenceSummary\(e\)/,'next-action evidence hygiene is not applied');
assert.match(app,/function conversationalStateText\(/,'conversational summary filter missing');
assert.match(app,/function structuredProjectSummary\(/,'structured project summary fallback missing');
assert.match(css,/CONTENT HIERARCHY \+ FINAL MATERIAL POLISH/,'content hierarchy polish missing');
assert.match(css,/SPACE UTILIZATION \/ PROJECT PULSE/,'project pulse layout pass missing');
assert.match(css,/\.v950-project-pulse\{/,'project pulse style missing');
assert.match(app,/v950-project-pulse/,'project pulse markup missing');
assert.match(css,/SOURCES \/ SYNC PREMIUM REBUILD/,'Sources Sync premium rebuild missing');
assert.match(css,/\.view-sources \.main-inner\{/,'Sources Sync full-width override missing');
assert.match(css,/\.view-sources \.sync-health-metrics\{/,'Sources Sync health layout missing');
assert.match(app,/sources-summary-grid/,'Sources Sync summary metrics missing');
assert.match(app,/sources-layout/,'Sources Sync premium layout missing');
assert.match(css,/Sources \/ Sync semantic health colors/,'sync health semantic colors missing');
assert.match(css,/sidebar GitHub sync card layout fix/,'sidebar sync layout fix missing');
assert.match(css,/grid-template-columns:34px minmax\(0,1fr\) 30px/,'sidebar sync grid columns missing');

for (const file of [
  'public/assets/ui/backgrounds/project-hero-master.avif',
  'public/assets/ui/brand/brand-emblem.avif'
]) {
  assert.ok(fs.existsSync(file), file+' missing');
  assert.ok(fs.statSync(file).size > 1000, file+' unexpectedly small');
}

console.log('CONTROL premium presentation checks PASS');
