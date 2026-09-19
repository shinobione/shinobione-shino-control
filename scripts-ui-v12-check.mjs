import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/ui-v12.css','utf8');

assert.match(index,/ui-v12\.css/,'UI v12 stylesheet is not active');
assert.match(css,/CONTROL UI v12 — ASSET REVEAL/,'v12 marker missing');
assert.match(css,/dashboard-hero-master\.avif/,'dashboard raster asset is not referenced');
assert.match(css,/project-hero-master\.avif/,'project raster asset is not referenced');
assert.match(css,/brand-emblem\.avif/,'brand asset is not referenced');
assert.match(css,/\.v11-brand-emblem\s*\{[\s\S]*display:block!important/,'brand emblem is still hidden');
assert.match(css,/\.v8-hero:after[\s\S]*dashboard-hero-master\.avif/,'dashboard hero asset reveal missing');
assert.match(css,/\.v84-focus-panel:after[\s\S]*project-hero-master\.avif/,'focus raster reveal missing');
assert.match(css,/\.v8-project-hero:before[\s\S]*project-hero-master\.avif/,'project hero raster reveal missing');
assert.match(css,/0 0 62px var\(--family-glow\)/,'strong project glow missing');
assert.match(css,/\.nav button\.active[\s\S]*box-shadow/,'premium nav lighting missing');

console.log('CONTROL UI v12 premium asset reveal checks PASS');
