## 2026-10-22 — Wait for Track Sync to finish in browser checks
- Run #305 confirmed the Settings navigation tests pass but exposed a race between the Track Sync request and the following refresh scenario.
- The smoke test now waits for the real sync action to finish before continuing.

## 2026-10-22 — Scope Settings browser assertions to active panels
- Corrected the Account & Sync browser assertion to target its panel rather than matching hidden `.profile-card` elements in other categories.
- Made the Track Sync check wait for the intercepted cloud request before asserting it completed.

## 2026-10-22 — Fix Settings browser smoke test and verify Track Sync
- Scoped Settings back-button checks to the active category after run #303 exposed Playwright's strict-mode ambiguity across the three hidden panels.
- Added browser coverage proving the Track Sync shortcut requests the cloud library rather than only displaying the Settings menu.
- Preserved the separate browser-engine checks and deployment gate.

## 2026-10-22 — Allow slow Playwright dependency setup to complete
- Increased both Actions job limits from 10 to 30 minutes after runs #302 attempts 1 and 2 timed out while Ubuntu's package mirror downloaded Playwright's 142 MB dependency set.
- The cancellation happened during browser setup before application tests or deployment; no source-test failure was reported for those attempts.
- Kept Chromium and WebKit checks enabled and gated deployment on their results.

## 2026-10-22 — Repair Settings navigation and reminder activity regression
- Restored Reminder activity and its View activity dialog inside Settings so existing event handlers do not target missing DOM elements.
- Preserved required release-note history for the actual workflow run number/attempt and library export plus merge-based restore.
- Updated mobile browser smoke tests to navigate General, Release Reminders, and Account & Sync individually and verify their actual controls.
- Kept the iOS-style Settings landing page and Track Sync shortcut.

## 2026-10-22 — Use Settings as the screen title
- Renamed the Preferences heading and navigation accessibility label to Settings, including each category's back-to-Settings action.

## 2026-10-22 — iOS-style Preferences menu and settings drill-in
- Replaced the flat settings screen with a rounded, grouped Preferences menu inspired by the supplied reference, adapted to Watch Logger's implemented features.
- Added General, Release Reminders, and Account & Sync category rows that open their real settings panels, with a back-to-Preferences action.
- Added a Track Sync shortcut wired to the existing Sync Now handler. Unimplemented promotional and placeholder entries are omitted.
- Bumped the app stylesheet cache key; existing setting IDs and handlers are preserved.

## 2026-10-22 — Fix prior releases and refine Preferences
- Removed the Enhance Your Experience promotional panel from Settings as requested.
- Refined Preferences to match the supplied iOS reference more closely: large bold heading, rounded grouped charcoal cards, normal-case section titles, and subtle separators while preserving Watch Logger's real controls.
- Added mobile layout safeguards for prior-release rows so title and episode/date metadata keep usable widths instead of wrapping every few characters.
- Bumped the app stylesheet cache version.

## 2026-10-22 — Retry combined pending Watch Logger updates
- Requeued the latest Preferences redesign together with the existing PNG app icon and title-detail layout/action changes after runs #296 and #297 did not deploy.
- Fixed release-note regression coverage by restoring the required actual run number/attempt and library export/merge-based restore descriptions.
- This commit changes release metadata only; it does not bypass any tests.

## 2026-10-22 — Screenshot-inspired Watch Logger Preferences
- Restyled the existing Settings screen with a bold Preferences heading, a restrained gradient overview card, rounded grouped panels, and subtle row dividers inspired by the reference screenshot.
- Adapted the layout to Watch Logger's real operations only: appearance, background release reminders, account/cloud sync, PIN changes, and sign-out. No fake App Icon, review, support, or other placeholder destinations added.
- Preserved existing control IDs and handlers, and bumped the app stylesheet cache version.

