import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const rows=execFileSync('git',['log','--topo-order','--format=%H%x09%cs%x09%s'],{encoding:'utf8'}).trim().split('\n');
const notes=JSON.parse(readFileSync('release-notes.json','utf8'));
// Release notes belong to an exact commit, never whichever commit is newest.
// Identity and chronology always come from Git, even for curated notes.
const commits=rows.map((row,index)=>{const [commit,date,...subject]=row.split('\t');const title=subject.join('\t');const note=notes[commit];return {number:rows.length-index+7,commit,date,title,changes:Array.isArray(note?.changes)&&note.changes.length?note.changes:[title]};});
const releaseNumber=commits.length+7;
const repository=process.env.GITHUB_REPOSITORY||'Cryptic011/Watch-Tracker';
const runNumber=Number(process.env.GITHUB_RUN_NUMBER)||null;
const runAttempt=Number(process.env.GITHUB_RUN_ATTEMPT)||1;
let workflowRuns=[];
if(process.env.GITHUB_ACTIONS==='true'){
  try{
    for(let page=1;page<=10;page++){
      const headers={Accept:'application/vnd.github+json'};
      if(process.env.GH_TOKEN)headers.Authorization='Bearer '+process.env.GH_TOKEN;
      const response=await fetch('https://api.github.com/repos/'+repository+'/actions/workflows/pages.yml/runs?per_page=100&page='+page,{headers,signal:AbortSignal.timeout(10000)});
      if(!response.ok)break;
      const rows=(await response.json()).workflow_runs||[];
      workflowRuns.push(...rows.filter(run=>run.head_branch==='main'));
      if(rows.length<100)break;
    }
  }catch(error){console.warn('Using embedded workflow run metadata for this build.');}
}
for(const entry of commits){
  const runs=workflowRuns.filter(run=>run.head_sha===entry.commit).map(run=>({workflowRunNumber:run.run_number,workflowRunAttempt:run.run_attempt,workflowRunId:run.id,status:run.conclusion||run.status}));
  if(entry===commits[0]&&runNumber&&!runs.length)runs.push({workflowRunNumber:runNumber,workflowRunAttempt:runAttempt,workflowRunId:Number(process.env.GITHUB_RUN_ID)||null,status:'in_progress'});
  if(runs.length){entry.workflowRuns=runs;entry.workflowRunNumber=runs[0].workflowRunNumber;entry.status=runs[0].status;}
}
if(Number.isInteger(releaseNumber)&&commits[0])commits[0].number=releaseNumber;
const script='window.WATCHLOG_BUILD='+JSON.stringify({count:commits.length,releaseNumber,runNumber,runAttempt,repository,sha:commits[0].commit,commits}).replaceAll('<','\\u003c')+';\n';
writeFileSync('build-info.js',script);
// Embed metadata so the page and changelog cannot cache different revisions.
const html=readFileSync('index.html','utf8');
const marker='<script src="build-info.js"></script>';
if(!html.includes(marker))throw new Error('Build metadata script marker missing');
// Each deployment must request its own scripts/styles, including files whose
// hand-written query version was not changed. Keep external URLs untouched.
const versionedHtml=html.replace(/\b(src|href)="([^"?#]+\.(?:js|css))(?:\?[^"#]*)?"/g,(attribute,name,path)=>
  /^(?:[a-z]+:|\/\/)/i.test(path)?attribute:`${name}="${path}?v=${commits[0].commit}"`);
writeFileSync('index.html',versionedHtml.replace(`<script src="build-info.js?v=${commits[0].commit}"></script>`,()=>'<script>'+script+'</script>'));

const builtHtml=readFileSync('index.html','utf8');
const shellAssets=['index.html',...new Set([...builtHtml.matchAll(/\b(?:src|href)="([^"#]+\.(?:js|css|png|svg|webmanifest)(?:\?[^"#]*)?)"/g)].map(match=>match[1]).filter(path=>! /^(?:[a-z]+:|\/\/)/i.test(path)&&!path.startsWith('build-info.js')))];
writeFileSync('asset-manifest.json',JSON.stringify({version:commits[0].commit,assets:shellAssets}));
if(existsSync('sw.js'))writeFileSync('sw.js',readFileSync('sw.js','utf8').replace('__WATCHLOG_BUILD__',commits[0].commit));
