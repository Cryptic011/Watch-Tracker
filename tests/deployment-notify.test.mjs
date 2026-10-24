import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/notify-deployment.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'');
const sha='a'.repeat(40);
function run(fetch,env={WATCHLOG_SOURCE_SHA:sha,WATCHLOG_SOURCE_RUN_NUMBER:'197',WATCHLOG_SOURCE_RUN_ATTEMPT:'2',WATCHLOG_SOURCE_RUN_ID:'12345',WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'success',GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker',GITHUB_EVENT_NAME:'workflow_run'},identityProvider=null){
 const identityEnv={ACTIONS_ID_TOKEN_REQUEST_URL:'https://token.actions.githubusercontent.com/request?api-version=2',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'private-request-token',...env};
 const identityFetch=(url,options)=>String(url).startsWith('https://token.actions.githubusercontent.com/')?(identityProvider?identityProvider(url,options):Promise.resolve({ok:true,json:async()=>({value:'signed.workflow.identity'})})):fetch(url,options);
 return vm.runInNewContext('(async()=>{'+source+'})()', {WatchLogDeployment:{config:{url:'https://backend.test',key:'public-key',topic:'watchlog-deployments',event:'deployed'}},process:{env:identityEnv,exit(code){throw new Error('__PROCESS_EXIT__'+code)}},URL,AbortSignal,fetch:identityFetch,setTimeout:fn=>fn(),console:{log(){},warn(){},error(){}}}).catch(error=>{if(error.message==='__PROCESS_EXIT__0')return;throw error;});
}
test('Completed workflow run status is sent privately with the source run number, ID, commit and outcome',async()=>{
 let request;
 await run(async(url,options)=>{request={url:String(url),options};return {ok:true,json:async()=>String(url).includes('api.github.com')?({total_count:351}):({ok:true,delivered:1,failed:0})};});
 assert.equal(request.url,'https://backend.test/functions/v1/watchlog-reminders');
 assert.equal(request.options.headers['x-github-token'],undefined);
 assert.equal(request.options.headers.Authorization,'Bearer signed.workflow.identity');
 assert.deepEqual(JSON.parse(request.options.body),{action:'deployment_status',runId:'12345',runNumber:'197',runAttempt:'2',failureSummary:'',sha,status:'success',commitUrl:`https://github.com/Cryptic011/Watched-Tracker/commit/${sha}`});
});
test('Notification endpoint errors do not turn a successful deployment into a failure',async()=>{
 await run(async(url)=>String(url).includes('api.github.com')?({ok:true,json:async()=>({total_count:351})}):({ok:false,status:503,text:async()=> 'backend unavailable'}));
});
test('Completed workflow-run events use the originating workflow run number and conclusion',async()=>{
 let request;
 await run(async(url,options)=>{request={url:String(url),options};return {ok:true,json:async()=>String(url).includes('api.github.com')?({total_count:351}):({ok:true,delivered:1,failed:0})};},{
  WATCHLOG_SOURCE_SHA:sha,WATCHLOG_SOURCE_RUN_ID:'67890',WATCHLOG_SOURCE_RUN_NUMBER:'202',WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'cancelled',GITHUB_EVENT_NAME:'workflow_run',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker'
 });
 assert.equal(JSON.parse(request.options.body).runNumber,'202');
 assert.equal(JSON.parse(request.options.body).runId,'67890');
 assert.equal(JSON.parse(request.options.body).status,'cancelled');
});
test('Missing source workflow metadata fails closed before sending a notification',async()=>{
 let requests=0;
 await assert.rejects(run(async()=>{requests++;return {ok:true,json:async()=>({})};},{WATCHLOG_STATUS:'failure'}),/Source deployment SHA is required/);
 assert.equal(requests,0);
});


test('Deployment status carries the exact source run and failure summary',async()=>{
 let body;
 await run(async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,delivered:1,failed:0})};},{WATCHLOG_SOURCE_SHA:sha,WATCHLOG_SOURCE_RUN_NUMBER:'202',WATCHLOG_SOURCE_RUN_ATTEMPT:'3',WATCHLOG_SOURCE_RUN_ID:'67890',WATCHLOG_PAGE_URL:'',WATCHLOG_STATUS:'failure',WATCHLOG_FAILURE_SUMMARY:'not ok 4 - reminder schedule: expected 2, got 1',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker'});
 assert.equal(body.runNumber,'202');assert.equal(body.runAttempt,'3');assert.match(body.failureSummary,/not ok 4/);
});

test('A failed post-deploy health check notifies the owner and fails the workflow for recovery',async()=>{
 let payload;
 await assert.rejects(run(async(url,options)=>{
  if(String(url).startsWith('https://pages.test'))return {ok:true,text:async()=>'<html>old deployment</html>'};
  payload=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,delivered:1,failed:0})};
 },{WATCHLOG_SOURCE_SHA:sha,WATCHLOG_SOURCE_RUN_NUMBER:'205',WATCHLOG_SOURCE_RUN_ATTEMPT:'1',WATCHLOG_SOURCE_RUN_ID:'78901',WATCHLOG_PAGE_URL:'https://pages.test/',WATCHLOG_STATUS:'success',GITHUB_REPOSITORY:'Cryptic011/Watched-Tracker'}),/__PROCESS_EXIT__1/);
 assert.equal(payload.status,'failure');assert.match(payload.failureSummary,/Post-deployment health check failed/);assert.match(payload.failureSummary,/Restore the previous Pages artifact/);
});
test('Notification sender requests the scoped GitHub identity and never forwards its request credential',async()=>{
 let identityRequest,notification;
 await run(async(url,options)=>{notification={url,options};return {ok:true,json:async()=>({ok:true,delivered:1})};},undefined,async(url,options)=>{
  identityRequest={url,options};return {ok:true,json:async()=>({value:'signed.workflow.identity'})};
 });
 assert.equal(identityRequest.url.searchParams.get('audience'),'watchlog-deployment-status');
 assert.equal(identityRequest.options.headers.Authorization,'Bearer private-request-token');
 assert.equal(notification.options.headers.Authorization,'Bearer signed.workflow.identity');
 assert.doesNotMatch(JSON.stringify(notification),/private-request-token/);
});
test('Failure to obtain a workflow identity never falls back to public-key notification authentication',async()=>{
 let requests=0;
 await run(async()=>{requests++;throw Error('Must not notify without an identity');},undefined,async()=>({ok:false,status:503}));
 assert.equal(requests,0);
 await run(async()=>{requests++;throw Error('Must not notify without an identity');},{WATCHLOG_SOURCE_SHA:sha,WATCHLOG_SOURCE_RUN_NUMBER:'197',WATCHLOG_SOURCE_RUN_ID:'12345',WATCHLOG_STATUS:'failure',ACTIONS_ID_TOKEN_REQUEST_TOKEN:''});
 assert.equal(requests,0);
});
