import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');

test('Deployment checks gate publishing and workflow concurrency never cancels an active deployment',()=>{
  const workflow=read('../.github/workflows/pages.yml');
  assert.match(workflow,/cancel-in-progress:\s*false/);
  assert.match(workflow,/node --test tests\/\*\.test\.mjs/);
  assert.match(workflow,/git config --global --add safe\.directory "\$GITHUB_WORKSPACE"/);
  assert.ok(workflow.indexOf('Stop before deployment when checks fail')<workflow.indexOf('Deploy to GitHub Pages'));
  assert.match(workflow,/WATCHLOG_SOURCE_RUN_ATTEMPT:\s*\$\{\{ github\.run_attempt \}\}/);
  assert.match(read('../scripts/notify-deployment.mjs'),/Post-deployment health check failed/);
});

test('Reminder activity and test delivery are session-scoped and Weekly Releases exclusions are visible as suppressed',()=>{
  const backend=read('../supabase/functions/watchlog-reminders/index.ts');
  const reminders=read('../assets/js/reminders.js');
  const dashboard=read('../assets/js/dashboard.js');
  assert.match(backend,/action === "test_reminder"/);
  assert.match(backend,/test-reminder:\$\{requestId\}/);
  assert.match(backend,/status:"suppressed",label:"Weekly Releases exclusion"/);
  assert.match(reminders,/Send Test Reminder|test-background-reminder/);
  assert.match(dashboard,/Upcoming reminders · Scheduled/);
});
test('Workflow notification recipient is configured as a private function secret',()=>{
 const worker=fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8');
 const app=fs.readFileSync(new URL('../assets/js/app-core.js',import.meta.url),'utf8');
 const sender=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8');
 assert.match(worker,/Deno\.env\.get\("WATCHLOG_OWNER_EMAIL"\)/);
 assert.match(worker,/Deno\.env\.get\("WATCHLOG_GITHUB_TOKEN"\)/);
 assert.doesNotMatch(sender,/x-github-token|process\.env\.GITHUB_TOKEN/);
 assert.doesNotMatch(worker,/robert17041@icloud\.com|PRIVATE_TEST_ACCOUNT_HASH/);
 assert.doesNotMatch(app,/NOTIFICATION_TEST_ACCOUNT_HASH|[a-f0-9]{64}/);
});

test('Library controls include backup restore, alternate titles, and all requested bulk actions',()=>{
  const core=read('../assets/js/app-core.js'),sync=read('../assets/js/sync.js'),library=read('../assets/js/library.js');
  for(const id of ['export-library-backup','import-library-backup'])assert.ok(core.includes(id));
  assert.match(sync,/watchlog-library-backup/);
  for(const action of ['watched','planned','hide','include','remove'])assert.match(library,new RegExp(`data-bulk-action=.{0,5}${action}`));
  assert.match(library,/item\?\.alternateTitles/);
});

test('Calendar controls disclose the device timezone and reduced-motion is global',()=>{
  const dashboard=read('../assets/js/dashboard.js'),css=read('../assets/css/app.css');
  for(const range of ['today','week','upcoming'])assert.ok(dashboard.includes(`['${range}'`));
  assert.match(dashboard,/DEVICE_TIME_ZONE/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/:focus-visible/);
});
