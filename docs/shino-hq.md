# SHINO // HQ v0.1

One cockpit. All your worlds.

HQ is the private local home of CONTROL. It adds personal tasks, contacts/relances, deliverables and deadlines above the existing project radar. CONTROL Core still owns project identities, states, sources, GitHub synchronization, Resume Engine and Windows startup.

## Windows launch

Node 20 or newer; no installation or new dependency is required.

```powershell
Set-Location 'F:\Google Drive\Musique STUFF\shino-control\shino-control-live'
npm start
```

Open <http://127.0.0.1:4177>. `#hq` opens HQ; `#control` opens CONTROL; `#control/<project-id>` opens the existing project page. If the Windows supervisor already runs CONTROL on 4177, use its existing **Restart CONTROL Core** action after changing to this branch, rather than starting a second writer. No startup configuration is changed by this MVP.

To try disposable, clearly labeled data first:

```powershell
npm run demo:hq
```

Open <http://127.0.0.1:4417>. Demo state persists under ignored `.hq-local/demo-state.json`; it never reads or writes `data/state.local.json`. `npm run demo:hq -- --reset` deliberately recreates only that demo state, saving its previous contents as `.bak`. Stop with Ctrl+C. Demo launches clear GitHub credentials and the Collector ID from that child process, so they cannot ingest real sources accidentally. It is still possible to explicitly press GitHub sync inside DEMO CONTROL; the resulting writes remain in the demo file.

## Daily use

- Choose SHINOBIWAN / MUSIC, SHINO LAB / DEV, FIELD OPS / WORK, or SHINO LIFE / PERSONAL, or view every universe together.
- Quick entry creates a task immediately. **Nouvelle tâche** adds description, project, priority, status, date, source, category and optional expense amount/currency. Categories suggest RISO, Kyocera, other equipment, administration, appointments and promotion.
- A task can be edited, completed, reopened or deleted with confirmation. Concurrent edits to the same revision are rejected instead of silently replacing newer changes; **Actualiser** reloads the local state.
- Priorities exclude completed tasks and sort by P1/P2/P3, earliest calendar date (undated last), status (in progress, todo, blocked, waiting), creation time and stable ID. The dashboard exposes this rule. A date becomes overdue on the following local calendar day.
- Search and universe/status/priority/date filters apply to tasks; tasks also sort by priority, date or newest creation. Contacts search their names, organizations, relationships and notes; date filtering targets the next follow-up. Deliverables filter by universe, status and target date. Project cards group by universe and sort by state, with a separate project-state filter. Counts come from stored data.
- **Contacté aujourd’hui** records the contact date and clears its old follow-up. Plan the next follow-up by editing the contact. Overdue follow-ups and deliverables appear under À traiter.
- Project universe assignments are HQ preferences. They do not change CONTROL source truth. Resume links open the actual CONTROL project; available conversation, PR, commit, repo and CI links reuse stored evidence. Missing CI or issue feeds are labeled unavailable; issue links go to GitHub. Issues are not copied into tasks.
- Studio's shortcut is configured with your explicit URL. Google Drive, Gmail, Calendar, GitHub and the music tools are ordinary links. There is no Google OAuth/sync, Studio catalogue write, banking connection, LLM or voice runtime. Reminders are dashboard dates, not background notifications. Appointment time/details can be recorded in the description; this MVP is not a calendar sync.

## Private persistence and recovery

HQ schema v1 lives under `hq` in CONTROL's existing ignored runtime file, normally `data/state.local.json`. Collections are `actions`, `contacts`, `deliverables`, `activity`, `projectUniverses` and shortcut `settings`. No second project database or backend is introduced. The state store uses the existing fsynced temporary write, atomic rename and previous-valid `.bak`; the mutation queue serializes each read/mutate/write. Stable client IDs make repeated creates idempotent, and revisions prevent stale updates. Missing HQ initializes empty. Invalid/newer HQ schemas fail without overwriting the runtime database.

