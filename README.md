# SHINO // CONTROL

A **source-derived project radar and resume hub** for SHINO projects. It is intentionally not a Trello clone.

For each project, CONTROL answers:

- What is the actual current state according to evidence?
- What happened last?
- What is the safest / most likely next step?
- Where do I click to resume: ChatGPT, a GitHub PR, repo, or live site?
- Why did CONTROL infer this state?

## GitHub Pages

The dashboard is deployable directly from this repository with GitHub Actions.

Live site target:

`https://shinobione.github.io/shinobione-shino-control/`

Every push to `main` rebuilds the static dashboard from `data/state.json` and deploys it through `.github/workflows/pages.yml`. The Pages build uses the same derivation engine as the local server.

On GitHub Pages the dashboard is intentionally **read-only**: repository state is the source of truth and mutation endpoints such as GitHub sync/remap are disabled in the static UI. The local Node server remains available for development/ingestion workflows when needed, but it is no longer required just to view CONTROL.

## v0.9.0

GitHub Pages hosting is now first-class:

- static site build via `npm run build:pages`;
- automatic deployment on every `main` push;
- relative frontend assets so the app works under the repository Pages path;
- `/api/state` transparently mapped to the deployed repository snapshot;
- write/sync controls disabled on the static site;
- the same `deriveAll()` engine generates the published radar state.

## Run locally

Requires Node 20+.

```bash
npm start
```

Open: `http://127.0.0.1:4177`

No npm install is required; the MVP uses only Node built-ins and browser APIs.

## GitHub sync

Public repositories can be queried without a token, subject to GitHub rate limits. For private repositories, use a fine-grained GitHub token with read access.

```powershell
$env:GITHUB_TOKEN="github_pat_..."
npm start
```

The adapter reads recent commits, PRs, workflow state and truth files. Component projects may define a repository path; SHINO Sync, for example, only consumes commits touching `extension/shino-sync` and reads its own `manifest.json` rather than treating every CONTROL commit as extension activity.

## ChatGPT ingestion

Local endpoint:

```text
POST /api/ingest/chatgpt
```

Load the Chrome extension from `extension/shino-sync`.

SHINO Sync can capture current ChatGPT conversations and maintain the project inventory used by CONTROL. GitHub Pages itself does not expose a public ingestion endpoint; publication happens from repository state.

Unauthenticated local ingestion is accepted only from loopback when `SHINO_SYNC_TOKEN` is unset. For any remote ingestion backend, require authentication.

## Derivation rules

The engine combines evidence instead of blindly mirroring the newest PR:

1. newer explicit acceptance / merge / closeout beats older draft intent;
2. `SUPERSEDED`, `supersedes`, `DO NOT MERGE`, `no longer authorized` reduce resume priority;
3. `REAL USER PASS` / `PHYSICAL PASS` can close a gate;
4. `PENDING`, `NEXT`, `REQUIRES LIVE TEST`, `PHYSICAL GATE` point to likely resume actions;
5. multiple evidence events contribute to project-level state;
6. **Why this state?** exposes the evidence used.

## Data

Current state is stored in `data/state.json`. `npm run build:pages` derives it and writes the static deployment into `dist/`; `dist/` is generated and not committed.

The storage model stays deliberately simple and auditable so it can later be swapped for Postgres/Supabase without changing the project/source/evidence model.
