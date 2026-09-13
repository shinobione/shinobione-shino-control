import assert from 'node:assert/strict';
import { planChatgptCatchup } from './lib/chatgpt-catchup-plan.mjs';

const state = {
  sources:[
    {
      id:'src-a',
      type:'chatgpt_thread',
      externalId:'a',
      projectId:'control',
      url:'https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/c/a',
      conversationUpdatedAt:'2026-09-10T10:00:00.000Z'
    },
    {
      id:'src-b',
      type:'chatgpt_thread',
      projectId:'music',
      url:'https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/c/b',
      conversationUpdatedAt:'2026-09-11T10:00:00.000Z'
    },
    {
      id:'src-old',
      type:'chatgpt_archived',
      externalId:'old',
      projectId:'music',
      url:'https://chatgpt.com/c/old',
      conversationUpdatedAt:'2026-09-12T10:00:00.000Z'
    }
  ],
  evidence:[
    {
      id:'ev-b',
      sourceId:'src-b',
      sourceType:'chatgpt_thread',
      projectId:'music',
      url:'https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/c/b',
      timestamp:'2026-09-12T12:00:00.000Z',
      conversationUpdatedAt:'2026-09-12T12:00:00.000Z',
      inventoryCurrent:true
    }
  ]
};

const before = JSON.stringify(state);
const inventory = {
  threads:[
    {key:'a',title:'A unchanged',updatedAt:'2026-09-10T10:00:00.000Z'},
    {key:'b',title:'B unchanged by evidence',updatedAt:'2026-09-12T12:00:00.000Z'},
    {key:'old',title:'Old became newer',updatedAt:'2026-09-13T10:00:00.000Z'},
    {key:'new',title:'Brand new',updatedAt:'2026-09-13T11:00:00.000Z',projectKey:'g-p-cccccccccccccccccccccccccccccccc'},
    {key:'new',title:'Brand new latest duplicate',updatedAt:'2026-09-13T12:00:00.000Z',projectKey:'g-p-cccccccccccccccccccccccccccccccc'},
    {key:'no-ts',title:'No timestamp'}
  ]
};

const result = planChatgptCatchup(state, inventory, {maxPlan:10});
assert.equal(result.inventoryCount, 5);
assert.equal(result.known, 3);
assert.equal(result.changedCount, 3, 'old + new + no-ts missing source should require catch-up');
assert.equal(result.newCount, 2, 'new and no-ts are both unseen conversations');
assert.equal(result.plan[0].key, 'new', 'newest changed conversation should be first');
assert.equal(result.plan.find(item=>item.key==='new').title, 'Brand new latest duplicate');
assert.equal(result.plan.find(item=>item.key==='old').reason, 'remote-newer');
assert.equal(result.plan.some(item=>item.key==='a'), false, 'matching timestamp should not refresh');
assert.equal(result.plan.some(item=>item.key==='b'), false, 'evidence timestamp should prevent stale source metadata from triggering a refresh');
assert.equal(JSON.stringify(state), before, 'planning must be pure and must not mutate CONTROL state');

const capped = planChatgptCatchup({sources:[],evidence:[]}, {
  threads:Array.from({length:40},(_,i)=>({key:`k-${i}`,updatedAt:`2026-09-13T${String(i%24).padStart(2,'0')}:00:00.000Z`}))
}, {maxPlan:7});
assert.equal(capped.plan.length, 7);
assert.equal(capped.deferredCount, 33);

console.log('ChatGPT targeted catch-up checks passed');