**Sauvegarder HQ** downloads a private versioned JSON envelope containing HQ and its SHA-256 checksum. **Restaurer HQ** verifies the checksum, supported schema, IDs, dates, URLs and references before writing. It requires confirmation and replaces only HQ. CONTROL projects, sources and evidence keep their current contents. SHA-256 detects corruption; it does not authenticate an untrusted backup's author. The upload limit is 7.5 MB.

Keep downloaded backups outside Git and public/shared folders. The recovery `.bak` is local and is not automatically restored on corruption. Back up HQ regularly. A full-machine recovery must also preserve CONTROL's runtime state: a HQ-only backup intentionally does not recreate missing CONTROL project identities. Multiple OS processes writing the same state file remain unsupported.

## Security and public distribution

The server continues to bind exclusively to 127.0.0.1 with the existing Host, Origin, fetch-metadata, Collector-ID and optional bearer checks. Supported local use still leaves `SHINO_CONTROL_TOKEN` unset; the pending PR #77 proposes retiring that legacy mode separately. HQ does not merge or depend on #77. Do not expose the port through a proxy/tunnel. Untrusted native processes on the same computer are outside CONTROL's security boundary.

The entire HQ object and any unlisted collection/property are excluded from public projection. Public fields have explicit types; arbitrary nested objects are rejected from presentation fields. The fuller committed-snapshot fallback goes through the same projection. The Pages build copies an explicit frontend asset allowlist, not all of `public/`. The frontend code contains no HQ data. Pages retains the read-only CONTROL experience; private forms and HQ collections are not loaded there. CONTROL's previously public project presentation fields retain their existing public meaning.

`npm run build:pages` writes only `dist/`, leaving the committed Pages baseline unchanged. `npm run pages:snapshot` remains the separate explicit baseline-generation command. Privacy tests use synthetic canaries and isolated fixture builds, checking distributed files, fallback JSON and captured build logs. CI receives repository seed data only. No private backup or runtime state is uploaded as evidence.

## Validation

```powershell
npm run check
npm run check:hq
$env:SHINO_CONTROL_STATE = Join-Path (Get-Location) 'data\state.json'
npm run build:pages
Remove-Item Env:SHINO_CONTROL_STATE
```

The full check includes all existing CONTROL checks plus four HQ suites: model/migration/validation/priorities/backup/GitHub merge preservation; live HTTP concurrency and process restart; safe rendering/UI contracts; public artifact and build-log privacy. Tests start isolated loopback servers on temporary state files and never mutate normal personal data.

Observed local validation on 2026-10-15: all check suites and the public build passed on Windows / Node 24.19.0. Browser QA used DEMO data only: four-universe creation, edit/complete/reopen/search, reload persistence, contact/relance, deliverable, CONTROL navigation, download and checksum-verified restore. Layouts were inspected at 3440×1440 and 1440×1000; CI additionally validates Node 20 on Linux and the Windows tray build. See the delivered PR checks for results on the exact commit; local checks alone do not imply CI success, deployment or owner acceptance.

DEMO-only screenshots: [desktop 1440×1000](evidence/shino-hq-demo-desktop.jpg), [ultrawide 3440×1440](evidence/shino-hq-demo-ultrawide.jpg). No horizontal document/sidebar overflow or browser warning/error was observed at those tested widths.

Priority owner checks:

1. Run DEMO, create a task in each universe, close/relaunch DEMO and find all four again.
2. Check P1/P2/P3 and yesterday/today/tomorrow dates, then open a resume link and the original CONTROL project/source manager.
3. Download a DEMO backup, edit a task, restore the backup, and verify its former value returns while the CONTROL project remains intact.

## Future integration point

SHINO-OS could later read a deliberately scoped, owner-approved HQ projection through the same local Core boundary. No endpoint for an autonomous agent, voice runtime, paid service, background notification engine or outbound automation is introduced in v0.1.
