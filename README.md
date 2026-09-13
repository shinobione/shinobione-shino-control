# SHINO // CONTROL

A **source-derived project radar and resume hub** for the SHINO ecosystem.

For each project, CONTROL answers:

- what is the actual current state according to evidence;
- what happened last;
- what the safest / most likely next step is;
- where to resume work;
- why CONTROL inferred that state.

## Current architecture

CONTROL Core owns project state, mapping, deduplication, Resume Engine, Status Engine, dirty-project derivation and GitHub cursors.

ChatGPT capture is handled by the tiny browser sensor in:

```text
extension/control-collector
```

The Collector has no popup, project inventory, backfill crawler or business logic. It watches the active ChatGPT conversation, waits for the DOM to settle, fingerprints the rendered conversation tail and sends a delta to CONTROL.

Local ingest endpoint:

```text
POST /api/ingest/chatgpt-delta
```

An unchanged fingerprint is a true no-op: CONTROL does not rewrite `state.json` and does not rederive a project.

The previous SHINO Sync extension and ChatGPT inventory/backfill pipeline were retired after live validation of mapped delta ingestion and no-op behavior. Historical inventory coverage metadata may remain in state as provenance; it is not an active crawler.

## GitHub sync

GitHub sync is incremental. CONTROL stores cursors/ETags for repository feeds so unchanged commits, PRs and workflow feeds are skipped instead of being rebuilt.

Local endpoint:

```text
POST /api/sync/github
```

Public repositories can be read without a token subject to GitHub limits. For private repositories, set `GITHUB_TOKEN` before starting CONTROL.

## Run locally

Requires Node 20+.

```bash
npm start
```

Open:

```text
http://127.0.0.1:4177
```

No npm install is required; CONTROL currently uses Node built-ins and browser APIs only.

For a non-loopback deployment, set an ingestion token:

```powershell
$env:SHINO_CONTROL_TOKEN="..."
npm start
```

When `SHINO_CONTROL_TOKEN` is unset, mutation/ingest requests are accepted only from loopback.

## Chrome Collector

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
extension/control-collector
```

The extension intentionally exposes no popup. Status is kept internally in `chrome.storage.local` and normal operation is automatic.

## GitHub Pages

GitHub Pages is the read-only public dashboard. Every push to `main` rebuilds and deploys a sanitized state snapshot through `.github/workflows/pages.yml`.

The public snapshot strips private ChatGPT URLs, project keys and raw evidence while retaining the useful derived card state. A coverage guard prevents a less-complete repository state from replacing a fuller committed public snapshot.

## Derivation

CONTROL combines evidence rather than blindly mirroring the newest event.

Resume Engine prioritizes explicit actionable conversation state and filters code / PowerShell noise. Status Engine derives `ACTIVE`, `STABLE`, `NEEDS TEST` and `BLOCKED`. Dirty-project derivation fingerprints project inputs so unchanged cards are reused instead of recalculated.

## Data

Local mutable state is stored in:

```text
data/state.json
```

The committed sanitized Pages baseline is:

```text
data/state.pages.json
```

`npm run build:pages` generates `dist/` and applies the public-snapshot coverage/privacy gates.
