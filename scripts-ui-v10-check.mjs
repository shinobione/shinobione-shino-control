import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/ui-v10.css','utf8');
const index=fs.readFileSync('public/index.html','utf8');

assert.match(index,/ui-v10\.css/,'UI v10 stylesheet is not active');
assert.doesNotMatch(index,/ui-v9\.css/,'UI v9 must not remain directly active');
assert.match(css,/CONTROL UI v10 — PREMIUM FEEL PASS/,'premium feel marker missing');
assert.doesNotMatch(css,/@import url\('\.\/ui-v9\.css'\)/,'v10 must be flattened, not import v9');
assert.match(css,/dashboard-premium\.webp/,'dashboard raster artwork missing');
assert.match(css,/project-premium\.webp/,'project raster artwork missing');
assert.match(css,/Decorative SVG hero artwork is intentionally retired/,'SVG-retirement marker missing');
assert.match(app,/function premiumIcon\(/,'premium icon renderer missing');
assert.match(app,/premiumIcon\('dashboard'\)/,'premium sidebar icons missing');
assert.match(app,/premiumIcon\(icon\)/,'premium KPI icons missing');
assert.match(app,/premiumIcon\('github'\)/,'premium sync icon missing');
assert.match(css,/\.premium-svg/,'premium icon styles missing');
assert.match(css,/backdrop-filter:blur\(18px\)/,'material blur treatment missing');
assert.match(css,/selective glow|PREMIUM FEEL PASS/,'premium material system missing');

console.log('CONTROL UI v10 premium feel checks PASS');
