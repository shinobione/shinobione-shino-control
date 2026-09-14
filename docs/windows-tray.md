# SHINO // CONTROL Windows tray

CONTROL can run without a visible PowerShell window. The Windows supervisor stays hidden and a small native tray executable provides the visible runtime status.

## What the tray icon does

- uses the same visual motif as `public/favicon.svg` (dark rounded square, gold slashes, cyan dot/line)
- double-click opens `http://127.0.0.1:4177`
- right-click shows Core and supervisor state
- refreshes health automatically every 10 seconds
- can request a controlled Core restart; the hidden supervisor brings Node back
- opens the CONTROL runtime folder or `startup.log`
- quitting the tray icon does **not** stop CONTROL or the supervisor

## Installation

`npm run startup:install` now:

1. installs the hidden supervisor in `%LOCALAPPDATA%\SHINO-Control`;
2. compiles `scripts/windows/ShinoControlTray.cs` into `%LOCALAPPDATA%\SHINO-Control\SHINO-Control-Tray.exe` using Windows PowerShell / .NET;
3. registers both `SHINO_CONTROL_Core` and `SHINO_CONTROL_Tray` under the current user's Windows `Run` key;
4. starts both immediately unless `-NoStart` is used.

No admin rights and no additional SDK are required.

To install CONTROL without the tray icon:

```powershell
npm run startup:install -- --NoTray
```

`npm run startup:status` reports the tray as RUNNING, INSTALLED / NOT RUNNING, or DISABLED.
