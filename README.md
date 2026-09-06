# SHINO // CONTROL

A **source-derived project radar and resume hub** for SHINO projects. It is intentionally not a Trello clone.

For each project, CONTROL answers:

- What is the actual current state according to evidence?
- What happened last?
- What is the safest / most likely next step?
- Where do I click to resume: ChatGPT, a GitHub PR, repo, or live site?
- Why did CONTROL infer this state?

## Run

Requires Node 20+.

```bash
npm start
```

Open: `http://127.0.0.1:4177`

No npm install is required; the MVP uses only Node built-ins and browser APIs.

## Current seeded source snapshot

The repository ships with a dated imported evidence snapshot for:

- SUNO BRIDGE
- SHINO-OS
- STUDIO
- FRENCH TRANQUILLE
- RISOTOOLS / SHINOASTEA
- TOUCH+ REVIVAL
- SHINOBIWAN LAUNCHPAD
- SHINOBIWAN Music (marked ChatGPT UNSYNCED until a real thread URL is captured)

Seeded GitHub evidence is not presented as a live connection. Use **Sync GitHub** to refresh it.

## GitHub sync

Public repositories can be queried without a token, subject to GitHub rate limits. For private repositories such as LaunchPAD, use a fine-grained GitHub token with read access.

Best option:

```bash
# PowerShell
$env:GITHUB_TOKEN="github_pat_..."
npm start
```

Or paste a token into the Sources page for a single sync. The token sent in that request is not written to disk by CONTROL.

The adapter reads recent commits, PRs, the latest workflow run, and truth files when present:

- `PROJECT_STATE.md`
- `PROJECT-STATE.md`
- `ROADMAP.md`
- `README.md`

## ChatGPT ingestion

The local endpoint is:

```text
POST /api/ingest/chatgpt
```

Install the extension in `extension/shino-sync` to capture real ChatGPT thread URLs and current transcript evidence.

Chrome extension **v0.1.1** removes an invalid Manifest V3 permission and auto-saves the current toggle/endpoint before a manual sync, so checking **Auto-sync this browser** and clicking **Sync this chat now** works without a separate Save step.

Unauthenticated ingestion is accepted only from loopback when `SHINO_SYNC_TOKEN` is unset. For remote deployment, set a token:

```bash
SHINO_SYNC_TOKEN="a-long-random-secret" npm start
```

## Derivation rules

The engine combines evidence instead of blindly mirroring the newest PR:

1. newer explicit acceptance / merge / closeout beats older draft intent;
2. `SUPERSEDED`, `supersedes`, `DO NOT MERGE`, `no longer authorized` reduce resume priority;
3. `REAL USER PASS` / `PHYSICAL PASS` can close a gate;
4. `PENDING`, `NEXT`, `REQUIRES LIVE TEST`, `PHYSICAL GATE` point to likely resume actions;
5. multiple evidence events contribute to project-level state;
6. **Why this state?** exposes the evidence used.

## Data

The MVP stores its current state in `data/state.json`. It is deliberately simple and auditable. A later deployment can swap this for Postgres/Supabase without changing the project/source/evidence model.
