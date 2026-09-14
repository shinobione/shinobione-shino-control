import assert from 'node:assert/strict';
import { ingestChatgptDelta } from './lib/chatgpt-delta-ingest.mjs';
import { planChatgptCatchup } from './lib/chatgpt-catchup-plan.mjs';
import { repairChatgptProjectOwnership } from './lib/chatgpt-project-ownership.mjs';

const projectKey = 'g-p-matosinformatique000000000000000';
const conversationKey = 'watch-chat';

const poisoned = {
  version:1,
  settings:{
    chatgptProjectMappings:{[projectKey]:'touch'},
    manualMappings:{}
  },
  projects:[
    {id:'touch',name:'TOUCH+ REVIVAL',kind:'CHATGPT_PROJECT'},
    {id:'matos',name:'Matos informatique',kind:'CHATGPT_PROJECT'}
  ],
  sources:[
    {
      id:'src-watch',
      type:'chatgpt_thread',
      externalId:conversationKey,
      projectId:'touch',
      title:'Avis Xiaomi Mi Watch Lite',
      url:`https://chatgpt.com/g/${projectKey}/c/${conversationKey}`,
      chatgptProjectKey:projectKey,
      chatgptProjectTitle:'Matos informatique',
      conversationUpdatedAt:'2026-09-14T15:00:00.000Z',
      collectorFingerprint:'watch-fingerprint',
      inventoryCurrent:true
    }
  ],
  evidence:[
    {
      id:'legacy-watch-evidence',
      projectId:'touch',
      sourceId:'src-watch',
      sourceType:'chatgpt_thread',
      type:'chat_delta',
      timestamp:'2026-09-14T15:00:00.000Z',
      conversationUpdatedAt:'2026-09-14T15:00:00.000Z',
      title:'Avis Xiaomi Mi Watch Lite',
      summary:'Watch advice.',
      currentStateSummary:'Watch advice.',
      resumeAction:'Compare Galaxy Fit 3.',
      confidence:0.9,
      inventoryCurrent:true
    }
  ],
  discovered:[],
  derived:[]
};

const planned = planChatgptCatchup(structuredClone(poisoned), {
  threads:[{
    key:conversationKey,
    title:'Avis Xiaomi Mi Watch Lite',
    projectKey,
    projectTitle:'Matos informatique',
    updatedAt:'2026-09-14T15:00:00.000Z'
  }]
}, {maxPlan:10});
assert.equal(planned.changedCount, 1, 'same timestamp must still refresh when project ownership is wrong');
assert.equal(planned.ownershipMismatches, 1);
assert.equal(planned.plan[0].reason, 'project-ownership-mismatch');
assert.equal(planned.plan[0].expectedProjectId, 'matos');

const repairedState = structuredClone(poisoned);
const repair = repairChatgptProjectOwnership(repairedState);
assert.equal(repair.changed, true);
assert.equal(repair.repairedSources, 1);
assert.equal(repairedState.sources[0].projectId, 'matos');
assert.equal(repairedState.evidence[0].projectId, 'matos');
assert.equal(repairedState.settings.chatgptProjectMappings[projectKey], 'matos');

const ingestState = structuredClone(poisoned);
const result = ingestChatgptDelta(ingestState, {
  conversationKey,
  url:`https://chatgpt.com/g/${projectKey}/c/${conversationKey}`,
  title:'Avis Xiaomi Mi Watch Lite',
  projectKey,
  projectTitle:'Matos informatique',
  messages:[
    {role:'user',text:'Galaxy fit 3'},
    {role:'assistant',text:'NEXT: compare the Galaxy Fit 3 with the Mi Watch Lite.'}
  ],
  messageCount:8,
  fingerprint:'watch-fingerprint',
  conversationUpdatedAt:'2026-09-14T15:00:00.000Z'
});
assert.equal(result.changed, true, 'same fingerprint must not suppress ownership repair');
assert.equal(result.ownershipChanged, true);
assert.equal(result.previousProjectId, 'touch');
assert.equal(result.projectId, 'matos');
assert.equal(result.reason, 'live ChatGPT project title');
assert.equal(ingestState.sources.find(source => source.id === 'src-watch')?.projectId, 'matos');
assert.equal(ingestState.settings.chatgptProjectMappings[projectKey], 'matos');
assert.deepEqual(new Set(ingestState.settings.lastDerivation?.projectIds || []), new Set(['touch','matos']), 'both old and new project must be re-derived');

console.log('ChatGPT project ownership checks PASS');
