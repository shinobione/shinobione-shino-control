# Tray health model

The tray app polls `http://127.0.0.1:4177/api/state` every 10 seconds.

- `Core: HEALTHY` means the local CONTROL Core answered HTTP 200.
- `Core: DOWN / WAITING` means the endpoint did not answer; the hidden supervisor remains responsible for recovery.
- `Supervisor: RUNNING (PID ...)` comes from `%LOCALAPPDATA%\SHINO-Control\supervisor.pid` plus a live process check.

The tray is deliberately presentation/control only. It does not own Core state, project derivation, ChatGPT collection, or GitHub sync.
