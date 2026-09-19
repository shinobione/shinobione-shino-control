import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js','utf8');
const css = fs.readFileSync('public/ui-v6.css','utf8');

assert.match(app, /premiumProjectBoard\(/, 'premium capped board missing');
assert.match(app, /slice\(0,3\)/, 'overview board must cap each column to three visible items');
assert.match(css, /v6\.1 — screenshot-calibrated proportions/, 'v6.1 calibration marker missing');
assert.match(css, /\.app\{grid-template-columns:280px/, 'desktop sidebar scale missing');
assert.match(css, /grid-template-columns:minmax\(0,1fr\) 480px/, 'desktop rail width calibration missing');
assert.match(css, /height:300px;min-height:300px/, 'hero target scale missing');
assert.match(css, /height:190px;padding:14px/, 'priority tile target scale missing');
assert.match(css, /min-height:91px;padding:10px/, 'project-card target scale missing');
assert.match(css, /\.board-more\{/, 'collapsed board overflow control missing');

console.log('CONTROL UI v6.1 scale checks PASS');
