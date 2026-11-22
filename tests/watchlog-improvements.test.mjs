import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {waitForPagesArtifact} from '../scripts/wait-pages-artifact.mjs';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');

test('Deployment checks gate publishing and workflow concurrency never cancels an active deployment',()=>{
  const workflow=read('../.github/workflows/pages.yml');
  assert.match(workflow,/cancel-in-progress:\s*false/);
  assert.match(workflow,/node --test tests\/\*\.test\.mjs/);
  assert.match(workflow,/git config --global --add safe\.directory "\$GITHUB_WORKSPACE"/);
  assert.match(workflow,/id: application_tests[\s\S]*?shell: bash/);
  assert.match(workflow,/id: browser_tests[\s\S]*?shell: bash/);
  assert.ok(workflow.indexOf('Stop before deployment when checks fail')<workflow.indexOf('Deploy to GitHub Pages'));
  assert.match(workflow,/WATCHLOG_SOURCE_RUN_ATTEMPT:\s*\$\{\{ github\.run_attempt \}\}/);
  assert.match(read('../scripts/notify-deployment.mjs'),/Post-deployment health check failed/);
});

test('Pages deployment waits for the exact upload and names artifacts per attempt',async()=>{
  const workflow=read('../.github/workflows/pages.yml');
  assert.match(workflow,/PAGES_ARTIFACT_NAME: github-pages-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow,/name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}/);
  assert.match(workflow,/PAGES_ARTIFACT_ID: \$\{\{ steps\.pages_artifact\.outputs\.artifact_id \}\}/);
  assert.match(workflow,/artifact_name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}/);
  assert.ok(workflow.indexOf('Upload site artifact')<workflow.indexOf('Wait for uploaded Pages artifact'));
  assert.ok(workflow.indexOf('Wait for uploaded Pages artifact')<workflow.indexOf('Deploy to GitHub Pages'));

  const config={apiUrl:'https://api.github.com',repository:'owner/repo',runId:'123',artifactName:'github-pages-123-2',artifactId:'20',token:'test-token'};
  const earlier={id:19,name:'github-pages-123-1'};
  let checks=0;
  await waitForPagesArtifact(config,{
    pause:async()=>{},
    request:async(url,{headers})=>{
      assert.equal(url.pathname,'/repos/owner/repo/actions/runs/123/artifacts');
      assert.equal(url.searchParams.get('name'),config.artifactName);
      assert.equal(headers.Authorization,'Bearer test-token');
      if(++checks===1)throw new Error('temporary network error');
      const current={id:20,name:config.artifactName};
      const artifacts=checks===2?[earlier]:checks===3?[current,{...current,id:21}]:[earlier,current];
      return Response.json({artifacts});
    }
  });
  assert.equal(checks,4);
  checks=0;
  await assert.rejects(waitForPagesArtifact(config,{
    pause:async()=>{},
    request:async()=>{checks++;return Response.json({artifacts:[earlier]});}
  }),/did not become available after 10 checks/);
  assert.equal(checks,10);
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

test('Calendar controls show GMT and reduced-motion is global',()=>{
  const dashboard=read('../assets/js/dashboard.js'),css=read('../assets/css/app.css');
  assert.doesNotMatch(dashboard,/data-calendar-range/);assert.match(dashboard,/Next 14 days/);
  assert.match(dashboard,/GMT/);
  assert.doesNotMatch(dashboard,/resolvedOptions\(\)\.timeZone/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/:focus-visible/);
});