## 2026-10-22 — Repair title detail layout and three-dot menu
- Corrected the mobile detail header and poster sizing, and restored readable season-card proportions.
- Positioned the existing Edit, Notes, and Delete actions as a fixed menu near the three-dot button so it stays visible above the long episode list.
- Kept notes and deletion wired to the existing persistence/rollback handlers, and bumped the gallery stylesheet cache key.

## 2026-10-22 — Double-tap zoom and deployment-check repair
- Bumped the app stylesheet cache key so the global `touch-action: manipulation` rule disabling double-tap zoom is fetched instead of reused from cache.
- Kept pinch-to-zoom and normal panning available; no viewport scaling restrictions added.
- Updated current release notes to satisfy the regression checks for actual workflow run number/attempt and library export/merge-based restore coverage.

## 2026-10-22 — Repair settings layout test entity handling
- Fixed the regression test to compare decoded HTML text, so the valid `Account &amp; Sync` markup is correctly recognised as the visible “Account & Sync” label.
- Kept the consolidated Settings sections and account controls unchanged.

## 2026-10-22 — PNG app icon compatibility
- Added a real PNG app icon for iOS Home Screen, browser favicon, and installed-app manifest support.
- Updated the Apple touch icon and favicon references with a cache-busting version so devices can pick up the PNG.
- Kept the existing Watch Logger icon artwork and updated the web app manifest to use PNG.

## 2026-10-22
- Disable double-tap-to-zoom across the app using `touch-action: manipulation`, while retaining pinch-to-zoom and normal panning. No viewport scaling restrictions added.

## 2026-10-22 — Settings layout regression repair
- Updated the Settings layout regression test to assert the consolidated General, Release Reminders, and Account & Sync sections rather than the superseded multi-section Preferences layout.
- Kept the test coverage for maintenance and changelog placement and verified the account controls remain inside Settings.

## 2026-10-22 — Consolidated Settings and episode tracker fixes
- Replaced duplicate Preferences shortcuts and separate controls with one Settings page containing only working General, Release Reminders, and Account & Sync sections.
- Removed placeholder entries for App Icon, Your Services, backups, reviews, support and feedback that do not have working destinations in this build.
- Fixed the title three-dot menu interaction and kept expanded seasons open after episode progress saves.
- Use episode-specific artwork when available and episode-specific placeholders rather than reusing the series poster when unavailable.
- Bumped gallery assets to version 28.

## 2026-10-22 — Episode tracker and title actions repair
- Fix the three-dot title actions menu so its Edit, Notes, and Delete options can be shown and hidden reliably.
- Preserve expanded season rows after marking an episode watched or unwatched instead of collapsing the season list.
- Render episode-specific artwork when an episode image is available in saved catalogue metadata, falling back to series artwork only when episode artwork is unavailable.
- Bump gallery asset versions so mobile browsers request the updated tracker.

## 2026-10-22

### Grouped Preferences screen
- Add screenshot-inspired Preferences groups for General, Release Reminders, Your Services, App Icon, account/sync, import/export, backups, review, support, feedback and About.
- Existing account, appearance and background reminder controls remain in the page; shortcut rows navigate to the relevant live controls where available.
- Clearly indicate categories whose underlying feature or destination is not yet configured rather than implying those actions are live.

## 2026-10-22

### Season rows and title action menu
- Replace the episode-tracker shortcut with expandable season rows and circular watched toggles for each released episode.
- Add a three-dot title menu for editing, notes, and confirmed deletion; notes and deletion use existing persistence with rollback if saving fails.
- Refresh gallery cache versions so the redesigned tracker loads on mobile clients.

## 2026-10-22

### Redesign title details and season/episode tracking
- Expandable season rows reveal individual released episodes with episode artwork, titles, release dates, and circular watched toggles.
- Season rows display poster artwork and a completion indicator; episode toggles use the existing save-and-undo progress flow.
- The title detail header now has a three-dot menu for Edit show or film, Notes, and Delete show or film.
- Notes save through the existing library persistence flow with rollback if saving fails; deletion is confirmed and restores the prior library state if persistence fails.
- Update gallery and library asset versions so clients request the redesigned UI.

