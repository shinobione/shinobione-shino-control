import { deriveAll } from './lib/derive.mjs';
import { ingestChatgptDelta } from './lib/chatgpt-delta-ingest.mjs';

const old = '2026-09-13T12:00:00.000Z';
const state = {
  version:1,
  settings:{
    chatgptProjectMappings:{
      'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa':'music',
      'g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb':'control'
    },
    lastChatgptInventory:{
      source:'fixture',
      projectCount:2,
      conversationCount:2,
      projects:[
        {key:'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',title:'Music',conversationCount:1},
        {key:'g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',title:'SHINO // CONTROL',conversationCount:1}
      ]
    }
  },
  projects:[
    {id:'music',name:'SHINOBIWAN Music',kind:'CHATGPT_PROJECT'},
    {id:'control',name:'SHINO // CONTROL',kind:'APP'}
  ],
  sources:[
    {
      id:'src-old-music',projectId:'music',type:'chatgpt_thread',externalId:'11111111-1111-1111-1111-111111111111',
      chatgptProjectKey:'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',inventoryCurrent:true,lastObservedAt:old
    },
    {
      id:'src-control',projectId:'control',type:'chatgpt_thread',externalId:'22222222-2222-2222-2222-222222222222',
      chatgptProjectKey:'g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',inventoryCurrent:true,lastObservedAt:old
    }
  ],
  evidence:[
    {
      id:'old-music',projectId:'music',sourceId:'src-old-music',sourceType:'chatgpt_thread',type:'chat_sync',timestamp:old,
      title:'Old music work',summary:'NEXT: continue old music work.',currentStateSummary:'Old state.',resumeAction:'Continue old music work.',confidence:0.9
    },
    {
      id:'old-control',projectId:'control',sourceId:'src-control',sourceType:'chatgpt_thread',type:'chat_sync',timestamp:old,
      title:'Old CONTROL work',summary:'NEXT: continue CONTROL.',currentStateSummary:'Old CONTROL state.',resumeAction:'Continue CONTROL.',confidence:0.9
    }
  ],
  discovered:[],
  derived:[]
};

deriveAll(state,{force:true});
const controlDerivedAt = state.derived.find(item => item.projectId === 'control')?.derivedAt;

const payload = {
  conversationKey:'11111111-1111-1111-1111-111111111111',
  url:'https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/c/11111111-1111-1111-1111-111111111111',
  title:'Music — next banger',
  projectKey:'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  projectTitle:'Music',
  projectUrl:'https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  messages:[
    {role:'user',text:'We validated the current track. What next?'},
    {role:'assistant',text:'NEXT: build the final SoundCloud pack and verify the cover crop.'}
  ],
  messageCount:42,
  fingerprint:'fixture-fingerprint-1',
  conversationUpdatedAt:'2026-09-13T18:00:00.000Z',
  clientTimestamp:'2026-09-13T18:00:01.000Z'
};

const first = ingestChatgptDelta(state,payload);
if (!first.changed || !first.mapped || first.projectId !== 'music') throw new Error(`first delta not mapped to music: ${JSON.stringify(first)}`);
if (state.settings.lastDerivation?.recalculated !== 1) throw new Error(`delta should derive exactly one project, got ${state.settings.lastDerivation?.recalculated}`);
if (state.settings.lastDerivation?.projectIds?.join(',') !== 'music') throw new Error(`delta dirtied wrong projects: ${state.settings.lastDerivation?.projectIds}`);
if (state.derived.find(item => item.projectId === 'control')?.derivedAt !== controlDerivedAt) throw new Error('CONTROL card was recalculated by a Music delta');

const current = state.evidence.find(item => item.id === first.evidenceId);
if (!current || current.type !== 'chat_delta') throw new Error('stable current ChatGPT evidence missing');
if (!/SoundCloud pack/i.test(current.resumeAction || '')) throw new Error(`resume action did not use latest delta: ${current.resumeAction}`);
if ('messages' in current || 'transcript' in current) throw new Error('raw ChatGPT message payload leaked into evidence');
const musicSource = state.sources.find(item => item.id === first.sourceId);
if ('messages' in musicSource || 'transcript' in musicSource) throw new Error('raw ChatGPT message payload leaked into source');

const beforeNoop = JSON.stringify(state);
const second = ingestChatgptDelta(state,payload);
if (!second.skipped || second.changed !== false) throw new Error(`identical fingerprint was not skipped: ${JSON.stringify(second)}`);
if (JSON.stringify(state) !== beforeNoop) throw new Error('no-change ChatGPT delta mutated CONTROL state');

const third = ingestChatgptDelta(state,{
  ...payload,
  fingerprint:'fixture-fingerprint-2',
  conversationUpdatedAt:'2026-09-13T18:05:00.000Z',
  messages:[
    ...payload.messages,
    {role:'user',text:'Pack done.'},
    {role:'assistant',text:'NEXT: upload the final master and verify delivery status.'}
  ],
  messageCount:44
});
if (!third.changed || third.projectId !== 'music') throw new Error('changed fingerprint did not update Music');
if (state.evidence.filter(item => item.id === first.evidenceId).length !== 1) throw new Error('delta created duplicate current evidence');
if (!/upload the final master/i.test(state.evidence.find(item => item.id === first.evidenceId)?.resumeAction || '')) throw new Error('stable evidence was not updated in place');
if (state.settings.lastDerivation?.recalculated !== 1 || state.settings.lastDerivation?.projectIds?.join(',') !== 'music') throw new Error('changed delta did not remain project-local');

