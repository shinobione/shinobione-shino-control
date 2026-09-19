import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const css = fs.readFileSync('public/ui-v6.css','utf8');

assert.match(app, /function dashboardHero\(\)/, 'generic dashboard hero missing');
assert.doesNotMatch(app, /function heroPanel\(projects\)/, 'arbitrary-project dashboard hero still present');
assert.match(app, /Project Command Center/, 'generic CONTROL header missing');
assert.match(app, /function projectPage\(id\)/, 'full project page renderer missing');
assert.match(app, /modalProject\?projectPage\(modalProject\):radarView\(s\)/, 'project page is not routed into central workspace');
assert.match(app, /← Tableau de bord/, 'project-page back navigation missing');
assert.match(css, /v7 — generic dashboard header \+ full-screen central project pages/, 'v7 CSS marker missing');
assert.match(css, /\.project-page-layout\{/, 'project central layout missing');
assert.match(css, /\.project-page-hero\{/, 'project hero missing');
assert.match(css, /\.project-focus-panel/, 'project resume panel missing');
assert.match(css, /\.hero-brand-copy\{/, 'dashboard brand-copy treatment missing');

console.log('CONTROL UI v7 project-page checks PASS');
