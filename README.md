# SHINO // CONTROL

A **source-derived project radar and resume hub** for the SHINO ecosystem.

Current engineering priorities are tracked in [ROADMAP.md](ROADMAP.md).

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

The Collector has no popup, project inventory, backfill crawler or business logic. It watches the active ChatGPT conversation, waits for the DOM to settle, fingerprints the rendered conversation tail and sends a delta to CONTROL. Targeted ChatGPT API catch-up runs entirely in the extension's isolated content-script world; CONTROL does not inject a MAIN-world script and does not bridge conversation data through `window.postMessage`.

Local ingest endpoint:

```text
POST /api/ingest/chatgpt-delta
```

An unchanged fingerprint is a true no-op: CONTROL does not rewrite the local runtime state and does not rederive a project.

The previous SHINO Sync extension and ChatGPT inventory/backfill pipeline were retired after live validation of mapped delta ingestion and no-op behavior. Historical inventory coverage metadata may remain in state as provenance; it is not an active crawler.

## Project management

CONTROL has a user-owned management layer on top of source-derived truth.

From **Gérer les projets**, you can:

- rename projects and edit their description/universe;
- add a personal note and tags;
- assign a custom group and use the grouped dashboard view;
- pin important projects;
- override the derived state (`ACTIVE`, `NEEDS TEST`, `BLOCKED`, `STABLE`, `WAITING`, `DONE`, `EMPTY`, `UNSYNCED`) or return to automatic derivation at any time;
- archive and restore projects without deleting their sources or evidence;
- create local/manual projects that can receive sources later.

Manual state never deletes the source-derived state: CONTROL keeps the automatic state as `autoStatus` whenever a status override is active.

The private project note is intentionally excluded from the GitHub Pages public snapshot.

## Source management

CONTROL v0.11 adds a user-owned source assignment layer without deleting provenance.

From the **Sources** tab of **Gérer les projets**, you can:

- see the ChatGPT conversations and GitHub sources attached to a project;
- manually move a ChatGPT conversation to another CONTROL project;
- detach a source so it no longer drives any project state;
- archive and restore a source without deleting its history;
- move a GitHub repository between projects, with the project repo binding moving with it;
- reattach detached sources;
- classify items from **Discovered** directly into the selected project;
- create a new CONTROL project directly from a discovered source.

Manual ChatGPT source assignments survive future Collector updates and are not overwritten by the automatic ownership repair. Archived/detached source evidence is excluded from current derivation and from the public Pages snapshot.

## Drag & drop

CONTROL v0.12 adds direct manipulation on top of the project/source management layer.

On the dashboard:

- drag a project card between **Attention**, **En cours**, **Stables** and **Autres** to apply the matching manual state;
- drag a project between existing **Groupes** to change its group, including **Sans groupe**;
- while a project is being dragged, quick drop actions appear for **Retour en Auto** and **Épingler**.

In **Gérer les projets → Sources**:

- drag an active or detached source onto any project in the left project list to reassign it;
- drag a discovered ChatGPT source onto a project to classify it immediately;
- drag an active source onto the **Détacher la source** zone to remove it from all projects without deleting provenance.

All button/select controls remain available as a fallback. Manual ChatGPT ownership protection from v0.11 still applies after a drag operation.

## Arrange, bulk control and undo

CONTROL v0.13 turns project management into a faster day-to-day workspace:

- **manual order** is persistent: drag a project directly before another card in Columns, Groups or List view;
- moving a project into another status/group now also places it where you dropped it instead of only changing metadata;
- **Gérer les projets** adds multi-selection and bulk actions for state, group, pinning and archive/restore;
- project edits, status/group drags, pin actions, source moves and source archive/restore expose a short-lived **Annuler** action;
- manual order, groups and tags are safe presentation metadata in the sanitized public snapshot; private notes remain excluded.

Existing single-project controls remain available, so bulk and drag actions are an acceleration layer rather than a replacement.

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

CONTROL is a **loopback-only** application; a non-loopback deployment is not supported. All HTTP routes reject unexpected Host values and foreign browser origins. Local dashboard requests use same-origin access, and cross-origin CORS responses are disabled.