## 2026-10-22

### Fix mobile Upcoming Releases layout and add app icon
- Keep release title, episode/date, and platform metadata within a responsive card grid instead of allowing the metadata column to collapse on narrow iPhone screens.
- Add a compact breakpoint for very narrow phones and bump the dashboard stylesheet cache version.
- Replace the placeholder play-triangle icon with a custom Watch Logger mark and register it for PWA installation.

## 2026-10-22

### Upcoming range, Prior Releases, and Chicago Fire season correction
- Upcoming shows the inclusive rolling window from today through seven days later—October 22–29 for this release.
- This week shows today through Sunday only; earlier releases from Monday through yesterday are grouped under Prior Releases.
- Show only the selected date window, while keeping Dates to be announced and Excluded from Weekly Releases available.
- Keep Chicago Fire's currently airing episodes in Season 15 and suppress the inaccurate Season 16 TBA label while Season 15 continues airing.
- Push-status notifications are still unavailable: Actions continues to log HTTP 401 because production has the older `watchlog-reminders` function. The secure replacement is waiting for approval to redeploy with its existing `verify_jwt: false` setting. No push delivery is claimed.

## 2026-10-22

### Watch statistics and reliability follow-up
- Add a compact Library dashboard summary for total library items, films marked watched, logged episodes, and shows with unwatched released episodes.
- Calculate statistics from saved episode progress and verified released-episode data without changing or rewriting library records.
- Keep the weekly calendar and statistics hidden under the existing Library-only dashboard visibility rules.
- Add regression coverage for statistics accuracy and record immutability; bump dashboard asset cache versions so the updated summary is loaded after deployment.

## 2026-10-16

### Link Weekly Releases opt-out to background reminders and remove notification-run overhead
- Excluding a show from Weekly Releases now removes its episode, season and planned-release events from background reminder scans; the show and its episode progress remain in the Library.
- Re-including the show restores reminder eligibility without needing a separate reminder toggle.
- Send the private owner-only run-status push from the deployment workflow's own `always()` step, instead of launching a separate notification workflow run for every completed attempt.
- Verify the current run ID, workflow ID, run number and commit SHA through GitHub's API using the workflow-scoped Actions-read token; notify with the actual overall run count, short SHA and outcome.
- Notification delivery uses `continue-on-error` so a push-delivery issue cannot overwrite the build/deployment result. Queued runs and runs cancelled before a runner reaches the final step cannot be reported by an in-run step.

## 2026-10-16

### Link Weekly Releases opt-out to background reminders
- Excluding a show from Weekly Releases now removes its episode, season and planned-release events from the background reminder scan as well.
- The show remains in the Library and keeps its episode progress and schedule. Re-including it restores reminder eligibility without a separate reminder setting.
- Add regression coverage for disabling reminders for an excluded show and restoring eligibility when re-enabled; bump reminder/editor asset versions so clients load the updated behaviour.
- Ensure the regression test strips TypeScript parameter annotations from extracted backend helpers before evaluating them in Node's test VM.

## 2026-10-10

### Fix browser refresh test race blocking deployment
- Correct the mobile browser smoke test to wait for the saved PIN session to restore after refresh instead of racing the temporary login screen and attempting to fill a form that has already been hidden.
- Preserve the cloud-persistence assertion and failed-save guard; deployment must pass Chromium and WebKit checks before it can publish.

## 2026-10-10

### Repair navigation deployment and stale-client protection
- Fix the Changelog regression test to load the actual app-core source directly, so its workflow-run-number assertions test the implementation rather than depending on HTML script inlining.
- Keep the bottom navigation restricted to Library, Search and Settings; add a defensive CSS rule that hides retired History and Watchlist tabs if legacy markup is restored.
- Bump app, dashboard, and gallery asset versions and the navigation service-worker cache namespace so deployed clients stop reusing the stale navigation shell.

