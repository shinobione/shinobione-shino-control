import fs from 'node:fs';
import { deriveAll, deriveProjectState } from './lib/derive.mjs';
import { applyChatgptInventoryMetadata } from './lib/chatgpt-inventory.mjs';

const live = deriveAll(JSON.parse(fs.readFileSync('./data/state.json','utf8')));
for (const d of live.derived) console.log(`${d.projectId.padEnd(18)} ${d.status.padEnd(11)} ${d.confidence.padEnd(6)} ${d.nextAction}`);

function expectStatus(projectId, expectedStatus, evidence) {
  const derived = deriveProjectState({id:projectId,name:projectId}, evidence, {inventoryPresent:true,currentChatCount:1});
  if (derived.status !== expectedStatus) throw new Error(`${projectId}: expected ${expectedStatus}, got ${derived.status}`);
}

const now = new Date().toISOString();
expectStatus('fixture-needs-test','NEEDS TEST',[{
  id:'e1',projectId:'fixture-needs-test',sourceType:'github_pr',timestamp:now,
  title:'Physical gate pending',summary:'Real hardware validation remains pending.',confidence:0.99,
  derivedStatusHint:'NEEDS TEST'
}]);
expectStatus('fixture-blocked','BLOCKED',[{
  id:'e2',projectId:'fixture-blocked',sourceType:'github_pr',timestamp:now,
  title:'Unresolved physical gate',summary:'Hardware acceptance is still blocked.',confidence:0.99,
  derivedStatusHint:'BLOCKED'
}]);
expectStatus('fixture-stable','STABLE',[{
  id:'e3',projectId:'fixture-stable',sourceType:'github_pr',timestamp:now,
  title:'Program closeout complete',summary:'Accepted and complete.',confidence:0.99,
  derivedStatusHint:'STABLE'
}]);

const gateState = deriveProjectState({id:'fixture-gate',name:'fixture-gate'},[
  {
    id:'newer',projectId:'fixture-gate',sourceType:'github_commit',timestamp:new Date().toISOString(),
    title:'Complete unrelated cleanup',summary:'Green build.',confidence:0.92
  },
  {
    id:'gate',projectId:'fixture-gate',sourceType:'github_pr',timestamp:new Date(Date.now()-86400000).toISOString(),
    title:'Physical gate pending',summary:'Real hardware validation still needed.',confidence:0.99,
    derivedStatusHint:'NEEDS TEST'
  }
],{inventoryPresent:true,currentChatCount:1});
if (gateState.status !== 'NEEDS TEST') throw new Error(`authoritative hint precedence: expected NEEDS TEST, got ${gateState.status}`);

const emptyState = {
  settings:{chatgptProjectMappings:{}},
  projects:[{id:'lrc-maker',name:'LRC Maker'}],
  sources:[],
  evidence:[]
};
const metadata = applyChatgptInventoryMetadata(emptyState, {
  source:'test-project-api',
  projectCount:1,
  projects:[{key:'g-p-lrc-maker-test',title:'LRC Maker',conversationCount:0}],
  threads:[]
});
deriveAll(emptyState);
const empty = emptyState.derived.find(d=>d.projectId==='lrc-maker');
if (metadata.projects !== 1) throw new Error(`empty-project metadata: expected 1 project, got ${metadata.projects}`);
if (emptyState.settings.chatgptProjectMappings['g-p-lrc-maker-test'] !== 'lrc-maker') throw new Error('empty-project: exact API title did not create project-key mapping');
if (empty?.status !== 'EMPTY') throw new Error(`empty-project: expected EMPTY, got ${empty?.status}`);
if (!/aucune conversation/i.test(empty.summary)) throw new Error('empty-project: missing explicit empty summary');

// Legacy v0.7.2 regression matching the real state class: 17 API projects, 16 distinct current
// project keys, all API conversations represented, plus one extra current source row that is not a
// distinct API conversation. Raw source count must not prevent the sole no-thread project being EMPTY.
const legacyMappings = Object.fromEntries(Array.from({length:19}, (_,i) => [`g-p-stale-or-current-${i}`, `mapped-${i}`]));
const legacySources = Array.from({length:16}, (_,i) => ({
  id:`src-${i}`,
  projectId:`mapped-${i}`,
  type:'chatgpt_thread',
  inventoryCurrent:true,
  chatgptProjectKey:`g-p-current-${i}`,
  url:`https://chatgpt.com/c/conversation-${i}`
}));
legacySources.push({
  id:'src-extra-unkeyed-row',
  projectId:'mapped-0',
  type:'chatgpt_thread',
  inventoryCurrent:true,
  chatgptProjectKey:'g-p-current-0'
});
const legacyState = {
  settings:{
    chatgptProjectMappings:legacyMappings,
    lastChatgptInventory:{source:'legacy-v072',projectCount:17,conversationCount:16}
  },
  projects:[...Array.from({length:16},(_,i)=>({id:`mapped-${i}`,name:`Mapped ${i}`})),{id:'lrc-maker',name:'LRC Maker'}],
  sources:legacySources,
  evidence:legacySources.map((s,i)=>({
    id:`ev-${i}`,projectId:s.projectId,sourceType:'chatgpt_thread',timestamp:now,title:`Chat ${i}`,summary:'Synced',confidence:0.87
  }))
};
deriveAll(legacyState);
const legacyEmpty = legacyState.derived.find(d=>d.projectId==='lrc-maker');
if (legacyEmpty?.status !== 'EMPTY') throw new Error(`legacy conservation: expected EMPTY, got ${legacyEmpty?.status}`);
if (legacyEmpty?.confidence !== 'HIGH') throw new Error(`legacy conservation: expected HIGH confidence, got ${legacyEmpty?.confidence}`);

const resume = deriveProjectState(
  {id:'personnel',name:'PERSONNEL',kind:'CHATGPT_PROJECT'},
  [{
    id:'chat-todo', projectId:'personnel', sourceType:'chatgpt_thread', type:'chat_sync',
    timestamp:now, title:'Extraction de todo list', summary:'ChatGPT thread synced.', confidence:0.87
  }],
  {inventoryPresent:true,currentChatCount:1}
);
if (!/roadmap PERSONNEL/i.test(resume.nextAction)) throw new Error(`resume engine: unexpected action: ${resume.nextAction}`);

console.log('Derived-state checks PASS');
