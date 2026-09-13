import assert from 'node:assert/strict';
import { cleanFocusSummary, selectFocusProject } from './public/focus-engine.js';

const now = Date.parse('2026-09-13T19:00:00Z');
const base = {
  projects:[
    {id:'test',name:'Needs Test'},
    {id:'active',name:'Active'},
    {id:'blocked',name:'Blocked'},
    {id:'hidden',name:'Hidden',radarHidden:true},
    {id:'empty',name:'Empty'}
  ],
  derived:[
    {projectId:'test',status:'NEEDS TEST',freshness:'RECENT',confidence:'high',lastMovementAt:'2026-09-12T19:00:00Z',nextAction:'Run the live smoke test.'},
    {projectId:'active',status:'ACTIVE',freshness:'FRESH',confidence:'high',lastMovementAt:'2026-09-13T18:59:00Z',nextAction:'Implement the next dashboard slice.'},
    {projectId:'blocked',status:'BLOCKED',freshness:'RECENT',confidence:'high',lastMovementAt:'2026-09-13T18:50:00Z',nextAction:'Wait for vendor response.'},
    {projectId:'hidden',status:'NEEDS TEST',freshness:'FRESH',confidence:'high',lastMovementAt:'2026-09-13T18:59:30Z',nextAction:'Do hidden thing.'},
    {projectId:'empty',status:'EMPTY',freshness:'UNKNOWN',confidence:'low',nextAction:''}
  ],
  evidence:[]
};

let focus = selectFocusProject(structuredClone(base), now);
assert.equal(focus.project.id, 'test', 'NEEDS TEST should beat a merely ACTIVE project');
assert.match(focus.reason, /test|validation/i);
assert.equal(focus.action, 'Run the live smoke test.');

const actionableBlocked = structuredClone(base);
actionableBlocked.derived.find(d=>d.projectId==='test').status = 'STABLE';
actionableBlocked.derived.find(d=>d.projectId==='test').nextAction = '';
actionableBlocked.derived.find(d=>d.projectId==='blocked').nextAction = 'Fix the failing auth gate, then rerun CI.';
focus = selectFocusProject(actionableBlocked, now);
assert.equal(focus.project.id, 'blocked', 'Actionable BLOCKED should beat ACTIVE when CONTROL can actively unblock it');

const waitingBlocked = structuredClone(actionableBlocked);
waitingBlocked.derived.find(d=>d.projectId==='blocked').nextAction = 'Wait for vendor response.';
focus = selectFocusProject(waitingBlocked, now);
assert.equal(focus.project.id, 'active', 'Externally waiting BLOCKED must not steal Focus Now from actionable ACTIVE work');

const onlyStable = {
  projects:[{id:'stable',name:'Stable'}],
  derived:[{projectId:'stable',status:'STABLE',freshness:'RECENT',confidence:'high',lastMovementAt:'2026-09-12T19:00:00Z',nextAction:''}],
  evidence:[]
};
focus = selectFocusProject(onlyStable, now);
assert.equal(focus.project.id, 'stable', 'Stable project is a fallback only when no actionable work exists');

const none = {projects:[{id:'empty',name:'Empty'}],derived:[{projectId:'empty',status:'EMPTY'}],evidence:[]};
assert.equal(selectFocusProject(none, now), null, 'EMPTY-only radar should have no focus candidate');

const rawSummary = `## What changed
- v0.2.5 was live-validated on Suno v5.5 Advanced and merged to \`main\`
- adds safe exact-name Workspace selection from \`WORKSPACE\`
- adds safe exact-name saved Voice selection from \`VOICE\`
- adds **Préparer Workspace + Voice** to the Bridge panel
- confirms the new workflow is ready for PR #2 review`;
const cleaned = cleanFocusSummary(rawSummary);
assert.ok(!cleaned.includes('##'), 'Focus summary must remove markdown headings');
assert.ok(!cleaned.includes('`'), 'Focus summary must remove inline-code markers');
assert.ok(!cleaned.startsWith('What changed'), 'Generic summary heading must be removed');
assert.match(cleaned, /v0\.2\.5/);
assert.match(cleaned, /Workspace/);
assert.ok(cleaned.length <= 341, `Focus summary must stay compact, got ${cleaned.length} chars`);
assert.equal(rawSummary.includes('## What changed'), true, 'Presentation cleanup must not mutate the source value');

console.log('Focus Now checks passed');
