import fs from 'node:fs';
import assert from 'node:assert/strict';

const tray = fs.readFileSync('scripts/windows/ShinoControlTray.cs','utf8');
const installer = fs.readFileSync('scripts/windows/install-startup.ps1','utf8');
const supervisor = fs.readFileSync('scripts/windows/control-supervisor.ps1','utf8');
const status = fs.readFileSync('scripts/windows/startup-status.ps1','utf8');
const uninstall = fs.readFileSync('scripts/windows/uninstall-startup.ps1','utf8');
const server = fs.readFileSync('server-entry.mjs','utf8');

assert.match(tray,/NotifyIcon/);
assert.match(tray,/SHINO \/\/ CONTROL/);
assert.match(tray,/CreateControlIcon/);
assert.match(tray,/Restart CONTROL Core/);
assert.match(tray,/Open SHINO \/\/ CONTROL/);
assert.match(tray,/Quit tray icon/);
assert.match(installer,/SHINO-Control-Tray\.exe/);
assert.match(installer,/OutputType WindowsApplication/);
assert.match(installer,/SHINO_CONTROL_Tray/);
assert.match(installer,/WindowStyle Hidden/);
assert.match(installer,/\[string\]\$ExtensionId/);
assert.match(installer,/extensionId = \$resolvedExtensionId/);
assert.match(installer,/\/api\/control\/restart/);
assert.match(supervisor,/\$env:SHINO_CONTROL_EXTENSION_ID = \$extensionId/);
assert.match(status,/Tray       :/);
assert.match(status,/Collector  :/);
assert.match(status,/LEGACY ENV ONLY/);
assert.match(uninstall,/SHINO_CONTROL_Tray/);
assert.match(server,/\/api\/control\/restart/);

console.log('Tray checks passed');
