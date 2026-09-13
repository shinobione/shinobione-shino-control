# SHINO // CONTROL Collector

Minimal browser sensor for the ChatGPT side of SHINO // CONTROL.

## Contract

The Collector is deliberately dumb. It does only four things:

1. observes the currently rendered ChatGPT conversation;
2. waits for DOM activity to settle;
3. sends a small conversation-tail delta plus stable identifiers/timestamps to local CONTROL;
4. retries later if CONTROL is temporarily unavailable.

It does **not** own project mapping, inventory, backfill, deduplication, Resume Engine logic, status derivation, cursors, or dashboard state. Those belong to CONTROL Core.

Default endpoint:

`http://127.0.0.1:4177/api/ingest/chatgpt-delta`

The extension has no popup and is enabled by default. Advanced endpoint/token overrides remain available through `chrome.storage.local` for remote/private deployments.

## Migration

`extension/shino-sync` remains in the repository only as a rollback path until the Collector is live-tested against the user's authenticated ChatGPT session.

Deletion gate for SHINO Sync:

- Collector loads as an unpacked extension;
- a changed ChatGPT conversation updates exactly one CONTROL project;
- reopening an unchanged conversation produces a no-op;
- unknown conversations go to CONTROL's discovered queue rather than being guessed;
- existing 17-project / 131-conversation coverage remains intact;
- GitHub Pages privacy/coverage gates stay green.

After those checks pass, remove `extension/shino-sync` and the legacy inventory/backfill endpoint.
