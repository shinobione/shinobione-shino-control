import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const index = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/ui-v8.css','utf8');

assert.match(index,/ui-v8\.css/,'UI v8 stylesheet missing');
assert.doesNotMatch(index,/ui-v6\.css/,'UI v6 must not remain in active stylesheet stack');

assert.match(app,/Bon retour\. ☀/,'reference-style dashboard greeting missing');
assert.match(app,/BUILD v\$\{esc\(build\)\}/,'single hero build number missing');
assert.doesNotMatch(app,/side-foot[^\n]+BUILD/,'duplicate sidebar build number still present');
assert.match(app,/function systemStatusPanel\(/,'system connections panel missing');
assert.match(app,/Environnement local/,'local environment row missing');
assert.match(app,/function projectPage\(id\)/,'project page missing');
assert.match(app,/Priorité CONTROL/,'project priority metric missing');
assert.match(app,/Étape actuelle/,'project stage metric missing');
assert.match(app,/Fichiers clés/,'project files card missing');
assert.match(app,/data-global-project-search/,'project top search missing');

assert.match(css,/CONTROL UI v8/,'UI v8 marker missing');
assert.match(css,/\.v8-dashboard\{display:grid;grid-template-columns:minmax\(0,1fr\) 286px/,'desktop dashboard proportions missing');
assert.match(css,/\.v8-hero\{/,'dashboard hero styles missing');
assert.match(css,/\.v8-system-panel/,'system panel styles missing');
assert.match(css,/\.v8-project-hero\{/,'project hero styles missing');
assert.match(css,/\.v8-project-grid\{/,'project central layout missing');

console.log('CONTROL UI v8 checks PASS');
