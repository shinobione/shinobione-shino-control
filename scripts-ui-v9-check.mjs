import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/ui-v9.css','utf8');
const index=fs.readFileSync('public/index.html','utf8');
const hero=fs.readFileSync('public/assets/control-hero-v9.svg','utf8');
const project=fs.readFileSync('public/assets/project-hero-v9.svg','utf8');

assert.match(index,/ui-v9\.css/,'UI v9 stylesheet is not active');
assert.doesNotMatch(index,/ui-v8\.css/,'UI v8 must not remain in the active stack');
assert.match(app,/function focusTodayPanel\(/,'real focus panel missing');
assert.match(app,/selectFocusProject\(state\)/,'focus engine is not used');
assert.match(app,/function projectEventMeta\(/,'project activity icon mapping missing');
assert.match(app,/v9-project-shell/,'project reference shell missing');
assert.match(app,/Sources du projet/,'real project source rail missing');
assert.match(css,/CONTROL UI v9 — reference fidelity pass/,'UI v9 marker missing');
assert.match(css,/control-hero-v9\.svg/,'dashboard artwork missing');
assert.match(css,/project-hero-v9\.svg/,'project artwork missing');
assert.match(css,/\.v9-project-shell/,'project rail-from-top layout missing');
assert.match(css,/\.v8-activity-list \.event-icon/,'rich project activity icons missing');
assert.match(css,/@media\(min-width:2200px\)/,'ultrawide reference calibration missing');
assert.match(hero,/<svg/,'dashboard SVG invalid');
assert.match(project,/<svg/,'project SVG invalid');

console.log('CONTROL UI v9 reference fidelity checks PASS');
