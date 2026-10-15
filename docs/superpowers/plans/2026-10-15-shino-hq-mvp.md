# SHINO HQ Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task, followed by one independent whole-branch review.

**Goal:** Deliver a private, persistent personal HQ on top of CONTROL in a Draft PR.

**Architecture:** Add a versioned private HQ object to the existing runtime state. Use Core's mutation queue and atomic store; share browser-safe selectors with Node tests. Keep CONTROL's public UI and project/source ownership intact.

**Tech Stack:** Node >=20 built-ins, browser ES modules, CSS, existing GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-15-shino-hq-design.md`

## Global Constraints

- Existing loopback-only HTTP server, default `http://127.0.0.1:4177`.
- No dependencies, subscriptions, paid APIs, OAuth, other repository edits, live personal state edits, merge or deployment.
- Private data stays in ignored local runtime state; strict public allowlists.
- Finish autonomously through Draft PR and exact-head CI, as explicitly requested.

## Review Focus

- Malformed/newer HQ schema and corrupted backups must never erase existing state.
- Repeated or concurrent submissions must preserve all writes and stable IDs.
- Local calendar dates, overdue boundaries and equal-priority ties must be deterministic.
- User HTML and unsafe/credentialed URLs must never execute or navigate unsafely.
- Public fallback and unlisted public-directory files must never bypass projection/copy allowlists.

### Task 1: HQ model and persistence API

**Files:** `lib/hq-store.mjs`, `lib/hq-backup.mjs`, `public/hq-model.js`, `server-entry.mjs`, `scripts-hq-check.mjs`, `scripts-hq-http-check.mjs`.

**Interfaces:** `ensureHq(state)` initializes/validates; `mutateHq(state, {collection,operation,id,values})` validates and mutates; `buildHqBackup(hq)` / `restoreHqBackup(state,backup)`; browser selectors `selectActions`, `selectPriorities`, `projectUniverse`, `isOverdue`, `selectDeadlines`.

- [ ] Write failing tests for migration preservation, four-universe CRUD, validation, ID dedupe, complete/reopen, date/priority filters, backups and sync preservation. Run `node scripts-hq-check.mjs` and observe failure.
- [ ] Implement pure selectors, validated model and integrity-checked backups.
- [ ] Add GET `/api/hq`, GET `/api/hq/backup`, POST `/api/hq/mutate`, POST `/api/hq/restore` inside existing guards/queue. Return sanitized validation errors.
- [ ] Add HTTP tests for persistence after process restart, concurrency, Host/Origin guards, confirmed deletion and corrupt restore rejection. Run both HQ suites to PASS.
- [ ] Commit the model/API slice after validation.

### Task 2: HQ interface

**Files:** `public/hq.js`, `public/hq.css`, `public/index.html`, `public/app.js`, `scripts-hq-demo.mjs`, `scripts-hq-ui-check.mjs`.

**Interfaces:** `mountHq({state,root,onControl})`; module owns form state, navigation and refresh; Core remains the sole persistence authority. CONTROL links use `#control` and project hash IDs.

- [ ] Add failing UI contract checks and run them before implementation.
- [ ] Build dashboard, four universes, task/CRM/deliverable forms and list operations, search/filters/sorting, real project/resume/evidence links and shortcut settings.
- [ ] Add backup/restore confirmation, safe text/link rendering, focus/error handling and empty states. Preserve CONTROL access and static Pages behavior.
- [ ] Add an isolated DEMO launcher; run UI checks and browser QA at ultrawide/conventional widths with demo-only data.
- [ ] Commit the UI slice after verification.

### Task 3: Public privacy and delivery

**Files:** `lib/public-snapshot.mjs`, `lib/public-artifacts.mjs`, `scripts/build-pages.mjs`, `scripts/generate-pages-snapshot.mjs`, `scripts-hq-privacy-check.mjs`, `package.json`, `.github/workflows/check.yml`, documentation.

**Interfaces:** `buildPublicSnapshot` remains strict-field projection; `PUBLIC_ARTIFACTS` explicitly lists distributable assets. Public coverage fallback is reprojected before publication.

- [ ] Add and run failing canary tests against projection, fallback, captured build logs and distributed artifacts.
- [ ] Implement strict asset copies and fallback reprojection; wire HQ tests into `npm run check` and CI.
- [ ] Run full regression suite, syntax checks, Pages build and demo browser checks. Record actual evidence and limitations in `docs/shino-hq.md`.
- [ ] Obtain an independent review, fix significant findings with failing-then-passing regression tests, verify final diff and private-file exclusion.
- [ ] Commit, push dedicated branch, open and attach Draft PR; inspect all CI results for exact delivered SHA. Do not merge/deploy.
