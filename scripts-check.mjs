import fs from 'node:fs';
import { deriveAll, deriveProjectState } from './lib/derive.mjs';
import { applyChatgptInventoryMetadata } from './lib/chatgpt-inventory.mjs';

const s = deriveAll(JSON.parse(fs.readFileSync('./data/state.json','utf8')));
for (const d of s.derived) console.log(`${d.projectId.padEnd(18)} ${d.status.padEnd(11)} ${d.confidence.padEnd(6)} ${d.nextAction}`);

const expected = { 'suno-bridge':'NEEDS TEST','shino-os':'NEEDS TEST','studio':'STABLE','french-tranquille':'STABLE','touch-plus':'BLOCKED' };
for (const [id,status] of Object.entries(expected)) {
  const got = s.derived.find(d=>d.projectId===id)?.status;
  if (got !== status) throw new Error(`${id}: expected ${status}, got ${got}`);
}

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

// Regression: v0.7.2 CONTROL state already has the authoritative aggregate inventory totals but
// no per-project list. If 16 mapped API projects account for every inventoried conversation and the
// API says 17 projects total, the sole remaining visible UNSYNCED project is mathematically empty.
const legacyMappings = Object.fromEntries(Array.from({length:16}, (_,i) => [`g-p-legacy-${i}`, `mapped-${i}`]));
const legacyState = {
  settings:{
    chatgptProjectMappings:legacyMappings,
    lastChatgptInventory:{source:'legacy-v072',projectCount:17,conversationCount:2}
  },
  projects:[{id:'lrc-maker',name:'LRC Maker'}],
  sources:[
    {id:'src-a',projectId:'mapped-0',type:'chatgpt_thread',inventoryCurrent:true},
    {id:'src-b',projectId:'mapped-1',type:'chatgpt_thread',inventoryCurrent:true}
  ],
  evidence:[]
};
deriveAll(legacyState);
const legacyEmpty = legacyState.derived.find(d=>d.projectId==='lrc-maker');
if (legacyEmpty?.status !== 'EMPTY') throw new Error(`legacy conservation: expected EMPTY, got ${legacyEmpty?.status}`);
if (legacyEmpty?.confidence !== 'HIGH') throw new Error(`legacy conservation: expected HIGH confidence, got ${legacyEmpty?.confidence}`);

const resume = deriveProjectState(
  {id:'personnel',name:'PERSONNEL',kind:'CHATGPT_PROJECT'},
  [{
    id:'chat-todo', projectId:'personnel', sourceType:'chatgpt_thread', type:'chat_sync',
    timestamp:new Date().toISOString(), title:'Extraction de todo list', summary:'ChatGPT thread synced.', confidence:0.87
  }],
  {inventoryPresent:true,currentChatCount:1}
);
if (!/roadmap PERSONNEL/i.test(resume.nextAction)) throw new Error(`resume engine: unexpected action: ${resume.nextAction}`);

console.log('Derived-state checks PASS');
