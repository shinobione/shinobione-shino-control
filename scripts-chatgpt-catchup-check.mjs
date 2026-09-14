import assert from 'node:assert/strict';
import { planChatgptCatchup } from './lib/chatgpt-catchup-plan.mjs';

const currentSchema = 2;
const state = {
  sources:[
    {
      id:'src-a',type:'chatgpt_thread',externalId:'a',projectId:'control',
      url:'https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/c/a',
      conversationUpdatedAt:'2026-09-10T10:00:00.000Z',chatgptStateSchemaVersion:currentSchema
    },
    {
      id:'src-b',type:'chatgpt_thread',projectId:'music',
      url:'https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/c/b',
      conversationUpdatedAt:'2026-09-11T10:00:00.000Z',chatgptStateSchemaVersion:currentSchema
    },
    {
      id:'src-old',type:'chatgpt_archived',externalId:'old',projectId:'music',url:'https://chatgpt.com/c/old',
      conversationUpdatedAt:'2026-09-12T10:00:00.000Z',chatgptStateSchemaVersion:currentSchema
    },
    {
      id:'src-observed-only',type:'chatgpt_thread',externalId:'observed-only',projectId:'control',
      url:'https://chatgpt.com/c/observed-only',lastObservedAt:'2026-09-13T23:00:00.000Z',chatgptStateSchemaVersion:currentSchema
    },
    {
      id:'src-schema-old',type:'chatgpt_thread',externalId:'schema-old',projectId:'control',
      url:'https://chatgpt.com/c/schema-old',conversationUpdatedAt:'2026-09-09T10:00:00.000Z'
    }
  ],
  evidence:[
    {
      id:'ev-b',sourceId:'src-b',sourceType:'chatgpt_thread',projectId:'music',
      url:'https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/c/b',
      timestamp:'2026-09-12T12:00:00.000Z',conversationUpdatedAt:'2026-09-12T12:00:00.000Z',inventoryCurrent:true
    }
  ]
};

const before = JSON.stringify(state);
const inventory = {
  threads:[
    {key:'a',title:'A unchanged',updatedAt:'2026-09-10T10:00:00.000Z'},
    {key:'b',title:'B unchanged by evidence',updatedAt:'2026-09-12T12:00:00.000Z'},
    {key:'old',title:'Old became newer',updatedAt:'2026-09-13T10:00:00.000Z'},
    {key:'observed-only',title:'Known but no source-native baseline',updatedAt:'2026-09-13T09:00:00.000Z'},
    {key:'schema-old',title:'Old extractor schema',updatedAt:'2026-09-09T10:00:00.000Z'},
    {key:'new',title:'Brand new',updatedAt:'2026-09-13T11:00:00.000Z',projectKey:'g-p-cccccccccccccccccccccccccccccccc'},
    {key:'new',title:'Brand new latest duplicate',updatedAt:'2026-09-13T12:00:00.000Z',projectKey:'g-p-cccccccccccccccccccccccccccccccc'},
    {key:'no-ts',title:'No timestamp'}
  ]
};

const result = planChatgptCatchup(state, inventory, {maxPlan:10});
assert.equal(result.inventoryCount, 7);
assert.equal(result.known, 5);
assert.equal(result.changedCount, 5, 'old + observed-only + schema-old + new + no-ts should require catch-up');
assert.equal(result.newCount, 2);
assert.equal(result.baselineMissing, 1);
assert.equal(result.stateSchemaUpgrades, 1, 'one stale extractor schema should force a refresh');
assert.equal(result.plan.find(item=>item.key==='schema-old').reason, 'state-schema-upgrade');
assert.equal(result.plan[0].key, 'new');
assert.equal(result.plan.find(item=>item.key==='new').title, 'Brand new latest duplicate');
assert.equal(result.plan.find(item=>item.key==='old').reason, 'remote-newer');
assert.equal(result.plan.find(item=>item.key==='observed-only').reason, 'baseline-missing');
assert.equal(result.plan.some(item=>item.key==='a'), false);
assert.equal(result.plan.some(item=>item.key==='b'), false);
assert.equal(JSON.stringify(state), before, 'planning must remain pure');

const capped = planChatgptCatchup({sources:[],evidence:[]}, {
  threads:Array.from({length:40},(_,i)=>({key:`k-${i}`,updatedAt:`2026-09-13T${String(i%24).padStart(2,'0')}:00:00.000Z`}))
}, {maxPlan:7});
assert.equal(capped.plan.length, 7);
assert.equal(capped.deferredCount, 33);

const inaccessibleState = {
  settings:{
    chatgptInaccessible:{
      locked:{remoteUpdatedAt:'2026-09-14T10:00:00.000Z'},
      changed:{remoteUpdatedAt:'2026-09-14T10:00:00.000Z'}
    }
  },
  sources:[
    {id:'src-locked',type:'chatgpt_thread',externalId:'locked',projectId:'control',conversationUpdatedAt:'2026-09-10T10:00:00.000Z',chatgptStateSchemaVersion:currentSchema},
    {id:'src-changed',type:'chatgpt_thread',externalId:'changed',projectId:'control',conversationUpdatedAt:'2026-09-10T10:00:00.000Z',chatgptStateSchemaVersion:currentSchema}
  ],
  evidence:[]
};
const inaccessibleResult = planChatgptCatchup(inaccessibleState, {threads:[
  {key:'locked',title:'Still inaccessible',updatedAt:'2026-09-14T10:00:00.000Z'},
  {key:'changed',title:'Remote changed after inaccessible mark',updatedAt:'2026-09-14T11:00:00.000Z'}
]}, {maxPlan:10});
assert.equal(inaccessibleResult.inaccessibleCount, 1, 'unchanged inaccessible threads should be excluded from retries');
assert.equal(inaccessibleResult.plan.some(item=>item.key==='locked'), false);
assert.equal(inaccessibleResult.plan.some(item=>item.key==='changed'), true, 'a remote update must make an inaccessible thread retryable again');

console.log('ChatGPT targeted catch-up checks passed');
