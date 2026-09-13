import { deriveProjectState } from './lib/derive.mjs';

const now = new Date().toISOString();
const project = { id:'fixture-status', name:'Fixture status' };
const context = { inventoryPresent:true, currentChatCount:1 };

function chat(fields = {}) {
  return {
    id:fields.id || 'chat', projectId:'fixture-status', sourceType:'chatgpt_thread', type:'chat_sync',
    timestamp:fields.timestamp || now, title:fields.title || 'Current project work', summary:fields.summary || '',
    currentStateSummary:fields.currentStateSummary, resumeAction:fields.resumeAction, confidence:0.87
  };
}

function expect(label, expected, evidence) {
  const result = deriveProjectState(project, evidence, context);
  if (result.status !== expected) throw new Error(`${label}: expected ${expected}, got ${result.status} (${result.statusReason})`);
  return result;
}

const activeAfterCompletedSubstep = expect('completed substep with next action', 'ACTIVE', [chat({
  summary:'Inventory and mapping are complete.',
  currentStateSummary:'Inventory and mapping are complete. The next step is to implement Status Engine v1.',
  resumeAction:'NEXT: implement Status Engine v1.'
})]);
if (activeAfterCompletedSubstep.statusSource !== 'chat_resume_action') throw new Error(`active provenance: ${activeAfterCompletedSubstep.statusSource}`);

const needsTest = expect('chat validation gate', 'NEEDS TEST', [chat({
  summary:'Implementation is ready.',
  currentStateSummary:'Implementation is ready; physical validation is still required.',
  resumeAction:'NEXT: run the live hardware test and validate the result.'
})]);
if (!/test/i.test(needsTest.statusReason)) throw new Error(`needs-test reason missing: ${needsTest.statusReason}`);

const blocked = expect('chat blocker', 'BLOCKED', [chat({
  summary:'Work is blocked waiting for access to the external service.',
  currentStateSummary:'Cannot proceed until service access is restored.',
  resumeAction:'Waiting for service access before continuing.'
})]);
if (!blocked.blocker) throw new Error('blocked state did not expose blocker text');

const stable = expect('chat closeout', 'STABLE', [chat({
  summary:'All changes are merged, validated and complete. No remaining work.',
  currentStateSummary:'Program closeout complete. No remaining work.',
  resumeAction:'Continue in the synced ChatGPT thread.'
})]);
if (!/état stable/i.test(stable.nextAction)) throw new Error(`stable project should not invent work: ${stable.nextAction}`);

const oldGate = new Date(Date.now()-86400000).toISOString();
const explicitGateWins = expect('authoritative physical gate precedence', 'NEEDS TEST', [
  chat({
    id:'chat-new', timestamp:now,
    summary:'General implementation work continues.',
    currentStateSummary:'Continue implementation of the next UI improvement.',
    resumeAction:'NEXT: update the UI copy.'
  }),
  {
    id:'gh-gate',projectId:'fixture-status',sourceType:'github_pr',type:'pr',timestamp:oldGate,
    title:'Physical acceptance pending',summary:'Real hardware validation is still required.',confidence:0.99,
    derivedStatusHint:'NEEDS TEST',resumeAction:'Run the physical acceptance test.'
  }
]);
if (explicitGateWins.statusEvidenceId !== 'gh-gate') throw new Error(`gate provenance: expected gh-gate, got ${explicitGateWins.statusEvidenceId}`);
if (explicitGateWins.statusSource !== 'explicit_hint') throw new Error(`gate source: ${explicitGateWins.statusSource}`);

expect('passed test with new feature next', 'ACTIVE', [chat({
  summary:'The previous test passed and the fix is validated.',
  currentStateSummary:'The previous gate passed. Next step is to build the follow-up feature.',
  resumeAction:'NEXT: build the follow-up feature.'
})]);

console.log('Status Engine checks PASS');