## 2026-10-10

### Browser regression reliability
- Fix the WebKit refresh smoke test to re-authenticate only when the login email field is actually visible after navigation, avoiding a false failure when the app restores the session.
- Keep the refresh persistence assertion and failed-save protection checks in place.

## 2026-10-10

### Stop new pushes cancelling in-progress deployment checks
- Disable cancel-in-progress for the shared GitHub Pages deployment group. Every push now keeps its own workflow run instead of cancelling the preceding run when another fix is pushed; queued commits are processed in order.

## 2026-10-10

### Notify owner after every completed test and deployment workflow
- Extend the workflow-run notification trigger to include the separate Browser regression checks workflow as well as the deployment workflow, so test-only runs also generate an owner notification on completion.

## 2026-10-10

### Fix Library visibility smoke-test strict-mode failure
- Apply the same first-match handling in the Library visibility assertions as in Settings. The generic `.profile-card` selector matches several distinct Settings cards, so a strict-mode locator check was failing before it could validate the Library transition.
- Keep the visibility check against the real Settings and Library tabs; this is a test correction, not a change to app visibility behavior.

## 2026-10-10

### Deduplicate workflow status push notifications
- Use the existing per-subscription delivery ledger to prevent replayed workflow events from repeatedly notifying devices after successful delivery.
- Keep workflow-status records out of Reminder Activity and preserve retry backoff and failure tracking.
- Treat verified replays with no outstanding delivery as already processed rather than falsely reporting a new delivery.

## 2026-10-10

### Harden reminder scan concurrency and workflow run numbering
- Claim the one-minute reminder scan with a single conditional database update so concurrent cron invocations cannot both pass the stale-scan check.
- Derive the displayed all-workflows run count from GitHub inside the Edge Function instead of trusting a caller-supplied count.

## 2026-10-10

### Make deployments reproducible from committed source
- Remove the deployment-time source rewrite step. The viewport zoom, episode-progress preservation, deterministic library merge, and dynamic editor-height fixes are verified directly in committed source and covered by regression tests.
- Add a regression assertion that deployment cannot silently rewrite source before tests and publishing.

## 2026-10-10

### Fix Settings container boundary
- Keep Account & Sync, Reminder Activity, Appearance and Background Reminders inside the Settings view container. A misplaced closing `div` had closed Settings immediately after Account & Sync, leaving later settings content outside the view and breaking page visibility.
- Bump the app stylesheet and core script cache versions so clients fetch the corrected markup and navigation logic.

## 2026-10-10

### Add regression coverage for Settings placement and navigation visibility
- Add tests that enforce Account & Sync stays out of Library, Settings retains the requested section order, and the floating Add button is restricted to Library.

## 2026-10-10

### Put Maintenance before Changelog in Settings
- Keep the four requested Settings sections in the exact order: Account & Sync, Appearance, Background Reminders, Maintenance. Place Changelog after Maintenance rather than before it.
- Confirmed the Settings and Library views are separate sibling containers; the Library view is hidden whenever Settings is selected, and vice versa.

## 2026-10-10

### Fix Settings layout and floating Add button
- Preserve Settings section order: Account & Sync, Appearance, Background Reminders, then Maintenance; keep Changelog after Maintenance.
- Hide the floating Add show or film button immediately when Search or Settings is selected, and bump script cache versions so mobile browsers load the updated UI.

## 2026-10-10

### Keep Account & Sync inside Settings and restore section order
- Move Account & Sync out of the Library page and into Settings.
- Order Settings as Account & Sync, Appearance, Background Reminders, then Maintenance.

## 2026-10-10

### Fix app startup crash after PIN login
- Remove the stale call to the deleted `updateNotificationTestVisibility` function, which threw a `ReferenceError` during account entry and left the login screen stuck.

