import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Workflow refresh joins deployment results by exact commit without replacing task notes',async()=>{
  const source=fs.readFileSync(new URL('../assets/js/app-core.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('  let pushStatusesInFlight=null;'),source.indexOf('  whatsNewButton.onclick='));
  const entries=[{commit:'a'.repeat(40),title:'Safari notification connection',changes:['Start subscription from the tap']},{commit:'b'.repeat(40),title:'Series navigation',changes:['Keep episode headings pinned']}];
  const run=(sha,number,path,conclusion)=>({head_sha:sha,head_branch:'main',run_number:number,run_attempt:1,id:number,path,conclusion,created_at:'2026-10-25T02:00:00Z',head_commit:{message:'Remote run title'}});
  const c=vm.createContext({currentBuild:{commits:entries},APP_CHANGELOG_FULL:entries,statusBySha:new Map(),renderChangelogEntries(){},fetch:async()=>({ok:true,json:async()=>({workflow_runs:[run(entries[0].commit,999,'.github/workflows/browser.yml','failure'),run(entries[0].commit,395,'.github/workflows/pages.yml','success'),run(entries[1].commit,394,'.github/workflows/pages.yml','failure')]})})});
  vm.runInContext(code+'\nthis.load=loadPushStatuses;',c);await c.load();
  const actual=JSON.parse(JSON.stringify(c.APP_CHANGELOG_FULL));
  assert.equal(actual[0].workflowRunNumber,395);
  assert.equal(actual[0].workflowRuns.length,1);
  assert.equal(actual[0].status,'success');assert.equal(actual[1].status,'failure');
  for(let i=0;i<entries.length;i++){assert.equal(actual[i].title,entries[i].title);assert.deepEqual(actual[i].changes,entries[i].changes);}
});

test('Every curated release note is pinned to an exact commit',()=>{
  const notes=JSON.parse(fs.readFileSync(new URL('../release-notes.json',import.meta.url),'utf8'));
  for(const sha of Object.keys(notes))assert.match(sha,/^[a-f0-9]{40}$/);
});
