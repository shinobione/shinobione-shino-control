import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_STATE_PATH, runtimeStatePath } from './lib/state-store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shino-control-state-'));
const target = path.join(dir, 'runtime.json');
process.env.SHINO_CONTROL_STATE = target;

assert.equal(fs.existsSync(target), false);
assert.equal(runtimeStatePath(), target);
assert.equal(fs.existsSync(target), true, 'runtime state should bootstrap from tracked seed');
assert.deepEqual(
  JSON.parse(fs.readFileSync(target, 'utf8')),
  JSON.parse(fs.readFileSync(REPO_STATE_PATH, 'utf8')),
  'bootstrapped runtime state must match seed'
);
assert.notEqual(path.resolve(target), path.resolve(REPO_STATE_PATH));

fs.rmSync(dir, { recursive:true, force:true });
console.log('CONTROL runtime-state isolation checks PASS');
