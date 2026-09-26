import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createMutationQueue } from './lib/state-mutation-queue.mjs';
import { syncGithubIncremental } from './lib/github-incremental-sync.mjs';
import { commitGithubSync } from './lib/github-sync-commit.mjs';

// The queue includes the read and the write; a failed operation cannot poison it.
const enqueue = createMutationQueue();
const order = [];
let releaseFirst;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const first = enqueue(async () => {
  order.push('first-start');
  await firstGate;
  order.push('first-failed');
  throw new Error('intentional');
});
const second = enqueue(() => { order.push('second'); return 42; });
await Promise.resolve();
assert.deepEqual(order, ['first-start']);
releaseFirst();
await assert.rejects(first, /intentional/);
assert.equal(await second, 42);
assert.deepEqual(order, ['first-start','first-failed','second']);

let record = {a:0,b:0};
let unblock;
const barrier = new Promise(resolve => { unblock = resolve; });
const a = enqueue(async () => {
  const next = {...record};
  await barrier;
  next.a = 1;
  record = next;
});
const b = enqueue(() => {
  const next = {...record};
  next.b = 1;
  record = next;
});
await Promise.resolve();
unblock();
await Promise.all([a,b]);
assert.deepEqual(record, {a:1,b:1}, 'queued read/mutate/write must retain both changes');

function response(status, body, etag = null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers:etag ? {etag} : {}
  });
}

const baseline = {
  version:1,
  settings:{},
  projects:[{id:'probe',name:'Original',repo:'example/control'}],
  sources:[{id:'chat',projectId:'probe',type:'chatgpt_thread',title:'User source'}],
  evidence:[{id:'user-note',projectId:'probe',sourceType:'chatgpt_thread',title:'User evidence'}],
  discovered:[],
  derived:[]
};
const staged = structuredClone(baseline);
let remoteStarted;
let remoteRelease;
const started = new Promise(resolve => { remoteStarted = resolve; });
const gate = new Promise(resolve => { remoteRelease = resolve; });
const fakeFetch = async url => {
  if (url === 'https://api.github.com/repos/example/control') {
    remoteStarted();
    await gate;
    return response(200,{default_branch:'main',pushed_at:new Date().toISOString()},'"meta"');
  }
  if (url.includes('/commits?')) {
    return response(200,[{sha:'abcdef1234567890',commit:{committer:{date:new Date().toISOString()},message:'New commit'}}],'"commits"');
  }
  if (url.includes('/pulls?')) return response(304,null,'"prs"');
  if (url.includes('/actions/runs?')) return response(304,null,'"runs"');
  if (url.includes('/contents/')) return response(404,{error:'Not Found'});
  throw new Error('Unexpected fake URL: '+url);
};
const sync = syncGithubIncremental(staged,'',{fetchImpl:fakeFetch});
await started;
const latest = structuredClone(baseline);
latest.projects[0].name = 'Edited while remote I/O waits';
latest.sources.push({id:'extra',projectId:'probe',type:'chatgpt_thread'});
latest.evidence.push({id:'extra-evidence',projectId:'probe',sourceType:'chatgpt_thread'});
remoteRelease();
const stagedResult = await sync;
const committed = commitGithubSync(latest,baseline,staged,stagedResult);
assert.equal(latest.projects[0].name,'Edited while remote I/O waits');
assert.ok(latest.sources.some(x => x.id === 'extra'));
assert.ok(latest.evidence.some(x => x.id === 'extra-evidence'));
assert.ok(latest.evidence.some(x => x.id === 'ghc-probe-abcdef1234567890'));
assert.equal(latest.settings.githubCursors['example/control'].commitsEtag,'"commits"');
assert.deepEqual(committed.dirtyProjectIds,['probe']);

const reassigned = structuredClone(baseline);
reassigned.projects[0].repo = null;
const discarded = commitGithubSync(reassigned,baseline,staged,stagedResult);
assert.deepEqual(discarded.summary.staleSkippedProjectIds,['probe']);
assert.equal(reassigned.settings.githubCursors['example/control'],undefined);
assert.ok(!reassigned.sources.some(x => x.type === 'github_repo'));