## 2026-10-10

### Make refresh persistence assertions target the same title
- Capture the edited media ID before Refresh and verify the saved value by ID after reload/login, avoiding brittle assumptions that the first library item remains first after cloud hydration.
- Apply the failed-save guard to that same record so both refresh scenarios test the same item.

## 2026-10-10

### Fix refresh smoke-test hydration wait
- Pass Playwright's timeout in the options argument, not as the page-function argument, and remove the arbitrary delay after verifying the reloaded library.

## 2026-10-10

### Fix refresh browser smoke-test authentication handling
- Keep the Refresh persistence assertion against the mocked cloud library after navigation.
- Re-authenticate through the real PIN form when the isolated browser test origin returns to the login screen, rather than timing out while assuming its session survives a document reload.

## 2026-10-10

### Fix refresh smoke test navigation wait
- Wait for the page's completed reload event after tapping Refresh instead of waiting for a specific mocked cloud login/load response, which was not a reliable signal for browser navigation.
- Retain the persisted-library assertion after reload and the separate failed-cloud-save guard, so Refresh is still tested for data safety rather than merely clicking the button.

## 2026-10-10

### Fix refresh browser smoke-test wait condition
- Wait for the actual mocked cloud login/load response after tapping Refresh instead of a page-local counter that is inaccessible to the browser test context. This addresses the timeout at the refresh step while retaining the saved-data assertions.

## 2026-10-10

### Fix browser refresh smoke test
- Wait for the mocked session reload response after Refresh instead of evaluating the Node-side `loads` variable inside the browser page, which caused the CI smoke test to fail with `ReferenceError: loads is not defined`.

## 2026-10-10

### Fix notification regression test environment
- Provide the GitHub token and repository metadata in the explicit environment used by the workflow-run regression test, matching the sender's required inputs and allowing the Actions run-count lookup to be mocked.

## 2026-10-10

### Fix notification tests after adding overall run-count lookup
- Mock the GitHub Actions total-count API and provide a test token so notification tests exercise the new failed-inclusive overall run counter rather than failing before the status endpoint is called.

## 2026-10-10

### Remove incorrect commit wording from workflow notifications
- Notification bodies now read `Run #N (abcdef0) has passed/has failed/was cancelled/was skipped` using the repository-wide workflow run count, without the misleading word `commit` or redundant “has been pushed”.

## 2026-10-10

### Display the overall failed-inclusive Actions run count in push notifications
- Use GitHub Actions API `total_count` across all workflows for the displayed Run #, including failed runs; preserve the deployment workflow run number separately for source verification.

## 2026-10-10

### Use actual repository-wide workflow-run total
- Fetch GitHub Actions API `total_count` across all workflows at notification time, counting failed and successful runs alike. Keep this separate from the source workflow run number and run ID.

## 2026-10-10

### Correct overall workflow-run count and refresh browser check
- Include the repository-wide Actions run count in deployment status payloads, separately from the source deployment run number and API run ID; the UI can use the all-workflows count that includes failed runs.
- Make the browser refresh test wait for a confirmed subsequent library load instead of relying on a fragile navigation event while verifying saved data survives refresh.

## 2026-10-10

### Fail workflow notification when push delivery is not confirmed
- Require the private status endpoint to report at least one successful device delivery and zero failures; a zero-device or partially failed result now fails the observer workflow instead of showing a misleading green check.
- Log the delivery count and backend reason in the workflow failure for diagnosis.

## 2026-10-10

### Fix stale private-history regression assertion
- Remove the obsolete test-only push table from the private reminder-history query expectations; the test endpoint was intentionally removed, while actual history/library/subscription queries remain scoped to the verified session account.
- Keep the workflow notification wording change and record this deployment-test correction in the changelog.

## 2026-10-10

