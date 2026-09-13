import { syncGithubIncremental } from './lib/github-incremental-sync.mjs';

const now = new Date().toISOString();
const state = {
  version:1,
  settings:{},
  projects:[{id:'control',name:'SHINO // CONTROL',repo:'shinobione/example'}],
  sources:[],
  evidence:[],
  derived:[]
};

function response(status, data, etag = null, textValue = null) {
  return {
    status,
    ok:status >= 200 && status < 300,
    statusText:status === 304 ? 'Not Modified' : status === 404 ? 'Not Found' : 'OK',
    headers:{ get(name){ return String(name).toLowerCase() === 'etag' ? etag : null; } },
    async json(){ return data; },
    async text(){ return textValue ?? (typeof data === 'string' ? data : JSON.stringify(data)); }
  };
}

const calls = [];
let phase = 1;
async function fakeFetch(url, options = {}) {
  const ifNoneMatch = options.headers?.['If-None-Match'] || null;
  calls.push({phase,url,ifNoneMatch});

  if (url === 'https://api.github.com/repos/shinobione/example') {
    if (phase > 1) return response(304, null, '"meta-1"');
    return response(200,{default_branch:'main',pushed_at:now},'"meta-1"');
  }
  if (url.includes('/commits?')) {
    if (phase > 1) return response(304,null,'"commits-1"');
    return response(200,[{
      sha:'abcdef1234567890abcdef',html_url:'https://github.com/shinobione/example/commit/abcdef1',
      commit:{committer:{date:now},author:{date:now},message:'Implement cursor sync'}
    }],'"commits-1"');
  }
  if (url.includes('/pulls?')) {
    if (phase === 2) return response(304,null,'"prs-1"');
    if (phase === 3) return response(200,[{
      number:8,title:'Physical acceptance pending',body:'Needs live test on real hardware.',
      updated_at:new Date(Date.now()+1000).toISOString(),created_at:now,merged_at:null,draft:false,
      html_url:'https://github.com/shinobione/example/pull/8'
    }],'"prs-2"');
    return response(200,[{
      number:7,title:'Initial cursor implementation',body:'Implementation in progress.',
      updated_at:now,created_at:now,merged_at:null,draft:false,
      html_url:'https://github.com/shinobione/example/pull/7'
    }],'"prs-1"');
  }
  if (url.includes('/actions/runs?')) {
    if (phase > 1) return response(304,null,'"runs-1"');
    return response(200,{workflow_runs:[{
      id:99,name:'check',status:'completed',conclusion:'success',head_branch:'main',updated_at:now,
      html_url:'https://github.com/shinobione/example/actions/runs/99'
    }]},'"runs-1"');
  }
  if (url.includes('/contents/PROJECT_STATE.md')) {
    return response(200,null,null,'# STATUS\nCursor engine ACTIVE\nNEXT: validate incremental sync.');
  }
  if (url.includes('/contents/PROJECT-STATE.md') || url.includes('/contents/ROADMAP.md') || url.includes('/contents/README.md')) {
    return response(404,null);
  }
  throw new Error(`Unexpected fake GitHub URL: ${url}`);
}

const first = await syncGithubIncremental(state,'fixture-token',{fetchImpl:fakeFetch});
if (first.summary.changed !== 1 || first.dirtyProjectIds.join(',') !== 'control') throw new Error(`first sync should dirty control: ${JSON.stringify(first.summary)}`);
if (!state.settings.githubCursors?.['shinobione/example']?.commitsEtag) throw new Error('first sync did not persist commits ETag');
if (!state.evidence.some(e => e.id === 'ghc-control-abcdef1234567890')) throw new Error('stable commit evidence id missing');
if (!state.evidence.some(e => e.id === 'ghpr-control-7')) throw new Error('stable PR evidence id missing');
if (!state.evidence.some(e => e.id === 'ghci-control-99')) throw new Error('stable workflow evidence id missing');
if (!state.evidence.some(e => e.id === 'ght-control-project-state-md')) throw new Error('truth-file evidence missing');
const evidenceAfterFirst = JSON.stringify(state.evidence);
const truthCallsAfterFirst = calls.filter(call => call.url.includes('/contents/')).length;

phase = 2;
const second = await syncGithubIncremental(state,'fixture-token',{fetchImpl:fakeFetch});
if (second.summary.changed !== 0 || second.summary.unchanged !== 1) throw new Error(`second sync should be a complete cursor hit: ${JSON.stringify(second.summary)}`);
if (second.dirtyProjectIds.length !== 0) throw new Error(`unchanged GitHub sync dirtied projects: ${second.dirtyProjectIds}`);
if (second.derivation !== null) throw new Error('unchanged GitHub sync should not invoke derivation');
if (JSON.stringify(state.evidence) !== evidenceAfterFirst) throw new Error('unchanged GitHub sync mutated evidence');
if (calls.filter(call => call.url.includes('/contents/')).length !== truthCallsAfterFirst) throw new Error('unchanged commit feed still re-read truth files');
const secondCommitCall = calls.find(call => call.phase === 2 && call.url.includes('/commits?'));
const secondPrCall = calls.find(call => call.phase === 2 && call.url.includes('/pulls?'));
const secondRunCall = calls.find(call => call.phase === 2 && call.url.includes('/actions/runs?'));
if (secondCommitCall?.ifNoneMatch !== '"commits-1"') throw new Error(`commit cursor not sent: ${secondCommitCall?.ifNoneMatch}`);
if (secondPrCall?.ifNoneMatch !== '"prs-1"') throw new Error(`PR cursor not sent: ${secondPrCall?.ifNoneMatch}`);
if (secondRunCall?.ifNoneMatch !== '"runs-1"') throw new Error(`workflow cursor not sent: ${secondRunCall?.ifNoneMatch}`);

phase = 3;
const third = await syncGithubIncremental(state,'fixture-token',{fetchImpl:fakeFetch});
if (third.summary.changed !== 1 || third.dirtyProjectIds.join(',') !== 'control') throw new Error(`PR-only change should dirty control: ${JSON.stringify(third.summary)}`);
if (!third.results[0]?.changedKinds?.includes('prs') || third.results[0]?.changedKinds?.length !== 1) throw new Error(`expected PR-only change, got ${third.results[0]?.changedKinds}`);
if (!state.evidence.some(e => e.id === 'ghpr-control-8')) throw new Error('new PR evidence missing after PR-only delta');
if (state.evidence.some(e => e.id === 'ghpr-control-7')) throw new Error('stale live PR evidence survived replacement');
if (!state.evidence.some(e => e.id === 'ghc-control-abcdef1234567890')) throw new Error('unchanged commit evidence was lost during PR-only update');
if (calls.filter(call => call.url.includes('/contents/')).length !== truthCallsAfterFirst) throw new Error('PR-only delta unnecessarily re-read repository truth files');
if (state.derived.find(item => item.projectId === 'control')?.status !== 'NEEDS TEST') throw new Error(`PR physical gate did not update derived status: ${state.derived.find(item=>item.projectId==='control')?.status}`);
if (state.settings.githubCursors?.['shinobione/example']?.prsEtag !== '"prs-2"') throw new Error('updated PR ETag was not persisted');

console.log('GitHub incremental cursor checks PASS');
