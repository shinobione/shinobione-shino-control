# SHINO // CONTROL Collector

Browser sensor for the ChatGPT side of SHINO // CONTROL.

## Contract

The Collector has two deliberately narrow jobs.

### 1. Event-driven delta collection

For the conversation currently rendered in ChatGPT it:

1. waits for DOM activity to settle;
2. reads only the last conversation messages needed for a small delta;
3. sends stable identifiers, timestamps and the tail delta to local CONTROL;
4. retries later if CONTROL is temporarily unavailable.

An unchanged fingerprint is a real no-op: CONTROL does not rewrite state just because the same conversation was viewed again.

### 2. Targeted catch-up

To avoid manually reopening old conversations, the Collector periodically performs a metadata-only catch-up while ChatGPT is open:

1. in ChatGPT's authenticated MAIN world, read project conversation metadata (`id`, project and `updatedAt`) through the same internal endpoints used by the web app;
2. send only that metadata to CONTROL Core;
3. CONTROL compares live `updatedAt` values with its source-native conversation timestamps and returns a small refresh plan;
4. fetch full conversation data only for conversations that are new, have a newer remote timestamp, or lack a trustworthy local baseline;
5. feed those refreshed conversations through the normal `/api/ingest/chatgpt-delta` path.

There is no DOM project crawler, no click automation and no visible navigation through historical chats. The metadata inventory is used only to decide what needs refreshing; project mapping, deduplication, derivation and persistence remain CONTROL Core responsibilities.

The internal ChatGPT endpoints are not a public API contract. If ChatGPT changes them, the catch-up can fail without breaking the normal current-conversation delta Collector.

Default local endpoint:

`http://127.0.0.1:4177/api/ingest/chatgpt-delta`

The extension has no popup and is enabled by default. Advanced endpoint/token overrides remain available through `chrome.storage.local` for remote/private deployments.
