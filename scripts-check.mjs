import fs from 'node:fs';
import { deriveAll, deriveProjectState } from './lib/derive.mjs';

const s = deriveAll(JSON.parse(fs.readFileSync('./data/state.json','utf8')));
for (const d of s.derived) console.log(`${d.projectId.padEnd(18)} ${d.status.padEnd(11)} ${d.confidence.padEnd(6)} ${d.nextAction}`);

const expected = { 'suno-bridge':'NEEDS TEST','shino-os':'NEEDS TEST','studio':'STABLE','french-tranquille':'STABLE','touch-plus':'BLOCKED' };
for (const [id,status] of Object.entries(expected)) {
  const got = s.derived.find(d=>d.projectId===id)?.status;
  if (got !== status) throw new Error(`${id}: expected ${status}, got ${got}`);
}

const emptyState = deriveAll({
  settings:{chatgptProjectMappings:{'g-p-empty':'empty-project'}},
  projects:[{id:'empty-project',name:'Empty project'}],
  sources:[],
  evidence:[]
});
const empty = emptyState.derived.find(d=>d.projectId==='empty-project');
if (empty?.status !== 'EMPTY') throw new Error(`empty-project: expected EMPTY, got ${empty?.status}`);
if (!/aucune conversation/i.test(empty.summary)) throw new Error('empty-project: missing explicit empty summary');

const resume = deriveProjectState(
  {id:'personnel',name:'PERSONNEL',kind:'CHATGPT_PROJECT'},
  [{
    id:'chat-todo', projectId:'personnel', sourceType:'chatgpt_thread', type:'chat_sync',
    timestamp:new Date().toISOString(), title:'Extraction de todo list', summary:'ChatGPT thread synced.', confidence:0.87
  }],
  {chatgptMapped:true,currentChatCount:1}
);
if (!/roadmap PERSONNEL/i.test(resume.nextAction)) throw new Error(`resume engine: unexpected action: ${resume.nextAction}`);

console.log('Derived-state checks PASS');