// Real-world regression from the first live Collector run: assistant verification prose contained
// a PowerShell block. Commands and state-dump plumbing must never become the Resume action.
const noisy = ingestChatgptDelta(state,{
  ...payload,
  fingerprint:'fixture-fingerprint-noise',
  conversationUpdatedAt:'2026-09-13T18:10:00.000Z',
  messages:[
    {role:'user',text:'collector test'},
    {role:'assistant',text:[
      'Parfait — le message test est parti. Maintenant il faut vérifier ce qui s’est passé.',
      '```powershell',
      '$root = "F:\\Google Drive\\Musique STUFF\\shino-control\\shino-control-live"',
      '$s = Get-Content "$root\\data\\state.json" -Raw | ConvertFrom-Json',
      'Write-Host "=== COLLECTOR ===" -ForegroundColor Cyan',
      '$s.settings.lastChatgptCollector | Format-List',
      '```',
      'Ensuite on fera le test no-op final.'
    ].join('\n')}
  ],
  messageCount:46
});
if (!noisy.changed || noisy.projectId !== 'music') throw new Error('noise fixture did not update mapped project');
const noisyEvidence = state.evidence.find(item => item.id === first.evidenceId);
if (!/test no-op final/i.test(noisyEvidence?.resumeAction || '')) throw new Error(`natural next action was not retained: ${noisyEvidence?.resumeAction}`);
if (/(Write-Host|Get-Content|ConvertFrom-Json|Format-List|PowerShell|\\data\\state\.json)/i.test(`${noisyEvidence?.resumeAction || ''} ${noisyEvidence?.summary || ''}`)) {
  throw new Error(`PowerShell/code noise leaked into derived evidence: ${noisyEvidence?.resumeAction}`);
}

const unknown = ingestChatgptDelta(state,{
  conversationKey:'33333333-3333-3333-3333-333333333333',
  url:'https://chatgpt.com/c/33333333-3333-3333-3333-333333333333',
  title:'Completely unrelated scratch chat qzxv',
  projectKey:null,
  projectTitle:null,
  messages:[{role:'user',text:'hello qzxv'}, {role:'assistant',text:'hello'}],
  messageCount:2,
  fingerprint:'unknown-fixture'
});
if (unknown.mapped !== false || !unknown.discovered) throw new Error(`unknown chat should be discovered, not guessed: ${JSON.stringify(unknown)}`);
if (!state.discovered.some(item => item.id === unknown.discoveredId)) throw new Error('unknown conversation missing from discovered queue');

const newProjectKey = 'g-p-cccccccccccccccccccccccccccccccc';
const newProject = ingestChatgptDelta(state,{
  conversationKey:'44444444-4444-4444-4444-444444444444',
  url:`https://chatgpt.com/g/${newProjectKey}/c/44444444-4444-4444-4444-444444444444`,
  title:'Génération vidéo Kling MiniMax',
  projectKey:newProjectKey,
  projectTitle:'NiceHash',
  projectUrl:`https://chatgpt.com/g/${newProjectKey}`,
  messages:[
    {role:'user',text:'Create a new project conversation.'},
    {role:'assistant',text:'NEXT: continue the NiceHash video workflow.'}
  ],
  messageCount:2,
  fingerprint:'new-project-fixture',
  conversationUpdatedAt:'2026-09-18T19:30:00.000Z'
});
if (!newProject.mapped || !newProject.changed || !newProject.projectCreated) {
  throw new Error(`new ChatGPT project was not auto-created: ${JSON.stringify(newProject)}`);
}
const createdProject = state.projects.find(project => project.id === newProject.projectId);
if (!createdProject || createdProject.name !== 'NiceHash' || createdProject.kind !== 'CHATGPT_PROJECT') {
  throw new Error(`created ChatGPT project is invalid: ${JSON.stringify(createdProject)}`);
}
if (state.settings.chatgptProjectMappings[newProjectKey] !== newProject.projectId) {
  throw new Error('new ChatGPT project key was not persisted');
}
if (!state.sources.some(source => source.externalId === '44444444-4444-4444-4444-444444444444' && source.projectId === newProject.projectId)) {
  throw new Error('new ChatGPT project conversation was not attached to the created project');
}

const secondNewProjectChat = ingestChatgptDelta(state,{
  conversationKey:'55555555-5555-5555-5555-555555555555',
  url:`https://chatgpt.com/g/${newProjectKey}/c/55555555-5555-5555-5555-555555555555`,
  title:'NiceHash follow-up',
  projectKey:newProjectKey,
  projectTitle:'NiceHash',
  projectUrl:`https://chatgpt.com/g/${newProjectKey}`,
  messages:[
    {role:'user',text:'Follow-up.'},
    {role:'assistant',text:'NEXT: verify the next NiceHash step.'}
  ],
  messageCount:2,
  fingerprint:'new-project-fixture-2',
  conversationUpdatedAt:'2026-09-18T19:35:00.000Z'
});
if (!secondNewProjectChat.mapped || secondNewProjectChat.projectCreated || secondNewProjectChat.projectId !== newProject.projectId) {
  throw new Error(`second chat did not reuse auto-created project: ${JSON.stringify(secondNewProjectChat)}`);
}
if (state.projects.filter(project => project.name === 'NiceHash').length !== 1) {
  throw new Error('auto-create duplicated the ChatGPT project');
}

console.log('ChatGPT delta ingest checks PASS');