### Show commit title and concise workflow status in private notifications
- Use the originating commit's title as the notification title, without a generic title when GitHub supplies one.
- Format the body as “Run #N (SHORTSHA) has been pushed and has passed/has failed …”; remove the word “commit” and keep the actual deployment workflow run number.

## 2026-10-10

### Fix workflow-run notification tests and numbering
- Update notification regression tests to use the originating workflow's dedicated source run ID, run number and SHA fields rather than obsolete push-number and secret fields.
- Assert that the backend payload keeps the GitHub run ID separate from the workflow run number and that endpoint errors include the response body.
- Keep the notification text and push data labelled with the actual workflow run number.

## 2026-10-10

### Use workflow run numbers in private status notifications
- Replace the misleading “Push #N” notification label with “Workflow run #N”, using the completed deployment workflow’s `run_number` rather than a push counter or the observer workflow’s own run number.
- Rename the notification data field from `pushNumber` to `workflowRunNumber`; keep the run ID separate for GitHub API verification.
- Keep the notification private to the owner’s enabled subscriptions.

## 2026-10-10

### Fix source workflow run IDs in private status notifications
- Stop assigning source deployment metadata to GitHub-reserved environment variables, which GitHub Actions does not allow workflows to override.
- Pass the completed deployment's run ID, run number and SHA through dedicated WATCHLOG_SOURCE_* variables so verification checks the correct run rather than the notification workflow itself.
- Include the Edge Function response body in failed notification job logs to make any future rejection diagnosable.

## 2026-10-10

### Correct completed-run verification for private status notifications
- Normalize GitHub run-number, SHA and conclusion comparisons and verify the source workflow ID before allowing private push delivery.
- Log the exact mismatched verification fields and return a distinct 403/502 response, so failures identify the rejecting layer instead of appearing as an opaque 401.
- Keep status delivery restricted to the owner's enabled push subscriptions.

## 2026-10-10

### Fix run-status notification HTTP 401
- Configure the reminder Edge Function to use its in-function authentication rather than Supabase JWT gateway verification: deployment-status requests are verified against GitHub Actions, while reminder and session actions retain their own checks.
- Keep the sender’s public publishable key in the `apikey` header; do not treat it as a bearer JWT.
- Bundle the function configuration/source note and this changelog entry in one repository commit.

## 2026-10-10

### Fix private run-status notification authorization
- Send both the Supabase `apikey` and `Authorization: Bearer` headers when calling the reminder Edge Function, so the authenticated endpoint can accept workflow completion notifications.
- Diagnose the failed run from its job log: the notification request returned HTTP 401 before any delivery attempt; this fix addresses that request authentication failure.

## 2026-10-10

### Remove separate deployment-notification secret dependency
- Verify completed run ID, run number, commit SHA and conclusion against GitHub's public Actions API instead of requiring a separately configured shared secret.
- Keep run-status delivery restricted to the owner's enabled push subscriptions; do not restore the removed test option.

## 2026-10-10

### Remove private notification test option
- Remove the private background push-test control and client-side handlers from Settings; normal background reminders remain available.
- Remove test-queue processing and the private test scheduling endpoint from the reminder service, while retaining activity for actual reminders.

## 2026-10-10

### Repair run-status notification and Changelog numbering
- Make the workflow-run test assert the exact source expressions without brittle regular-expression parsing.
- Send out-of-app run-status notifications through the private reminder backend only to the recipient configured in the private function environment; no in-app/public status broadcast is used.
- Require a strong WATCHLOG_DEPLOYMENT_NOTIFY_SECRET on both GitHub Actions and the Supabase Edge Function; include the workflow run number, commit and outcome in the notification.
- Keep the release-note regression contract for showing the workflow run number beside each Changelog commit.
- Correct the notification payload to use `runNumber` consistently and fix numeric validation so legitimate run numbers are accepted.
- Keep the successful-deployment refresh signal separate from the private push-status notification.

## 2026-10-10

