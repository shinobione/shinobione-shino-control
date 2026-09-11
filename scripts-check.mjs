import fs from 'node:fs';
import { deriveAll, deriveProjectState } from './lib/derive.mjs';
import { applyChatgptInventoryMetadata } from './lib/chatgpt-inventory.mjs';

// Print the user's/live state for visibility, but do not assert mutable project statuses against it.
// Regression assertions below use deterministic fixtures so `npm run check` remains valid on a live
// CONTROL state that has newer GitHub/chat evidence than the repository seed data.
const live = deriveAll(JSON.parse(fs.readFileSync('./data/state.json','utf8')));
for (const d of live.derived) console.log(`${d.projectId.padEnd(18)} ${d.status.padEnd(11)} ${d.confidence.padEnd(6)} ${d.nextAction}`);

function expectStatus(projectId, expectedStatus, evidence) {
  const derived = deriveProjectState(
    {id:projectId,name:projectId},
    evidence,
    {inventoryPresent:true,currentChatCount:1}
  );
  if (derived.status !== expectedStatus) {
    throw new Error(`${projectId}: expected ${expectedStatus}, got ${derived.status}`);
  }
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

// Regression: an explicit unresolved structured hint must beat a newer unrelated generic positive
// commit. This is the SHINO-OS / TOUCH+ class of bug that previously produced false STABLE states.
const gateProject = {id:'fixture-gate',name:'fixture-gate'};
const gateState = deriveProjectState(gateProject,[
  {
    id:'newer',projectId:'fixture-gate',sourceType:'github_commit',timestamp:new Date(Date.now()).toISOString(),
    title:'Complete unrelated cleanup',summary:'Green build.',confidence:0.92
  },
  {
    id:'gate',projectId:'fixture-gate',sourceType:'github_pr',timestamp:new Date(Date.now()-86400000).toISOString(),
    title:'Physical gate pending',summary:'Real hardware validation still needed.',confidence:0.99,
    derivedStatusHint:'NEEDS TEST'
  }
],{inventoryPresent:true,currentChatCount:1});
if (gateState.status !== 'NEEDS TEST') throw new Error(`authoritative hint precedence: expected NEEDS TEST, got ${gateState.status}`);

// Regression: a zero-conversation ChatGPT project has no thread row from which CONTROL can learn
// its existence. The authoritative project list must create the exact project-key mapping and
// derive EMPTY without any conversation ingest.
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

// Regression: legacy v0.7.2 state has only aggregate API totals. Current thread sources carry 16
// distinct real project keys and account for every inventoried conversation; stale remembered mapping
// keys are deliberately present and must NOT break the conservation proof for the sole empty project.
const legacyMappings = Object.fromEntries(Array.from({length:19}, (_,i) => [`g-p-stale-or-current-${i}`, `mapped-${i}`]));
const legacySources = Array.from({length:16}, (_,i) => ({
  id:`src-${i}`,
  projectId:`mapped-${i}`,
  type:'chatgpt_thread',
  inventoryCurrent:true,
  chatgptProjectKey:`g-p-current-${i}`
}));
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
