import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardRequest, authorized, json } from './lib/http-security.mjs';
import { writeRuntimeState } from './lib/state-store.mjs';
function request(overrides={}) {return {method:'GET',headers:{host:'127.0.0.1:4177'},socket:{remoteAddress:'127.0.0.1'},...overrides};}
function guard(req,options={}) {const res={status:200,writeHead(code,h){this.status=code;this.headers=h;},end(body){this.body=body;}};return {allowed:guardRequest(req,res,options),response:res};}
assert.equal(guard(request()).allowed,true);
assert.equal(guard(request({headers:{host:'localhost:4177',origin:'http://localhost:4177'}})).allowed,true);
assert.equal(guard(request({headers:{host:'attacker.test:4177'}})).response.status,403);
assert.equal(guard(request({headers:{host:'127.0.0.1:4177',origin:'https://attacker.test'}})).response.status,403);
assert.equal(guard(request({headers:{host:'127.0.0.1:4177','sec-fetch-site':'cross-site'}})).response.status,403);
assert.equal(guard(request({method:'POST',headers:{host:'127.0.0.1:4177','content-type':'text/plain'}})).response.status,403);
assert.equal(guard(request({headers:{host:'127.0.0.1:4177',origin:'chrome-extension://attacker'}})).response.status,403);
assert.equal(guard(request({headers:{host:'127.0.0.1:4177',origin:'chrome-extension://trusted'}}),{extensionId:'trusted'}).allowed,true);
assert.equal(guard(request({socket:{remoteAddress:'192.168.0.12'}})).response.status,403);
assert.equal(guard(request({socket:{remoteAddress:'evil127.0.0.1'}})).response.status,403);
assert.equal(authorized(request()),true);
process.env.SHINO_CONTROL_TOKEN='unit-test-only';
assert.equal(authorized(request()),false);
assert.equal(authorized(request({headers:{host:'127.0.0.1:4177',authorization:'Bearer unit-test-only'}})),true);
assert.equal(authorized(request({headers:{host:'127.0.0.1:4177',authorization:'Bearer wrong'}})),false);
delete process.env.SHINO_CONTROL_TOKEN;
const res={writeHead(_,h){this.h=h;},end(){}};
json(res,200,{});
assert.equal('Access-Control-Allow-Origin' in res.h,false);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'control-security-'));
const original=process.env.SHINO_CONTROL_STATE;
try {
  const target=path.join(dir,'state.json');
  process.env.SHINO_CONTROL_STATE=target;
  fs.writeFileSync(target,JSON.stringify({seq:1}));
  writeRuntimeState({seq:2});
  assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),{seq:2});
  assert.deepEqual(JSON.parse(fs.readFileSync(`${target}.bak`,'utf8')),{seq:1});
  writeRuntimeState({seq:3});
  assert.deepEqual(JSON.parse(fs.readFileSync(`${target}.bak`,'utf8')),{seq:2});
  fs.writeFileSync(target,'broken');
  assert.throws(()=>writeRuntimeState({seq:4}));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${target}.bak`,'utf8')),{seq:2});
  assert.equal(fs.readFileSync(target,'utf8'),'broken');
  assert.equal(fs.readdirSync(dir).filter(f=>f.endsWith('.tmp')).length,0);
} finally {
  if(original===undefined)delete process.env.SHINO_CONTROL_STATE;else process.env.SHINO_CONTROL_STATE=original;
  fs.rmSync(dir,{recursive:true,force:true});
}
console.log('CONTROL security checks PASS');
