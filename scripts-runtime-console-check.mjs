import fs from 'node:fs';
import assert from 'node:assert/strict';

const supervisor = fs.readFileSync('scripts/windows/control-supervisor.ps1','utf8');
const installer = fs.readFileSync('scripts/windows/install-startup.ps1','utf8');
const status = fs.readFileSync('scripts/windows/startup-status.ps1','utf8');

assert.match(supervisor,/SHINO \/\/ CONTROL Runtime/);
assert.match(supervisor,/Supervisor : RUNNING/);
assert.match(supervisor,/CONTROL Core is responding normally/);
assert.match(supervisor,/CoreState 'RESTARTING'/);
assert.match(installer,/consoleVisible/);
assert.match(installer,/\[switch\]\$Hidden/);
assert.match(installer,/WindowStyle/);
assert.match(installer,/restarting old PID/);
assert.match(status,/Console    :/);
assert.match(status,/Get-NetTCPConnection/);

console.log('Runtime console checks passed');