// True HTTP integration: a deliberately blocked GitHub request must not block a
// simultaneous local edit, and the eventual sync commit must retain that edit.
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'control-concurrent-'));
const statePath = path.join(dir,'state.json');
const preloadPath = path.join(dir,'mock-github.mjs');
const startedPath = path.join(dir,'remote-started');
const releasedPath = path.join(dir,'remote-released');
const port = 21000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
fs.writeFileSync(statePath, JSON.stringify(baseline));
fs.writeFileSync(preloadPath, `
import fs from 'node:fs';
const original = globalThis.fetch;
globalThis.fetch = async (resource, init) => {
  const url = String(resource);
  if (!url.startsWith('https://api.github.com/repos/example/control')) return original(resource, init);
  const response = (status, value, etag) => new Response(value == null ? null : JSON.stringify(value), {
    status, headers:etag ? {etag} : {}
  });
  if (url === 'https://api.github.com/repos/example/control') {
    fs.writeFileSync(process.env.CONTROL_REMOTE_STARTED,'started');
    while (!fs.existsSync(process.env.CONTROL_REMOTE_RELEASED)) {
      await new Promise(resolve => setTimeout(resolve,10));
    }
    return response(200,{default_branch:'main',pushed_at:new Date().toISOString()},'"meta"');
  }
  if (url.includes('/commits?')) return response(304,null,'"commits"');
  if (url.includes('/pulls?')) return response(304,null,'"prs"');
  if (url.includes('/actions/runs?')) return response(304,null,'"runs"');
  if (url.includes('/contents/')) return response(404,{error:'Not Found'});
  throw new Error('Unexpected mock URL: '+url);
};
`);
let stdout = '';
let stderr = '';
const child = spawn(process.execPath,['--import',pathToFileURL(preloadPath).href,'server-entry.mjs'],{
  cwd:process.cwd(),
  env:{...process.env,PORT:String(port),SHINO_CONTROL_STATE:statePath,
    CONTROL_REMOTE_STARTED:startedPath,CONTROL_REMOTE_RELEASED:releasedPath,
    SHINO_CONTROL_EXTENSION_ID:''},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',data => { stdout += data; });
child.stderr.on('data',data => { stderr += data; });
async function until(predicate,label,limit=10000) {
  const deadline = Date.now()+limit;
  while (Date.now()<deadline) {
    if (child.exitCode !== null) throw new Error(`Core exited early: ${label} ${child.exitCode}\n${stdout}\n${stderr}`);
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve,20));
  }
  throw new Error(`Timed out: ${label}\n${stdout}\n${stderr}`);
}
async function post(route,body) {
  return fetch(`${base}${route}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(4000)
  });
}
try {
  await until(async () => {
    try { return (await fetch(`${base}/api/state`)).ok; }
    catch { return false; }
  },'server startup');

  const inFlight = post('/api/sync/github',{});
  await until(() => fs.existsSync(startedPath),'GitHub network gate');

  const userEdit = await post('/api/projects/update',{projectId:'probe',name:'Live edit during GitHub sync'});
  assert.equal(userEdit.status,200,'local write must not be blocked by remote GitHub fetch');
  fs.writeFileSync(releasedPath,'go');

  const completed = await inFlight;
  assert.equal(completed.status,200,'GitHub sync should eventually finish');
  const finalResponse = await fetch(`${base}/api/state`);
  assert.equal(finalResponse.status,200);
  const final = await finalResponse.json();
  assert.equal(final.projects.find(p=>p.id==='probe')?.name,'Live edit during GitHub sync');
  assert.ok(final.settings.githubCursors['example/control'],'GitHub cursor should be committed');
  assert.ok(final.sources.some(s=>s.projectId==='probe'&&s.type==='github_repo'));
} finally {
  fs.writeFileSync(releasedPath,'go');
  child.kill();
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit',resolve);
    setTimeout(resolve,2000);
  });
  fs.rmSync(dir,{recursive:true,force:true});
}

console.log('CONTROL serialized mutation and live GitHub sync integration checks PASS');
