# Watch Tracker

Watch Tracker is an installable web app for tracking films and television episodes, including release reminders and cross-device library syncing.

## What each project item is for

| Path | Purpose |
| --- | --- |
| `index.html` | The website shell. Browser logic and styling live in `assets/`; script order is explicit and startup runs last. |
| `manifest.webmanifest` | Installation details used when the site is added to a phone or computer as an app. |
| `sw.js` | The service worker that receives episode-release notifications and opens notification links only inside Watch Tracker. Its short conventional name is referenced by the app. |
| `.github/workflows/pages.yml` | Stages the runtime website files and assets and publishes only those files to GitHub Pages with the Node.js 24-compatible checkout, Pages, artifact, and deploy actions. |
| `supabase/functions/watchlog-pin/` | Handles secure PIN access, revision-checked syncing, maintenance enforcement, and the safe title-search gateway. The directory name is also the function's public endpoint name. |
| `supabase/functions/watchlog-reminders/` | Stores notification subscriptions and sends scheduled episode reminders. The directory name is also the function's public endpoint name. |
| `supabase/migrations/` | Reproduces the PIN and background-reminder backends and records maintenance, atomic lockout, and conflict-safe sync changes. |
| `tests/` | Checks sorting, search, saving, and the files published to the site. |

## Repository layout

```text
Watched-Tracker/
├── .github/
│   └── workflows/
│       └── pages.yml
├── supabase/
│   ├── functions/
│   │   ├── watchlog-pin/
│   │   │   └── index.ts
│   │   └── watchlog-reminders/
│   │       └── index.ts
│   └── migrations/
│       ├── 20260903_add_watchlog_maintenance_mode.sql
│       ├── 20260904000100_create_pin_backend.sql
│       ├── 20260904000200_harden_watchlog_sync.sql
│       └── 20260908000100_create_push_backend.sql
├── index.html
├── manifest.webmanifest
├── sw.js
└── tests/
```

Every tracked file is part of the running app, its deployment, or the reproducible backend. There are no generated build folders, dependency folders, or obsolete duplicate files committed to the repository.

## Deployment

Changes pushed to `main` are automatically deployed to GitHub Pages. During deployment, the workflow creates a temporary `_site` directory containing the HTML shell, generated build metadata, gallery files, `assets/`, manifest, and notification worker; repository documentation, workflow configuration, and Supabase source files are not included in the website artifact.

The Supabase functions and migrations are backend components and are deployed through Supabase separately. They are never part of the GitHub Pages upload.

After Pages successfully deploys, `scripts/notify-deployment.mjs` verifies that both the HTML and build metadata serve the new commit, then broadcasts a public deployment hint through Supabase Realtime. Open foreground apps subscribe using `assets/js/deployment-channel.js` and verify same-origin build metadata before reloading. No recurring version polling is used; WebSocket heartbeats only keep the transport alive. Hidden/offline apps disconnect and check on return. Editor and episode-tracker sheets, pending saves and failed saves defer refresh. The channel contains only a commit SHA and uses a publishable key; public messages cannot choose a reload URL or supply executable content. The notification worker remains independent of this foreground connection.

The push-backend migration creates the four private reminder tables and seeds one configuration row. Existing configuration, VAPID keys, and subscriptions are preserved. The first `public_key` request generates VAPID keys. For a new environment, configure a scheduler to POST `{"action":"process"}` to `watchlog-reminders` every minute, with `x-watchlog-cron` set to the configuration row's generated `cron_secret`. Keep that secret in the scheduler's private configuration. Configure the Supabase function secrets `WATCHLOG_OWNER_EMAIL` and `WATCHLOG_GITHUB_TOKEN` for private workflow-status notifications; use a read-only GitHub token with Actions read access, and do not commit either secret to source. The workflow token is never forwarded to Supabase. The original push-table migration does not create a scheduled job; the later reminder reconciliation migration provisions the one-minute `watchlog-background-reminders` job through `watchlog_trigger_reminder_scan()`. The follow-up scan-timeout migration lets that HTTP request wait for normal regional feed processing to finish. Existing installations with manually provisioned tables should compare their schema before applying it: `CREATE TABLE IF NOT EXISTS` does not reconcile existing column or constraint differences.

