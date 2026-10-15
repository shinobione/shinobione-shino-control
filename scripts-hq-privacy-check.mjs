import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildPublicSnapshot } from './lib/public-snapshot.mjs';

const canary='HQ_PRIVATE_CANARY_DO_NOT_PUBLISH';
const privateData={actions:[{title:canary}],contacts:[{note:canary}],deliverables:[{sourceUrl:canary}],activity:[{note:canary}]};
const fixture={version:1,settings:{hq:privateData,githubRepos:[]},projects:[{id:'demo',name:'DEMO public project',universe:'DEV',hq:privateData,control:{note:canary,tags:['public',{secret:canary}]}}],sources:[],evidence:[],derived:[{projectId:[canary]},{projectId:[[canary]]}],discovered:[],hq:privateData,...privateData};
const projected=JSON.stringify(buildPublicSnapshot(fixture));
assert.equal(projected.includes(canary),false,'strict typed projection excludes all private collections and nested fields');
assert.equal(JSON.parse(projected).hq,undefined);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hq-public-build-'));
try{
  for(const folder of ['lib','scripts','public'])fs.cpSync(folder,path.join(dir,folder),{recursive:true});
  fs.copyFileSync('package.json',path.join(dir,'package.json'));
  fs.mkdirSync(path.join(dir,'data'));
  fs.writeFileSync(path.join(dir,'data','state.json'),JSON.stringify(fixture));
  fs.writeFileSync(path.join(dir,'public','private-hq.json'),JSON.stringify(privateData));
  fs.mkdirSync(path.join(dir,'public','private-dump'));
  fs.writeFileSync(path.join(dir,'public','private-dump','backup.json'),JSON.stringify(privateData));
  const baseline=buildPublicSnapshot({...fixture,projects:[...fixture.projects,{id:'more',name:'DEMO coverage baseline'}]});
  baseline.hq=privateData;
  baseline.contacts=privateData.contacts;
  baseline.derived.push({projectId:[[canary]]});
  fs.writeFileSync(path.join(dir,'data','state.pages.json'),JSON.stringify(baseline));
  const build=spawnSync(process.execPath,['scripts/build-pages.mjs'],{cwd:dir,env:{...process.env,SHINO_CONTROL_STATE:path.join(dir,'data','state.json')},encoding:'utf8'});
  assert.equal(build.status,0,'isolated Pages build succeeds');
  assert.ok(!`${build.stdout}${build.stderr}`.includes(canary),'build logs contain no private payloads');
  const dist=path.join(dir,'dist');
  assert.equal(fs.existsSync(path.join(dist,'private-hq.json')),false,'unlisted files cannot become public artifacts');
  assert.equal(fs.existsSync(path.join(dist,'private-dump')),false,'unlisted directories cannot become public artifacts');
  const output=JSON.parse(fs.readFileSync(path.join(dist,'state.json'),'utf8'));
  assert.equal(output.projects.length,2,'coverage fallback still preserves fuller baseline');
  assert.equal(output.settings.publicSnapshot,true);
  assert.ok(output.settings.publishGuard);
  function scan(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())scan(file);else assert.equal(fs.readFileSync(file).includes(Buffer.from(canary)),false,'distributed artifacts contain no HQ private canary');}}
  scan(dist);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('HQ private collections, strict public fallback, artifact allowlist and build-log privacy PASS');
