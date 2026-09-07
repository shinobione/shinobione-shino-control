# SHINO // CONTROL

A **source-derived project radar and resume hub** for SHINO projects. It is intentionally not a Trello clone.

For each project, CONTROL answers:

- What is the actual current state according to evidence?
- What happened last?
- What is the safest / most likely next step?
- Where do I click to resume: ChatGPT, a GitHub PR, repo, or live site?
- Why did CONTROL infer this state?

## v0.3.0

SHINO Sync can now backfill the ChatGPT project structure instead of requiring every conversation to be opened manually.

It supports:

- current ChatGPT conversation sync;
- all currently open ChatGPT tabs;
- discovery of pinned ChatGPT projects;
- project-page conversation discovery and one-by-one backfill;
- ChatGPT project metadata on each synced thread;
- stable thread mappings once a project has been learned;
- uncertain threads routed to **Discovered** instead of guessed;
- first-class extension tracking.

Current extension projects include:

- **SUNO BRIDGE** — repository-level extension project;
- **SHINO Sync** — tracked from `extension/shino-sync` inside this repository, including path-specific commits and its extension manifest version.

Current ChatGPT project aliases include SHINOBIWAN STUDIO, Music, LaunchPAD PWA, Riso, Shino Codes, Shino-OS and Aide avec mon ex conjointe. Conversation titles still override a broad project-container match when they strongly identify a more specific project, e.g. `Site de suivi projets` → SHINO // CONTROL inside Shino Codes.

## Run

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

Useful buttons in **SHINO Sync v0.3.0**:

- **Sync this chat now**
- **Sync ALL open ChatGPT tabs**
- **Backfill ALL pinned ChatGPT projects**

Pinned-project backfill discovers project links from the ChatGPT sidebar, opens project pages temporarily, discovers their conversation links and syncs those conversations into CONTROL. A safety cap limits one run to 200 discovered conversations.

Unauthenticated ingestion is accepted only from loopback when `SHINO_SYNC_TOKEN` is unset. For remote deployment, set a token.

## Derivation rules

The engine combines evidence instead of blindly mirroring the newest PR:

1. newer explicit acceptance / merge / closeout beats older draft intent;
2. `SUPERSEDED`, `supersedes`, `DO NOT MERGE`, `no longer authorized` reduce resume priority;
3. `REAL USER PASS` / `PHYSICAL PASS` can close a gate;
4. `PENDING`, `NEXT`, `REQUIRES LIVE TEST`, `PHYSICAL GATE` point to likely resume actions;
5. multiple evidence events contribute to project-level state;
6. **Why this state?** exposes the evidence used.

## Data

Current state is stored in `data/state.json`. The model stays deliberately simple and auditable so the storage layer can later be swapped for Postgres/Supabase without changing the project/source/evidence model.
