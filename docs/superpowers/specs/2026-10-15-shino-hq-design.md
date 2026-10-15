# SHINO HQ v0.1 design

The supplied mission is the product brief and authorizes autonomous implementation through a Draft PR, without intermediate design approvals. This is an architectural extension of CONTROL, implemented in the existing checkout on `feature/shino-hq-mvp`.

## Foundation

Base: `origin/main`, `f2345788d8f690df6d11b7d27ce2b6d385b04c27`. PR #77 is OPEN/DRAFT at `07e9ed2ceee35cdc13cb2ac37fbdcc00b53ea9d7`, with check/compile-tray SUCCESS when inspected. Its proposed retirement of bearer mode is independent, unmerged work; HQ retains main's existing authorization and loopback/Host/Origin guards. No startup installation, live data edits, other repository edits, merge or deployment.

## Architecture and data

Node built-ins, native browser modules and existing Core only; no new dependencies or cloud. The existing atomic state store and serialized mutation queue own all writes. Add one private `hq` object with `schemaVersion: 1`, `actions`, `contacts`, `deliverables`, `activity`, and a project-universe mapping keyed by existing CONTROL project IDs. Do not copy projects or GitHub issues. Absent HQ data initializes empty; invalid/unsupported schemas fail without replacing data. IDs are client-generated UUIDs with idempotent creates; conflicting IDs fail. Updates validate completely before changing state. User strings have length limits; external links allow HTTP(S) without embedded credentials. Unknown properties are not accepted as stored fields.

Actions: title, description, MUSIC/DEV/WORK/PERSONAL, optional existing projectId, P1/P2/P3, TODO/IN_PROGRESS/WAITING/BLOCKED/DONE, createdAt, updatedAt, dueDate (calendar date), closedAt, sourceUrl, category, optional decimal expense amount/currency for personal tracking. Contacts: name, organization, universe, relationship, lastContactDate, followUpDate, note, externalUrl. Deliverables: title, existing projectId, universe, type, status (TODO/IN_PROGRESS/BLOCKED/DONE), targetDate, sourceUrl. WORK categories include RISO/Kyocera/Other; generic references only. Activity records IDs, operation, entity type and time, without copying private text.

Recovery/concurrency clarification from independent review: schema v1 includes a generation UUID, added compatibly when absent and rotated on restore. Mutations carry that generation as well as row revisions. Accepted HQ JSON is bounded to 6,000,000 UTF-8 bytes; compact backups stay below the 7,500,000-byte import and 8,000,000-character HTTP limits. Mutation candidates are validated before replacing live collections, so capacity rejection cannot persist an unreadable state.

Backups export only the entire private HQ object in a versioned envelope with SHA-256 integrity checksum. Restore verifies checksum, schema, IDs and project references before replacing HQ, with an explicit UI confirmation; existing CONTROL projects/sources/evidence remain untouched. Core's `.bak` also covers HQ. Backups remain local downloads, never public assets.

## Product

Default local home becomes HQ; CONTROL remains a direct navigation destination, retaining its current UI, project manager, drag/drop and sync. HQ has four universe views and dashboard/tasks/contacts/deliverables/activity navigation. Real empty states, quick action entry, full editable forms, complete/reopen, confirmed delete, search and universe/status/priority/date filters and sorting.

Priorities exclude DONE, sort P1 then P2 then P3, earliest due date (undated last), actionable TODO/IN_PROGRESS then BLOCKED then WAITING, createdAt and ID as deterministic ties. At most three, with a visible explanation. Overdue is a date before today's local calendar date; due today is not overdue. Dashboard combines pending/blocked/overdue actions, blocked CONTROL projects, upcoming action/contact/deliverable dates, existing derived resume context and source links. Universe assignment defaults from CONTROL metadata and is locally editable without modifying source truth. Dev evidence uses existing stored GitHub data, with missing feeds labeled unavailable. Quick links are ordinary explicit destinations, including configurable Studio URL; no Google/Studio synchronization or OAuth is implied. Reminders are dashboard dates, not background notifications.

Dark, compact, accessible interface, responsive at 3440x1440 and conventional desktop/mobile widths. Forms have labels, status announcements and visible focus. User text is escaped; links are validated again on rendering. No fake metrics or implicit demo data. Demonstration mode runs against a separate, clearly labeled state file.

## Public boundary

HQ never participates in public derivation or projection. Public JSON is rebuilt from a strict field allowlist, including the committed-coverage fallback. Distribution copies an explicit allowlist of frontend assets only; no whole-directory copy. Public Pages stays CONTROL in read-only mode and does not load HQ collections or private forms. Canary tests exercise HQ collections, unknown fields, fallback, artifact files and captured build logs. Private files, screenshots with live data, downloads and backups stay ignored/outside the repository.

## Acceptance

Automated model, restart/persistence, backup/restore, invalid input, priority/date, HTTP boundary/concurrency, GitHub merge preservation and public artifact tests; all existing CONTROL checks and Pages build. Browser QA uses only explicit DEMO data on an isolated loopback port, with desktop/ultrawide captures. Delivery is commits + push + Draft PR + observed exact-head CI, with Windows launch instructions and honest limitations. Final acceptance of the live personal workflow remains with the owner.
