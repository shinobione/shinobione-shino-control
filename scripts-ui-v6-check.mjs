import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const index = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/ui-v6.css','utf8');

assert.match(index, /ui-v3\.css/, 'UI v3 base stylesheet missing');
assert.match(index, /ui-v6\.css/, 'UI v6 stylesheet missing');
assert.doesNotMatch(index, /ui-v4\.css/, 'UI v4 must not be loaded in v6');
assert.doesNotMatch(index, /ui-v5\.css/, 'UI v5 must not be loaded in v6');

assert.match(app, /Tableau de bord/, 'premium sidebar labels missing');
assert.match(app, /premiumPriorityCard\(/, 'premium priority renderer missing');
assert.match(app, /environmentPanel\(/, 'environment panel missing');
assert.match(app, /premiumRail\(/, 'premium right rail missing');
assert.match(app, /allProjectsPanel\(/, 'all-projects panel missing');
assert.match(app, /githubPulse\(/, 'GitHub pulse strip missing');
assert.match(app, /controlProjectView/, 'project Board/List preference missing');
assert.match(app, /metric-bars/, 'metric mini charts missing');

assert.match(css, /CONTROL UI v6/, 'UI v6 marker missing');
assert.match(css, /\.premium-top,\.premium-body/, 'two-column dashboard shell missing');
assert.match(css, /\.environment-panel\{/, 'environment panel styles missing');
assert.match(css, /\.priority-row\{display:grid;grid-template-columns:repeat\(4/, 'four-card priority row missing');
assert.match(css, /\.project-board\{grid-template-columns:repeat\(4/, 'four-column all-project board missing');
assert.match(css, /\.github-pulse\{/, 'GitHub pulse styles missing');
assert.match(css, /\.metric-bars\{/, 'metric chart styles missing');
assert.match(css, /focus-now.*display:none!important/s, 'legacy focus injection is not hidden');

console.log('CONTROL UI v6 checks PASS');
