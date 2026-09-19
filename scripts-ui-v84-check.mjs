import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/ui-v8.css','utf8');
const mountains=fs.readFileSync('public/assets/control-mountains.svg','utf8');
const projectArt=fs.readFileSync('public/assets/project-workflow-art.svg','utf8');

assert.match(app,/selectFocusProject/,'focus engine not wired into dashboard');
assert.match(app,/function focusTodayPanel\(/,'focus today panel missing');
assert.match(app,/function v84PriorityMiniCard\(/,'compact priority cards missing');
assert.match(app,/function projectPipelinePanel\(/,'project pipeline missing');
assert.match(app,/v84-action-row/,'project next-action pipeline layout missing');
assert.match(css,/v8\.4 — art\/detail pass/,'v8.4 CSS marker missing');
assert.match(css,/control-mountains\.svg/,'mountain artwork not integrated');
assert.match(css,/project-workflow-art\.svg/,'project artwork not integrated');
assert.match(css,/\.v84-workspace-row/,'dashboard focus workspace styles missing');
assert.match(css,/\.v84-pipeline/,'pipeline styles missing');
assert.match(mountains,/<svg/,'mountain SVG missing');
assert.match(projectArt,/<svg/,'project workflow SVG missing');

console.log('CONTROL UI v8.4 art/detail checks PASS');
