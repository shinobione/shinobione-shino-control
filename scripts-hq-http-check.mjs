import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shino-hq-http-'));
const statePath=path.join(dir,'state.json');
fs.writeFileSync(statePath,JSON.stringify({version:1,projects:[{id:'demo-dev',name:'DEMO dev',universe:'DEV',kind:'MANUAL_PROJECT'}],sources:[],evidence:[],settings:{},discovered:[]}));
const port=21000+(process.pid%1000),base=`http://127.0.0.1:${port}`;
let child,output='';
async function start(token='') {
  child=spawn(process.execPath,['server-entry.mjs'],{env:{...process.env,PORT:String(port),SHINO_CONTROL_STATE:statePath,SHINO_CONTROL_TOKEN:token,SHINO_CONTROL_EXTENSION_ID:''},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{output+=chunk;});
  child.stderr.on('data',chunk=>{output+=chunk;});
  for(let i=0;i<100;i++) {
    if (child.exitCode !== null) throw new Error('HQ fixture server exited');
    try { const response=await fetch(`${base}/api/hq`); if (response.status !== 404) return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,40));
  }
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done=new Promise(resolve=>child.once('exit',resolve));
  child.kill(); await done;
}
const post=(route,body,headers={})=>fetch(`${base}${route}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
try {
  await start();
  assert.equal((await fetch(`${base}/api/hq`)).status,200);
  const mutations=Array.from({length:12},(_,i)=>post('/api/hq/mutate',{collection:'actions',operation:'create',id:`demo-${i}`,values:{title:`DEMO ${i}`,universe:['MUSIC','DEV','WORK','PERSONAL'][i%4]}}));
  const responses=await Promise.all(mutations);
  assert.ok(responses.every(r=>r.status===200),'concurrent HQ writes succeed');
  const control=await post('/api/projects/update',{projectId:'demo-dev',name:'DEMO renamed'});
  assert.equal(control.status,200);
  const before=await (await fetch(`${base}/api/hq`)).json();
  assert.equal(before.hq.actions.length,12);
  const backup=await (await fetch(`${base}/api/hq/backup`)).json();
  const deleted=await post('/api/hq/mutate',{collection:'actions',operation:'delete',id:'demo-0',confirmId:'demo-0',expectedRevision:1});
  assert.equal(deleted.status,200);
  assert.equal((await post('/api/hq/restore',{backup,confirm:false})).status,400);
  assert.equal((await post('/api/hq/restore',{backup,confirm:true})).status,200);
  backup.sha256='corrupted';
  assert.equal((await post('/api/hq/restore',{backup,confirm:true})).status,400);
  assert.equal((await post('/api/hq/mutate',{collection:'actions',operation:'create',id:'bad',values:{title:'DEMO',universe:'WRONG'}})).status,400);
  const foreign=await post('/api/hq/mutate',{},{Origin:'https://attacker.invalid'});
  assert.equal(foreign.status,403);
  const forged=await new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,path:'/api/hq/backup',headers:{Host:'attacker.invalid'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end();
  });
  assert.equal(forged,403);
  await stop();
  await start();
  const after=await (await fetch(`${base}/api/hq`)).json();
  assert.deepEqual(after.hq,before.hq,'all HQ data survives restart and restore');
  const core=await (await fetch(`${base}/api/state`)).json();
  assert.equal(core.projects.find(p=>p.id==='demo-dev').name,'DEMO renamed','HQ restore preserves latest CONTROL changes');
  assert.ok(fs.existsSync(`${statePath}.bak`));
  assert.equal((await fetch(`${base}/data/state.local.json`)).status,404);
  await stop();
  await start('DEMO-legacy-token');
  assert.equal((await fetch(`${base}/api/hq`)).status,401);
  assert.equal((await fetch(`${base}/api/hq/backup`)).status,401);
  assert.equal((await post('/api/hq/mutate',{})).status,401);
  assert.equal((await fetch(`${base}/api/hq`,{headers:{Authorization:'Bearer DEMO-legacy-token'}})).status,200);
  assert.ok(!output.includes('DEMO renamed'),'server logs contain no private payloads');
} finally {
  await stop();
  fs.rmSync(dir,{recursive:true,force:true});
}
console.log('HQ HTTP guards, concurrent CRUD, restore and process-restart persistence PASS');