### Fix Changelog workflow-run regression test
- Correct the Changelog assertion to match the actual `Number.isInteger(entry.workflowRunNumber)` rendering logic.
- Keep the separate GitHub Actions `run_number` mapping assertion so workflow numbering remains covered.

## 2026-10-10

### Force-refresh bottom navigation fix
- Keep the bottom navigation limited to Library, Search and Settings; remove legacy History and Watchlist tabs even if an old DOM fragment is restored.
- Bump the navigation service-worker cache namespace and app asset query versions so the deployed shell and scripts are fetched fresh after this push instead of continuing to display a stale cached interface.
- Verify the source HTML contains only the three supported bottom tabs and that the navigation cleanup remains active during DOM updates.

## 2026-10-10

### Changelog run numbers, Weekly Releases fix details, and editor cleanup
- Display the GitHub Actions workflow run number beside each corresponding app commit in Changelog, regardless of success, failure, cancellation, queueing or in-progress status.
- Correct the Weekly Releases opt-out regression assertion that caused the previous test-fix build to fail, and record that failure and its correction in the detailed release notes.
- Keep the per-show exclusion setting saved with the series; excluded series remain tracked in the Library and retain episode progress and reminders.
- Replace the crowded uppercase checkbox copy with an aligned, accessible preference row and concise helper text.

## 2026-10-10

### Weekly Releases opt-out — regression test correction
- Keep the per-show “Hide from Weekly Releases” preference in the show editor and saved media record.
- Exclude opted-out shows from both dated releases and Dates to be announced without affecting library tracking or reminders.
- Correct the regression assertion to match the app's existing ID-based selector convention, so the build tests the actual implementation rather than a nonexistent selector.

## 2026-10-10

### Per-show Weekly Releases visibility
- Add a per-show “Hide from Weekly Releases” setting in the show editor.
- Exclude opted-out shows from dated and to-be-announced weekly release lists while retaining their library record, episode tracking, watched progress, status, and reminders.
- Preserve the preference through edits and cloud sync as part of the existing media record.

## 2026-10-09

### Restore complete Changelog and correct app numbering
- Preserve the full repository commit history in the Changelog; overlay workflow outcomes by commit SHA instead of replacing the history with a filtered list of workflow runs.
- Fix the duplicate-filter key so distinct commits are not collapsed when workflow run numbers are unavailable.
- Keep the user's app commit sequence at 270 existing changes, with the next repository commit numbered 271; do not display GitHub Actions push/run numbers.
- Use clear outcome labels (Verified, Failed, Cancelled, In progress, Queued) against the corresponding app commit.

## 2026-10-09

### Changelog numbering and build repair
- Use repository commit-history numbers for the app version and Changelog entries; do not derive app numbering from GitHub Actions run or push numbers.
- Map workflow outcomes to the corresponding repository commit by commit SHA, so successful, failed, and cancelled attempts refer to a meaningful commit.
- Fix the missing closing brace in build metadata generation that stopped deployment before tests and publishing could run.

## 2026-10-09

### App commit number correction
- Derive the displayed app commit number from the deployment workflow run number, preserving the app numbering offset so push run 183 is app commit 267 and push run 184 is app commit 268.
- Do not use the repository-wide Actions workflow-run total as the app commit number.

## 2026-10-09

### App commit numbering
- Show the app commit number in Changelog entries instead of the individual GitHub Actions push-run number.
- Keep failed, cancelled, queued and in-progress attempts in the same app-commit sequence. The weekly releases redesign is app commit 267.

## 2026-10-09

### Weekly releases redesign
- Redesign “This week’s releases” as a compact, date-led weekly schedule with release counts, time chips, clearer title hierarchy and saved-platform labels.
- Group episodes of the same title airing on the same day/time into a single tappable card to avoid long repeated-title lists.
- Improve empty-day states, dates-to-be-announced grouping, mobile spacing and keyboard focus visibility.

# 2026-10-22