Use Node.js 24 for local development and tests, matching both CI workflows. Some tests use `node:module`'s `stripTypeScriptTypes`, which is unavailable in Node.js 20. The supported version is declared in `package.json` and `.nvmrc`.

With nvm installed, run these commands from the repository directory:

```sh
nvm install
nvm use
npm ci
npm test
```

Without nvm, select a Node.js 24 installation before running `npm ci` and `npm test`. The deployment workflow runs the application checks before publishing.

## Browser code

The files in `assets/js/` are ordered classic scripts sharing the existing app scope. Keep their order in `index.html`; `editor.js` starts the application after all definitions load.

- `app-core.js`: state, DOM references, navigation, dates, appearance and common helpers.
- `reminders.js`: notification setup, maintenance, and local cache primitives.
- `sync.js`: persistence queues, conflict handling, account sessions, metadata refresh and sorting.
- `library.js`: released/watched episode rules, episode tracker, library rendering and filters.
- `catalogue.js`: title identity, search providers and release verification.
- `dashboard.js`: next released episode, seven-day calendar and private reminder activity.
- `discovery.js` and `assets/css/discovery.css`: the Search tab and Add show/film entry point, with poster results, format filters, expandable descriptions, title details and duplicate labels. Search reuses the authenticated catalogue and opens the existing editor before saving; manual entry remains available.
- `editor.js`: title search interaction, editing and startup.
- `assets/css/`: base app styles and dashboard styles.

The dashboard uses the tracker's released-episode map and never treats announced episode totals as released. The calendar shows today plus six days, preserves unknown times and labels saved platforms separately from confirmed UK availability. Private reminder activity is authorized by the existing owner hash in the reminder function, after session validation; every query is scoped to that session account. No schema change is required. Send success means accepted by the push service, not confirmed phone delivery.

## Browser regression checks

`npm ci`, `npx playwright install --with-deps chromium webkit`, then
`BROWSER_ENGINES=all npm run test:browser` exercises the real mobile layout in
Chromium and WebKit. The checks mock all external services and use a separate
test account, so they never change production libraries or send notifications.
Both browser engines must pass before GitHub Pages can publish.

Refresh saves the current library locally and synchronizes it to the cloud before
reloading. Failed synchronization pauses refresh; incomplete editor forms stay
open. Episode rows toggle individual released episodes, Watch next fills the
earliest unwatched gap, and a six-second Undo reverses the latest action.
Release reminders use “Watch Tracker Reminder” with the title and timing in the
body. Supporting installed apps show a reminder badge dot while unopened;
private tests do not set a badge, and reopening the app clears it.

## Granular sync, offline use and recovery

`watchlog_pin_titles` is the canonical per-account, per-title store. Clients derive field and watched-episode changes from their acknowledged baseline; `watchlog_patch_library` locks the account revision, applies the batch atomically and returns only an acknowledgement. Revision conflicts still use the existing field/progress rebase and durable IndexedDB save queues. Legacy full-library clients are supported by the account endpoint. The original JSON snapshot is retained for rollback, and mirrored only during the two-function rollout; `watchlog_storage_config.canonical` disables that transitional mirror after verification. Reminder scans read canonical rows and use the same guarded writer for metadata.

Recovery codes are optional and must be saved outside the app. Account & Sync requires the current PIN before issuing or replacing a code. Only a SHA-256 hash of a cryptographically random 128-bit code is stored. Recovery is rate limited through the account lockout, replaces the PIN and code, and revokes all existing sessions in one database transaction. The new code is shown once; plaintext codes and PINs are never written to browser storage. Recovery cannot replace a code that was never created or saved.

The build creates `asset-manifest.json` and versions the service worker. Installation precaches the matching HTML, JavaScript, styles, icons and manifest as a complete shell before activation. API responses and deployment checks are never service-worker cached. On-device Library state remains in the account-scoped IndexedDB cache, including unsynced changes. `tests/browser/upgrade.cjs` checks offline reopen, edit, reopen and reconnect using mocked accounts in both browser engines.

