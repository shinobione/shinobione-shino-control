import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ingestChatgptDelta } from './lib/chatgpt-delta-ingest.mjs';
import { repairChatgptProjectOwnership } from './lib/chatgpt-project-ownership.mjs';
import { deriveAll } from './lib/derive.mjs';
import { buildPublicSnapshot } from './lib/public-snapshot.mjs';

const manualState = {
  version:1,
  settings:{chatgptProjectMappings:{'project-alpha':'alpha'},manualMappings:{}},
  projects:[
    {id:'alpha',name:'Alpha',kind:'CHATGPT_PROJECT',trackState:true},
    {id:'beta',name:'Beta',kind:'MANUAL_PROJECT',trackState:true}
  ],
  sources:[{
    id:'src-chat-manual',
    projectId:'beta',
    type:'chatgpt_thread',
    externalId:'conv-manual',
    title:'Manual thread',
    chatgptProjectKey:'project-alpha',
    chatgptProjectTitle:'Alpha',
    control:{assignment:'MANUAL',projectId:'beta',detached:false}
  }],
  evidence:[],
  derived:[],
  discovered:[]
};

const repair = repairChatgptProjectOwnership(manualState);
assert.equal(repair.repairedSources,0,'ownership repair must not undo a manual source move');
assert.equal(manualState.sources[0].projectId,'beta');

const ingest = ingestChatgptDelta(manualState,{
  conversationKey:'conv-manual',
  projectKey:'project-alpha',
  projectTitle:'Alpha',
  title:'Manual thread updated',
  url:'https://chatgpt.com/c/conv-manual',
  fingerprint:'fp-manual-2',
  messageCount:2,
  conversationUpdatedAt:'2026-09-21T12:00:00.000Z',
  messages:[
    {role:'user',text:'Continue the Beta work.'},
    {role:'assistant',text:'Next step: run the validation.'}
  ]
});
assert.equal(ingest.projectId,'beta','collector ingest must preserve manual source assignment');
assert.equal(manualState.sources[0].projectId,'beta');
assert.equal(manualState.evidence.find(item=>item.sourceId==='src-chat-manual')?.projectId,'beta');

manualState.sources[0].projectId=null;
manualState.sources[0].control={assignment:'MANUAL',projectId:null,detached:true};
for(const evidence of manualState.evidence.filter(item=>item.sourceId==='src-chat-manual')){
  evidence.projectId=null;
  evidence.controlExcluded=true;
}
const detachedIngest=ingestChatgptDelta(manualState,{
  conversationKey:'conv-manual',
  projectKey:'project-alpha',
  projectTitle:'Alpha',
  title:'Manual thread detached',
  url:'https://chatgpt.com/c/conv-manual',
  fingerprint:'fp-manual-3',
  messageCount:2,
  conversationUpdatedAt:'2026-09-21T12:05:00.000Z',
  messages:[
    {role:'user',text:'This source is intentionally detached.'},
    {role:'assistant',text:'Keep it detached until it is manually reassigned.'}
  ]
});
assert.equal(detachedIngest.detached,true,'detached source must stay detached during collector ingest');
assert.equal(manualState.sources[0].projectId,null);
assert.equal(manualState.discovered.length,0,'manual detach must not bounce back into Discovered');
assert.equal(manualState.evidence.find(item=>item.sourceId==='src-chat-manual')?.controlExcluded,true);

const deriveState={
  version:1,
  settings:{},
  projects:[{id:'p',name:'P',trackState:true}],
  sources:[],
  evidence:[{
    id:'excluded',
    projectId:'p',
    sourceType:'chatgpt_thread',
    timestamp:'2026-09-21T12:00:00.000Z',
    title:'BLOCKED',
    summary:'This would normally be a blocker.',
    confidence:1,
    inventoryCurrent:true,
    controlExcluded:true
  }],
  derived:[],
  discovered:[]
};
deriveAll(deriveState,{force:true});
assert.equal(deriveState.derived[0].status,'UNSYNCED','archived/excluded source evidence must not drive project state');

const snapshotState={
  version:1,
  settings:{},
  projects:[{id:'p',name:'P',trackState:true}],
  sources:[
    {id:'gh-live',projectId:'p',type:'github_repo',title:'owner/live',url:'https://github.com/owner/live'},
    {id:'gh-archived',projectId:'p',type:'github_repo',title:'owner/old',url:'https://github.com/owner/old',control:{archived:true}},
    {id:'chat-archived',projectId:'p',type:'chatgpt_thread',inventoryCurrent:true,control:{archived:true}}
  ],
  evidence:[],
  derived:[{projectId:'p',status:'ACTIVE',summary:'x',nextAction:'y',confidence:'LOW',freshness:'FRESH',evidenceIds:[]}],
  discovered:[]
};
const snapshot=buildPublicSnapshot(snapshotState,{version:'0.11.0',sha:'deadbeef'});
assert.equal(snapshot.sources.some(source=>source.id==='gh-archived'),false,'archived GitHub source leaked into public snapshot');
assert.equal(snapshot.sources.some(source=>source.id==='gh-live'),true,'live GitHub source missing from public snapshot');
assert.equal(snapshot.sources.some(source=>source.type==='chatgpt_thread'),false,'archived ChatGPT source leaked into public snapshot');

const server=fs.readFileSync('server-entry.mjs','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/source-manager.css','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const ownership=fs.readFileSync('lib/chatgpt-project-ownership.mjs','utf8');
const delta=fs.readFileSync('lib/chatgpt-delta-ingest.mjs','utf8');

assert.match(server,/\/api\/sources\/move/);
assert.match(server,/\/api\/sources\/archive/);
assert.match(server,/\/api\/discovered\/assign/);
assert.match(server,/function moveManagedSource/);
assert.match(server,/function archiveManagedSource/);
assert.match(app,/function projectSourcesManager/);
assert.match(app,/data-manager-section="sources"/);
assert.match(app,/data-source-move/);
assert.match(app,/data-source-detach/);
assert.match(app,/data-source-archive/);
assert.match(app,/data-discovered-create/);
assert.match(app,/data-manage-sources/);
assert.match(css,/Source Manager v1/);
assert.match(css,/source-manager-row/);
assert.match(html,/source-manager\.css/);
assert.match(ownership,/source\.control\?\.assignment === 'MANUAL'/);
assert.match(delta,/resolveManualSourceAssignment/);
assert.match(delta,/manual source detachment/);

console.log('source manager checks passed');
