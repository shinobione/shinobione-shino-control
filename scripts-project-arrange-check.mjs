import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPublicSnapshot } from './lib/public-snapshot.mjs';

const app=fs.readFileSync('public/app.js','utf8');
const server=fs.readFileSync('server-entry.mjs','utf8');
const managerCss=fs.readFileSync('public/project-manager.css','utf8');
const dragCss=fs.readFileSync('public/drag-drop.css','utf8');

assert.match(server,/\/api\/projects\/bulk/,'bulk project endpoint missing');
assert.match(server,/\/api\/projects\/reorder/,'project reorder endpoint missing');
assert.match(server,/function bulkUpdateManagedProjects/,'bulk project handler missing');
assert.match(server,/function reorderManagedProjects/,'project reorder handler missing');
assert.match(server,/order:\(index \+ 1\) \* 100/,'stable manual ordering is not persisted');

assert.match(app,/selectedProjectIds=new Set\(\)/,'bulk selection state missing');
assert.match(app,/function sortProjectsUserFirst/,'manual ordering sort helper missing');
assert.match(app,/function bulkManagedProjectPatch/,'bulk project client missing');
assert.match(app,/function reorderManagedProject/,'reorder client missing');
assert.match(app,/data-bulk-project/,'manager project selection missing');
assert.match(app,/data-bulk-status/,'bulk status control missing');
assert.match(app,/data-bulk-group/,'bulk group control missing');
assert.match(app,/data-bulk-pin/,'bulk pin control missing');
assert.match(app,/data-bulk-archive/,'bulk archive control missing');
assert.match(app,/data-drop-project-order/,'precise project reorder targets missing');
assert.match(app,/function setUndo/,'undo helper missing');
assert.match(app,/Annuler/,'undo affordance missing');

assert.match(managerCss,/v0\.13\.0 — bulk project control/,'bulk manager styles missing');
assert.match(managerCss,/manager-bulk-panel/,'bulk toolbar styles missing');
assert.match(dragCss,/v0\.13\.0 — precise reorder targets/,'reorder target styles missing');
assert.match(dragCss,/INSÉRER AVANT/,'precise reorder feedback missing');

const snapshot=buildPublicSnapshot({
  version:1,
  settings:{lastChatgptInventory:{}},
  projects:[{
    id:'p',
    name:'Project',
    universe:'DEV',
    control:{
      group:'Music',
      tags:['audio','priority'],
      order:200,
      pinned:true,
      archived:false,
      note:'PRIVATE'
    }
  }],
  sources:[],
  evidence:[],
  derived:[{
    projectId:'p',status:'ACTIVE',summary:'ok',nextAction:'go',
    confidence:'HIGH',freshness:'FRESH',evidenceIds:[]
  }]
},{version:'0.13.0',sha:'deadbeef'});

assert.equal(snapshot.projects[0].control.group,'Music','project group missing from public presentation state');
assert.deepEqual(snapshot.projects[0].control.tags,['audio','priority'],'project tags missing from public presentation state');
assert.equal(snapshot.projects[0].control.order,200,'manual project order missing from public presentation state');
assert.equal(snapshot.projects[0].control.pinned,true,'pin state missing from public presentation state');
assert.equal('note' in snapshot.projects[0].control,false,'private note leaked into public snapshot');

console.log('project arrange/bulk/undo checks passed');