Navigation uses hash URLs so direct links work on GitHub Pages and offline. `navigation.js` owns browser history and view restoration; `features.js` owns Continue Watching, collections, recovery controls and offline readiness. Archived titles remain in the Library and retain their watch history and explicit reminder preferences. Custom lists are stored on their member titles.

Cross-device sync checks the account revision every 10 seconds while the app is visible, and immediately on focus, return and reconnection. Matching revisions return a small authenticated acknowledgement. Changed revisions rebase local edits before updating the device cache and open tracker; active notes drafts are retained. Upload failures retry with exponential backoff capped at roughly one minute. Hidden/offline apps pause checks, and revoked sessions preserve device edits until reauthentication. An expired session never silently discards the device queue.

`tests/browser/sync.cjs` runs independent Chromium and WebKit sessions for the same account, including simultaneous writes, offline closure/reopening, server errors, committed writes whose responses are lost, session revocation, notes drafts and stale edit forms. Each browser retains its own storage. Unit tests also cover stale replies, account switching and failed device writes.

Granular saves have transactional, account-scoped write receipts. The endpoint hashes the revision and exact mutation; the receipt and title changes commit under the same revision lock. Repeating an accepted request returns its original acknowledgement even if another device has since edited the title. Receipts store only a hash and accepted revision, remain private to the service role, and are removed with the account. This prevents an uncertain create or edit from overwriting later device changes during a retry.

### Film and series detail sources
Details use the authenticated `catalog_details` endpoint. IMDb structured metadata is preferred when accessible. Series fall back to the selected TVMaze ID (cross-checked against IMDb); films can use a unique Apple TV catalogue match against the IMDb title and release year. JustWatch fallback requires the exact IMDb identity and film/series format. Source links and rating-provider labels accompany the displayed details. Provider failures have bounded timeouts, do not become successful cache entries, and can be retried. Wikipedia and Wikidata are never queried; the browser policy blocks those connections. No paid metadata subscription is required.

### Library-first search
The Library search field and the bottom-right magnifying glass open the same full-screen Search page. The fixed bottom island contains Library and Settings, with a temporary Search tab only while Search is active. The page covers the full viewport, keeps its results scrollable above the keyboard and island, and restores Library scroll when closed.

The Search page matches saved titles immediately, including title words, platform, IDs and custom lists. It opens saved records directly and works without a global request. Global search runs after a 350 ms pause when there are no local matches in the selected format, or when Search all titles is selected. Library results stay above the streamed catalogue, with saved-title duplicates removed. Full verified descriptions load when a result is opened.

Duplicate checks use either shared IMDb or TVMaze identity, including when the other provider ID is stale. The cloud rejects duplicate additions from older clients; current clients reconcile simultaneous additions into the original record and preserve watched episodes, history, notes, lists and reminder preferences. Different provider identities and release years keep distinct remakes separate.

### GMT release times
All release clocks, calendar days, date entry and reminder delivery use GMT (UTC) throughout the year, independent of device location or daylight saving. There is no viewing-region or timezone setting. Streaming availability uses UK listings. Marshals uses Monday 08:00 GMT on Paramount+, including previously saved Monday dates.

### Device power and background activity
On the phone, full regional schedule downloads start when a schedule is opened. Leaving it or hiding the app cancels the remaining phone queue. Metadata and artwork queues stop starting new jobs while hidden; writes already in progress finish so edits remain safe. Maintenance and reminder repair timers are scheduled only when needed and stop while hidden or offline.

The backend independently refreshes episode metadata and regional streaming listings, then checks and sends due reminders every minute for accounts with enabled push subscriptions. It does not require an open app or calendar screen. The shared schedule engine has no browser visibility condition on the server. Closing the app therefore stops its display work while the backend continues. Notification permission and an enabled subscription are still required. The scheduler HTTP deadline is 60 seconds so a normal rate-limited scan can return its result; the one-minute job frequency is unchanged.

Foreground sync remains at ten seconds while a tracker is open, after interaction, or with pending edits. Unchanged idle libraries gradually back off to one minute and check again on return. Hidden schedule pages are not rebuilt. Poster cards use provider thumbnails where available, retain lazy visibility-based loading, and release observers for replaced grids. Native notification links are handled by events rather than a repeating timer. Release notifications remain managed by Web Push or iOS local notifications.