### Coordinated Watch Logger improvements
- Run the complete application and browser test suites before deployment, prevent overlapping deploys from cancelling one another, track the actual GitHub run and retry numbers, and include failed-check details plus recovery guidance in owner notifications.
- Add a post-deployment health check. The first deployment's Pages publish and health check succeeded, but the owner-notification step failed with HTTP 401 because the already-deployed notification endpoint required a GitHub verification token. Notification endpoint outages now produce a visible warning instead of falsely failing a successful publish; deploy and health-check failures still fail the workflow. The Actions token is not sent to Supabase.
- Add reminder states, test sends, delivery history, and deduplication; Weekly Releases exclusions now suppress related reminders.
- Add conflict-aware sync, offline/reconnect preservation, clear sync states, and versioned library export/merge restore.
- Improve the weekly calendar with separate weekly and upcoming-release views, Today/This week/Upcoming filters, re-enable controls for excluded shows, consistent episode/date/status details, and explicit local-timezone labeling.
- Improve library search, sorting, bulk actions, and filter preservation when opening and returning from an item.
- Move Watch Statistics to Settings > Account & Sync and add a profile button to open that section. Improve mobile layout and bulk-action access, touch targets, keyboard focus, visible sync/reminder status, and reduced-motion behavior.

# Changelog

## 2026-10-06

### Changelog and push status history
- Rename the app's “What's new” menu and dialog to **Changelog**.
- Show every repository push in the Changelog, including failed, cancelled, timed-out, skipped, queued, and in-progress pushes rather than only successful changes.
- Resolve each push's GitHub Actions result by commit SHA and preserve the actual push number, using status-specific wording such as “Failed push 178”, “Cancelled push 189”, and “Push 190” for a successful push.
- Keep the existing successful deployment refresh notification separate from the push-status history.

## 2026-10-06

### Deployment status notifications
- Add a private in-app notification to your account only whenever a push/change is sent — including successful, failed, cancelled, or otherwise unsuccessful deployment attempts.
- The notification tells you the push/commit and its outcome so a failed or ineffective change is immediately identifiable.
- Keep the existing successful-deployment refresh signal separate from the new status notification.
- Fix the WebKit smoke check so the known mocked Supabase pin CORS diagnostic does not incorrectly fail an otherwise passing browser run.

## 2026-10-06

### Verified fix
- Keep a TV episode in the upcoming/current release timeline for 24 hours after its actual air timestamp even after TVMaze advances `nextEpisodeDate` to the following episode.
- Use the stored `scheduledEpisodeReleases` metadata as the post-air retention source, with regression coverage for both the upcoming card and current timeline.

## 2026-10-03

### Verified fixes
- Connected the existing root `apply_fixes.py` on `main` to the GitHub Pages deployment workflow.
- The fix script now targets the repository's current split source files rather than assuming all code is inside `index.html`.
- Allow pinch-to-zoom by removing the `user-scalable=no` viewport restriction.
- Preserve episode progress when release/episode metadata for the current season is unavailable instead of clamping progress to zero.
- Make `mergeLibraries` timestamp ties deterministic so the first/cloud record wins an equal-timestamp collision.
- Add `90dvh` to the editor modal height so Safari's dynamic toolbar does not clip the modal.
- The script is idempotent and verifies all four fixes on every deployment.

- 2026-10-06: Fixed Changelog push-status rendering so every result keeps exactly one actual push number with the correct status-specific wording: failed/cancelled pushes use `Failed push N` / `Cancelled push N`, while successful pushes use `Push N`.

- Move private status delivery to a dedicated `workflow_run: completed` observer so completed success, failure, and cancellation outcomes are covered even if the deployment job stops before its final step.
- Remove duplicate status delivery from the deployment workflow and fail visibly if the private notification secret is missing.

- Correct Changelog run labels to use the overall All workflows history position, not the individual workflow's run_number. Display only `Run N (short-commit)` before the change title.
