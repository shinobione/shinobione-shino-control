import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';

assert.equal(fs.existsSync('server.mjs'), false, 'legacy compatibility server must stay removed');
const entry = fs.readFileSync('server-entry.mjs','utf8');
assert.doesNotMatch(entry, /http\.createServer\s*=/, 'http.createServer must not be monkey-patched');
assert.doesNotMatch(entry, /import\(['"]\.\/server\.mjs['"]\)/, 'server-entry must not import a second server');
assert.match(entry, /const server = http\.createServer\(/, 'server-entry must own the HTTP server');

const dir = fs.mkdtempSync(path.join(os.tmpdir(),'control-http-'));
const statePath = path.join(dir,'state.json');
fs.copyFileSync('data/state.json', statePath);
const port = 19000 + (process.pid % 1000);
let stdout = '';
let stderr = '';
const child = spawn(process.execPath, ['server-entry.mjs'], {
  cwd:process.cwd(),
  env:{...process.env,PORT:String(port),SHINO_CONTROL_STATE:statePath,
    SHINO_CONTROL_TOKEN:'legacy-setting-must-be-ignored',
    SHINO_CONTROL_EXTENSION_ID:'abcdefghijklmnopabcdefghijklmnop'},
  stdio:['ignore','pipe','pipe']
});
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });

const base = `http://127.0.0.1:${port}`;
async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`CONTROL exited early (${child.exitCode})\n${stdout}\n${stderr}`);
    try {
      const response = await fetch(`${base}/api/state`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw new Error(`CONTROL did not start\n${stdout}\n${stderr}`);
}

try {
  await waitForServer();

  const page = await fetch(`${base}/`);
  assert.equal(page.status,200);
  assert.match(await page.text(),/SHINO \/\/ CONTROL/);

  const state = await fetch(`${base}/api/state`);
  assert.equal(state.status,200);
  assert.equal(typeof (await state.json()),'object');

  const ignored = await fetch(`${base}/api/discovered/ignore`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:'__integration_missing__'})
  });
  assert.equal(ignored.status,200);
  assert.equal((await ignored.json()).ok,true);

  const unknown = await fetch(`${base}/api/not-a-route`);
  assert.equal(unknown.status,404);
  assert.equal((await unknown.json()).error,'Unknown CONTROL API route');

  const trustedExtension = await fetch(`${base}/api/state`,{
    headers:{Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'}
  });
  assert.equal(trustedExtension.status,200);

  const foreignExtension = await fetch(`${base}/api/state`,{
    headers:{Origin:'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',Authorization:'Bearer legacy-setting-must-be-ignored'}
  });
  assert.equal(foreignExtension.status,403);

  const foreign = await fetch(`${base}/api/state`,{headers:{
    Origin:'https://attacker.invalid',Authorization:'Bearer legacy-setting-must-be-ignored'
  }});
  assert.equal(foreign.status,403);

  // Node fetch normalizes Host to the request URL. Use raw HTTP so the
  // invalid Host header actually reaches Core on Linux and Windows.
  const forgedHostStatus = await new Promise((resolve,reject) => {
    const request = httpRequest({
      host:'127.0.0.1',port,path:'/api/state',
      headers:{Host:'attacker.invalid:4177'}
    }, response => {
      response.resume();
      response.on('end',() => resolve(response.statusCode));
    });
    request.on('error',reject);
    request.end();
  });
  assert.equal(forgedHostStatus,403);
} finally {
  child.kill();
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit',resolve);
    setTimeout(resolve,2000);
  });
  fs.rmSync(dir,{recursive:true,force:true});
}

console.log('CONTROL single HTTP server integration checks PASS');