For the unpacked Chrome Collector, identify its actual ID in `chrome://extensions`. Direct `npm start` launches must set `SHINO_CONTROL_EXTENSION_ID` to that exact ID; otherwise extension-originated requests are rejected. IDs can vary between machines or unpacked installations. The Windows startup installer can persist this value in its local startup configuration instead of relying on a user environment variable.

`SHINO_CONTROL_TOKEN` adds bearer-token checks to mutations **and `/api/state`**, but this mode is not yet integrated with the dashboard, Windows tray/supervisor, or Collector configuration workflow. Leave it unset for the currently supported local installation; do not mistake loopback binding for protection against untrusted local processes. Cross-origin sites are additionally rejected by Host, Origin, and browser request-metadata checks.

State updates write an fsynced temporary file and atomically rename it into place. `data/state.local.json.bak` keeps the previous valid saved state as a recovery copy. The backup is not automatically restored if the active file becomes corrupt. Core serializes the complete local read/mutate/derive/write cycle per process. GitHub network sync runs on a detached snapshot and merges only GitHub-owned changes into the latest state under the same queue; stale results are discarded if repository ownership changed while syncing. Separate OS processes or external programs writing the same state file are not supported by this in-process queue.

## Windows autonomous startup

On Windows, CONTROL can install a per-user hidden supervisor. It requires no administrator rights.

For a machine that uses the Chrome Collector, pass its extension ID on the first install:

```powershell
npm run startup:install -- -ExtensionId <chrome-extension-id>
```

The ID is stored in `%LOCALAPPDATA%\SHINO-Control\startup.json` and is preserved by later `npm run startup:install` runs, so it only needs to be supplied again if Chrome assigns a different ID. If the ID changes while Core is already running, the installer requests one controlled Core restart so the new origin allowlist takes effect.

If no Collector is used, the installer can still be run without `-ExtensionId`.

The installer:

- stores the current repo path and exact `node.exe` path under `%LOCALAPPDATA%\SHINO-Control`;
- adds a per-user `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` entry;
- launches the supervisor hidden;
- waits for the repo/drive if it is not available yet at sign-in;
- starts CONTROL Core when `http://127.0.0.1:4177/api/state` is down;
- keeps monitoring the Core and restarts Node after an unexpected exit;
- avoids duplicate supervisors and keeps startup/Core logs in `%LOCALAPPDATA%\SHINO-Control`.

Check it at any time:

```powershell
npm run startup:status
```

The status output reports whether the Collector ID is persisted, missing, or only available through the legacy user environment variable.

Remove autostart:

```powershell
npm run startup:uninstall
```

To uninstall and also stop the currently running Core:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/uninstall-startup.ps1 -StopCore
```

If the repository is moved to another path, rerun `npm run startup:install` from the new checkout so the stored path is refreshed.

## Chrome Collector

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
extension/control-collector
```

The extension intentionally exposes no popup. Status is kept internally in `chrome.storage.local` and normal operation is automatic. Collector v0.2.9 loads `collector.js`, `catchup-api.js` and `catchup-client.js` in Chrome's isolated extension world; the previous MAIN-world `catchup-main.js` bridge was removed.

## GitHub Pages

GitHub Pages is the read-only public dashboard. Every push to `main` rebuilds and deploys a sanitized state snapshot through `.github/workflows/pages.yml`.

The public snapshot strips private ChatGPT URLs, project keys and raw evidence while retaining the useful derived card state. A coverage guard prevents a less-complete repository state from replacing a fuller committed public snapshot.

## Derivation

CONTROL combines evidence rather than blindly mirroring the newest event.

Resume Engine prioritizes explicit actionable conversation state and filters code / PowerShell noise. Status Engine derives `ACTIVE`, `STABLE`, `NEEDS TEST` and `BLOCKED`. Dirty-project derivation fingerprints project inputs so unchanged cards are reused instead of recalculated.

## Data

Local mutable state is stored in:

```text
data/state.local.json
```

That file is intentionally ignored by Git. On first start, CONTROL seeds it from the tracked `data/state.json` baseline. Git pulls, branch switches and stashes therefore do not replace the live CONTROL database.

To override the runtime state path explicitly, set `SHINO_CONTROL_STATE`.

The tracked seed remains:

```text
data/state.json
```

The committed sanitized Pages baseline is:

```text
data/state.pages.json
```

`npm run build:pages` generates `dist/` and applies the public-snapshot coverage/privacy gates.
