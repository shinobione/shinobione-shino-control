import { deriveAll, DERIVATION_ENGINE_VERSION } from './lib/derive.mjs';

const now = new Date().toISOString();
const state = {
  version:1,
  settings:{
    chatgptProjectMappings:{'project-a':'a','project-b':'b'},
    lastChatgptInventory:{
      source:'fixture', observedAt:now, projectCount:2, conversationCount:2,
      projects:[
        {key:'project-a',title:'A',conversationCount:1},
        {key:'project-b',title:'B',conversationCount:1}
      ]
    }
  },
  projects:[
    {id:'a',name:'A',kind:'CHATGPT_PROJECT'},
    {id:'b',name:'B',kind:'CHATGPT_PROJECT'}
  ],
  sources:[
    {id:'src-a',projectId:'a',type:'chatgpt_thread',inventoryCurrent:true,externalId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',chatgptProjectKey:'project-a'},
    {id:'src-b',projectId:'b',type:'chatgpt_thread',inventoryCurrent:true,externalId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',chatgptProjectKey:'project-b'}
  ],
  evidence:[
    {
      id:'ev-a',sourceId:'src-a',projectId:'a',sourceType:'chatgpt_thread',type:'chat_sync',timestamp:now,
      title:'A work',summary:'NEXT: implement A.',currentStateSummary:'A is active.',resumeAction:'NEXT: implement A.',confidence:0.87
    },
    {
      id:'ev-b',sourceId:'src-b',projectId:'b',sourceType:'chatgpt_thread',type:'chat_sync',timestamp:now,
      title:'B work',summary:'NEXT: implement B.',currentStateSummary:'B is active.',resumeAction:'NEXT: implement B.',confidence:0.87
    }
  ],
  derived:[]
};

deriveAll(state,{force:true});
if (state.settings.derivationCache?.version !== DERIVATION_ENGINE_VERSION) throw new Error('cache version not persisted');
if (state.settings.lastDerivation?.recalculated !== 2) throw new Error(`initial full derive expected 2, got ${state.settings.lastDerivation?.recalculated}`);
if (state.settings.lastDerivation?.reused !== 0) throw new Error(`initial full derive expected 0 reused, got ${state.settings.lastDerivation?.reused}`);
const aFirst = state.derived.find(item=>item.projectId==='a');
const bFirst = state.derived.find(item=>item.projectId==='b');
const firstGlobalDerivedAt = state.derivedAt;

// An unchanged read must reuse every card and must not move the global derivedAt timestamp.
deriveAll(state);
if (state.settings.lastDerivation?.recalculated !== 0) throw new Error(`unchanged state should recalc 0, got ${state.settings.lastDerivation?.recalculated}`);
if (state.settings.lastDerivation?.reused !== 2) throw new Error(`unchanged state should reuse 2, got ${state.settings.lastDerivation?.reused}`);
if (state.derivedAt !== firstGlobalDerivedAt) throw new Error('unchanged state unexpectedly changed derivedAt');
if (state.derived.find(item=>item.projectId==='a')?.derivedAt !== aFirst.derivedAt) throw new Error('project A derivedAt changed on cache hit');
if (state.derived.find(item=>item.projectId==='b')?.derivedAt !== bFirst.derivedAt) throw new Error('project B derivedAt changed on cache hit');

// Change only A: only A may be recalculated, B must be reused bit-for-bit.
state.evidence.find(item=>item.id==='ev-a').resumeAction = 'NEXT: validate A output.';
state.evidence.find(item=>item.id==='ev-a').summary = 'NEXT: validate A output.';
deriveAll(state);
if (state.settings.lastDerivation?.recalculated !== 1) throw new Error(`single-project change expected 1 recalculation, got ${state.settings.lastDerivation?.recalculated}`);
if (state.settings.lastDerivation?.reused !== 1) throw new Error(`single-project change expected 1 reuse, got ${state.settings.lastDerivation?.reused}`);
if (state.settings.lastDerivation?.projectIds?.join(',') !== 'a') throw new Error(`expected only A dirty, got ${state.settings.lastDerivation?.projectIds}`);
if (!/validate A output/i.test(state.derived.find(item=>item.projectId==='a')?.nextAction || '')) throw new Error('A did not pick up changed evidence');
if (state.derived.find(item=>item.projectId==='b')?.derivedAt !== bFirst.derivedAt) throw new Error('B was recalculated even though only A changed');

// Explicit dirtiness is available to future incremental collectors even when content fingerprints
// happen to remain equal (for example after a source-specific policy/version change).
deriveAll(state,{dirtyProjectIds:['b']});
if (state.settings.lastDerivation?.recalculated !== 1) throw new Error(`explicit dirty B expected 1 recalculation, got ${state.settings.lastDerivation?.recalculated}`);
if (state.settings.lastDerivation?.projectIds?.join(',') !== 'b') throw new Error(`explicit dirty expected B, got ${state.settings.lastDerivation?.projectIds}`);
if (state.settings.lastDerivation?.mode !== 'dirty') throw new Error(`explicit dirty expected dirty mode, got ${state.settings.lastDerivation?.mode}`);

// Legacy 17/131-style inventories only carry global totals. Once conservation proves the sole empty
// project, that proof must become a stable fingerprint input; otherwise the empty card would churn
// UNSYNCED -> EMPTY on every dashboard read and defeat incremental derivation.
const legacy = {
  version:1,
  settings:{
    chatgptProjectMappings:{'legacy-current':'active'},
    lastChatgptInventory:{source:'legacy',projectCount:2,conversationCount:1}
  },
  projects:[
    {id:'active',name:'Active',kind:'CHATGPT_PROJECT'},
    {id:'empty',name:'Empty',kind:'CHATGPT_PROJECT'}
  ],
  sources:[
    {id:'legacy-src',projectId:'active',type:'chatgpt_thread',inventoryCurrent:true,externalId:'cccccccc-cccc-cccc-cccc-cccccccccccc',chatgptProjectKey:'legacy-current'}
  ],
  evidence:[
    {id:'legacy-ev',sourceId:'legacy-src',projectId:'active',sourceType:'chatgpt_thread',type:'chat_sync',timestamp:now,title:'Active work',summary:'NEXT: continue.',resumeAction:'NEXT: continue.',confidence:0.87}
  ],
  derived:[]
};
deriveAll(legacy,{force:true});
if (legacy.derived.find(item=>item.projectId==='empty')?.status !== 'EMPTY') throw new Error('legacy conservation did not prove sole empty project');
deriveAll(legacy);
if (legacy.settings.lastDerivation?.recalculated !== 0) throw new Error(`legacy empty cache should be stable on second pass, got ${legacy.settings.lastDerivation?.recalculated} recalculations`);
if (legacy.settings.lastDerivation?.reused !== 2) throw new Error(`legacy empty cache should reuse 2 projects, got ${legacy.settings.lastDerivation?.reused}`);

console.log('Dirty-project derivation checks PASS');
