# SHINO // CONTROL Runtime console

CONTROL's Windows supervisor can run as a small visible status console instead of a blank or hidden PowerShell process.

Default installation (`npm run startup:install`) uses a visible window titled `SHINO // CONTROL Runtime` and shows:

- Windows autostart state
- supervisor PID
- Core health and PID
- health URL
- repository and Node paths
- supervisor uptime
- last Core start time
- last runtime event / wait reason
- startup log location

The window stays open because it *is* the supervisor process. Closing it stops automatic Core restart until the next Windows sign-in or until `npm run startup:install` is run again. The Core process itself is not intentionally terminated when the supervisor window closes.

For a silent background supervisor, reinstall with:

```powershell
npm run startup:install -- --Hidden
```

`npm run startup:status` reports whether the configured console mode is `VISIBLE` or `HIDDEN`.
