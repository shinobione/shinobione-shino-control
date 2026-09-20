import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveAll } from './lib/derive.mjs';
import { buildPublicSnapshot } from './lib/public-snapshot.mjs';

const state = {
  version:1,
  settings:{},
  projects:[{
    id:'manual-test',
    name:'Manual test',
    universe:'DEV',
    kind:'MANUAL_PROJECT',
    trackState:true,
    control:{
      group:'Lab',
      note:'PRIVATE NOTE MUST NOT LEAK',
      tags:['test','manual'],
      statusOverride:'BLOCKED',
      pinned:true,
      archived:false
    }
  }],
  sources:[],
  evidence:[],
  derived:[],
  discovered:[]
};

deriveAll(state, {force:true});
assert.equal(state.derived.length, 1, 'manual project must receive a derived state');
assert.equal(state.derived[0].status, 'BLOCKED', 'manual status override must win');
assert.equal(state.derived[0].autoStatus, 'UNSYNCED', 'source-derived status must remain available');
assert.equal(state.derived[0].statusSource, 'manual_override');

state.projects[0].control.statusOverride = 'STABLE';
deriveAll(state);
assert.equal(state.derived[0].status, 'STABLE', 'changing manual status must invalidate derivation cache');
assert.equal(state.derived[0].autoStatus, 'UNSYNCED');

state.projects[0].control.archived = true;
deriveAll(state, {dirtyProjectIds:['manual-test']});
assert.equal(state.derived[0].status, 'STABLE', 'archiving must preserve project truth/state');

const snapshot = buildPublicSnapshot(state, {version:'0.10.0', sha:'deadbeef'});
assert.equal(snapshot.projects[0].control.archived, true, 'public snapshot should preserve archive presentation state');
assert.equal(snapshot.projects[0].control.pinned, true, 'public snapshot should preserve pin presentation state');
assert.equal('note' in (snapshot.projects[0].control || {}), false, 'private notes must never leak into public snapshot');
assert.equal(JSON.stringify(snapshot).includes('PRIVATE NOTE MUST NOT LEAK'), false, 'private project note leaked');

const server = fs.readFileSync('server-entry.mjs','utf8');
const app = fs.readFileSync('public/app.js','utf8');
const css = fs.readFileSync('public/project-manager.css','utf8');
const html = fs.readFileSync('public/index.html','utf8');

assert.match(server, /\/api\/projects\/update/);
assert.match(server, /\/api\/projects\/create/);
assert.match(server, /normalizedManagedControl/);
assert.match(app, /function projectManagerModal/);
assert.match(app, /function groupedProjectsPanel/);
assert.match(app, /data-manage-project/);
assert.match(app, /projectArchived/);
assert.match(app, /Note personnelle/);
assert.match(css, /Project Management Layer v1/);
assert.match(css, /project-manager-overlay/);
assert.match(html, /project-manager\.css/);

console.log('project management checks passed');
