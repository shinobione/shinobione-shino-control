import assert from 'node:assert/strict';
import { extractLatestChatState } from './lib/chatgpt-tail-state.mjs';

const result = extractLatestChatState([
  {role:'user',text:'Earlier question about battery life.'},
  {role:'assistant',text:'The autonomy was excellent. NEXT: compare the Xiaomi battery and run a full battery test.'},
  {role:'user',text:'Ok, but what about the Galaxy Fit 3 instead?'},
  {role:'assistant',text:'The Galaxy Fit 3 is the better pick today. It has a better screen and daily tracking, while the old Mi Watch Lite mainly wins on built-in GPS. If you tell me the price you found, I can tell you if it is a good deal.'}
]);

assert.match(result.currentStateSummary, /Galaxy Fit 3 is the better pick today/i);
assert.doesNotMatch(result.currentStateSummary, /autonomy was excellent/i, 'old high-signal text must not leak into current state');
assert.match(result.resumeAction, /price you found|good deal/i, 'resume action must come from the latest assistant message');
assert.doesNotMatch(result.resumeAction, /battery test/i, 'old NEXT marker must not beat a newer exchange');

const explicit = extractLatestChatState([
  {role:'user',text:'The deploy is green now.'},
  {role:'assistant',text:'Great. Everything is deployed.\nNEXT: verify the live login once from an iPhone.'}
]);
assert.match(explicit.currentStateSummary, /Everything is deployed/i);
assert.match(explicit.resumeAction, /verify the live login once from an iPhone/i);

const finalUser = extractLatestChatState([
  {role:'assistant',text:'NEXT: run the old test.'},
  {role:'user',text:'Stop there, I am waiting for the replacement cable now.'}
]);
assert.match(finalUser.currentStateSummary, /waiting for the replacement cable/i);
assert.doesNotMatch(finalUser.currentStateSummary, /old test/i);

console.log('ChatGPT latest-tail state checks passed');
