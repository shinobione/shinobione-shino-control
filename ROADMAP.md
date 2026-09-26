# SHINO // CONTROL Roadmap

_Last updated: 2026-09-26_

CONTROL is evolving from a source-ingestion utility into a reliable, source-derived project radar and resume hub. The roadmap below separates completed foundations from the next engineering priorities.

## Completed foundations

### 1. Source capture, mapping and project ownership

- ChatGPT and GitHub sources are attached to CONTROL projects.
- Manual project/source ownership survives future syncs.
- The old broad inventory/backfill plumbing was retired in favor of the small Chrome Collector plus targeted catch-up.
- Local mutable state is separated from the tracked repository seed.

### 2. Resume and status intelligence

- Resume Engine derives useful restart context from source evidence.
- Status Engine derives project state such as `ACTIVE`, `STABLE`, `NEEDS TEST` and `BLOCKED`.
- Dirty-project fingerprints avoid recalculating unchanged projects.

### 3. User-owned project management

- Project rename, description, notes, tags, grouping, pinning and manual status overrides.
- Source move/detach/archive/reattach flows.
- Drag & drop, manual order, bulk operations and short-lived undo.
- Sanitized public GitHub Pages snapshot keeps private notes and ChatGPT URLs out of the public build.

### 4. Security and runtime hardening

Recent hardening completed:

- **#61** — strict local HTTP boundary, Host/Origin/fetch-metadata checks and atomic state writes.
- **#63** — removed the ChatGPT MAIN-world bridge; catch-up stays in the extension isolated world.
- **#64** — pinned GitHub Actions to immutable SHAs, added `SECURITY.md` and Dependabot.
- **#70** — removed retired CSS and obsolete UI checks.
- **#71** — replaced the monkey-patched dual-server design with one authoritative HTTP server.
- **#72** — Windows startup now persists the Chrome Collector ID and injects it into Core automatically.

## Next priorities

### P0 — Serialized state mutations

Prevent lost updates when two requests mutate `state.local.json` at nearly the same time.

Target design:

- serialize the full `read -> mutate -> derive -> write` transaction, not only the final file write;
- add deterministic concurrency tests that launch overlapping mutations and prove no update is lost;
- keep atomic file replacement and recovery backup behavior;
- handle long-running GitHub sync carefully so external network work does not unnecessarily block all local mutations.

**Exit condition:** concurrent project/source/Collector mutations cannot silently overwrite one another.

### P1 — Review Dependabot major GitHub Actions upgrades

Open major-version PRs currently include:

- **#65** — `actions/configure-pages` 5 -> 6
- **#66** — `actions/deploy-pages` 4 -> 5
- **#67** — `actions/upload-pages-artifact` 3 -> 5
- **#68** — `actions/setup-node` 4 -> 7
- **#69** — `actions/checkout` 4 -> 7

Rules:

- review and test them one at a time;
- do not bulk-merge major upgrades;
- preserve immutable SHA pinning after each upgrade;
- verify both normal checks and Windows/Pages workflows.

### P1 — Decide and finish token mode

`SHINO_CONTROL_TOKEN` exists as an additional local authorization layer, but the supported UI/tray/Collector workflow does not yet configure it end to end.

Decision required:

- either integrate token configuration across dashboard, Collector and Windows startup/tray;
- or explicitly keep token mode unsupported/advanced and simplify the implementation/documentation around that choice.

**Exit condition:** there is one clear, documented and tested security model rather than a half-integrated second mode.

### P2 — Repository/product polish

- Choose and add a **LICENSE** deliberately.
- Fill the GitHub repository **About/description** metadata.
- Keep documentation aligned with the actual supported architecture.
- Continue removing obsolete compatibility paths when their real-world use has been disproved.

## Later product work

After the hardening backlog above is closed, return focus to the intelligence and day-to-day usefulness of the dashboard:

- improve Resume Engine precision where real project evidence exposes weak summaries;
- improve sync/catch-up observability without bringing back heavy inventory plumbing;
- refine project-health diagnostics and recovery UX from real failure cases;
- continue UI polish only where it improves scan speed, confidence or resume workflow.

## Guardrails

The roadmap should preserve these constraints:

- CONTROL remains **loopback-only**.
- Core does not own or automate Chrome cookies/session credentials.
- The Collector remains a small authenticated in-browser sensor, not a second business-logic application.
- Local mutable state must remain outside Git.
- Security fixes and data-integrity work take priority over cosmetic refactors when both compete for attention.
