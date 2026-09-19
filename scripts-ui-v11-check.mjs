import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/ui-v11.css','utf8');
const index=fs.readFileSync('public/index.html','utf8');

assert.match(index,/ui-v11\.css/,'UI v11 stylesheet is not active');
assert.match(css,/CONTROL UI v11 — MASTER ASSET SYSTEM/,'v11 marker missing');
assert.match(css,/dashboard-hero-master\.avif/,'dashboard master asset missing from CSS');
assert.match(css,/project-hero-master\.avif/,'project master asset missing from CSS');
assert.match(css,/brand-emblem\.avif/,'brand master asset missing from CSS');
assert.match(css,/\.family-audio/,'audio family missing');
assert.match(css,/\.family-system/,'system family missing');
assert.match(css,/\.family-hardware/,'hardware family missing');
assert.match(css,/\.family-product/,'product family missing');
assert.match(css,/\.family-personal/,'personal family missing');
assert.match(css,/\.family-generic/,'generic future-project fallback missing');
assert.match(css,/\.motif-wave/,'audio motif missing');
assert.match(css,/\.motif-nodes/,'system motif missing');
assert.match(css,/\.motif-telemetry/,'hardware motif missing');
assert.match(css,/\.motif-panels/,'product motif missing');
assert.match(css,/\.motif-data/,'personal motif missing');
assert.match(css,/\.motif-layers/,'generic motif missing');
assert.match(css,/\.v8-hero-art:before,[\s\S]*?display:none!important/,'legacy faux hero art is not disabled');

assert.match(app,/PROJECT_VISUAL_FAMILIES/,'visual family registry missing');
assert.match(app,/function projectVisualProfile\(/,'project visual resolver missing');
assert.match(app,/function projectVisualClass\(/,'project family class resolver missing');
assert.match(app,/function projectVisualVars\(/,'project visual token resolver missing');
assert.match(app,/v11-family-motif/,'reusable family motif missing');
assert.match(app,/brand-emblem\.avif/,'brand emblem integration missing');

for (const file of [
  'public/assets/ui/backgrounds/dashboard-hero-master.avif',
  'public/assets/ui/backgrounds/project-hero-master.avif',
  'public/assets/ui/brand/brand-emblem.avif'
]) {
  assert.ok(fs.existsSync(file), `${file} missing`);
  assert.ok(fs.statSync(file).size > 1000, `${file} is unexpectedly small`);
}

console.log('CONTROL UI v11 master asset system checks PASS');
