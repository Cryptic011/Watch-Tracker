import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {generateKeyPair,SignJWT,jwtVerify} from 'jose';
import {reminderEvents as nativeEvents,reminderPlan} from '../native/reminder-plan.mjs';
const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('supabase/functions/watchlog-reminders/index.ts',root),'utf8');
const stripped=stripTypeScriptTypes(source.replace(/^import[\s\S]*?from "npm:web-push-neo@0\.1\.2";\n/m,''));
const regional=fs.readFileSync(new URL('assets/js/regional-releases.js',root),'utf8');
const now=Date.parse('2026-10-29T12:00:00Z');
class Clock extends Date {static now(){return now;}}
function worker({db={},key,fetcher=async()=>{throw Error('Unexpected network request');}}={}){
 let handler;
 const c=vm.createContext({Date:Clock,Intl,Number,Array,Set,String,Object,Map,TextEncoder,crypto,Response,Request,URL,AbortSignal,setTimeout,clearTimeout,
  console:{error(){},log(){}},fetch:fetcher,jwtVerify,
  createRemoteJWKSet:url=>{assert.equal(url.href,'https://token.actions.githubusercontent.com/.well-known/jwks');return key;},
  Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>db});
 vm.runInContext(regional,c);vm.runInContext(stripped,c);
 return {c,request:async(body,token='')=>{const response=await handler(new Request('https://audit.invalid',{method:'POST',headers:{'X-WatchLog-Deployment':token},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}};
}
test('The complete production worker sends timed Planned film reminders and retains uncertain dates',async()=>{
 const {c}=worker(),sent=[];
 const film={id:'film',title:'Timed film',type:'Film',status:'Planned',filmReleaseDate:new Date(now).toISOString(),filmReleaseSource:'Manual'};
 c.readLibraries=async()=>[{account_id:'audit',items:[film,{...film,id:'date-only',filmReleaseDate:'2026-10-29'},{...film,id:'unconfirmed',filmReleaseSource:''},{...film,id:'watched',status:'Watched'}]}];
 c.refreshServerEpisodeSchedules=async rows=>rows;c.claimDelivery=async()=>({id:'delivery',attempts:1,leaseToken:'token'});c.finishDelivery=async()=>{};c.sendPush=async(_row,_config,payload)=>sent.push(payload);
 const result=await c.processPlannedReminders([{id:'device',account_id:'audit'}],{});
 assert.equal(result.sent,1);assert.equal(sent[0].title,'Timed film');assert.equal(sent[0].data.accountId,'audit');
 const future={...film,filmReleaseDate:new Date(now+48*3600000).toISOString()};
 const resolveEvent=(item,event)=>c.WatchLogRegionalReleases.resolveEvent(item,event,{country:'GB'});
 assert.equal(reminderPlan([future],'audit',{now,resolveEvent}).length,3);
 assert.equal(reminderPlan([{...future,filmReleaseDate:'2026-10-31'}],'audit',{now,resolveEvent}).length,0);
});
test('Delivery claim and completion database errors remain failures and carry the exact lease',async()=>{
 const calls=[];let fail=false;
 const {c}=worker({db:{rpc:async(name,args)=>{calls.push({name,args});return fail?{error:{message:'Database unavailable'}}:{data:name==='watchlog_claim_delivery'?{id:'id',attempts:1,leaseToken:'token'}:true};}}});
 const claim=await c.claimDelivery({id:'device'},'audit','show','event','2026-10-29T12:00:00Z');
 await c.finishDelivery(claim,{id:'device'});
 assert.equal(calls[1].args.p_token,'token');assert.equal(calls[1].args.p_status,'sent');
 fail=true;await assert.rejects(c.claimDelivery({id:'device'},'audit','show','event','2026-10-29T12:00:00Z'));
 await assert.rejects(c.finishDelivery(claim,{id:'device'}));
});
test('An uncertain accepted push is not reclassified as a failed send when its acknowledgement fails',async()=>{
 const {c}=worker();let acknowledgements=0,pushes=0;
 const film={id:'film',title:'Film',type:'Film',status:'Planned',filmReleaseDate:new Date(now).toISOString(),filmReleaseSource:'Manual'};
 c.readLibraries=async()=>[{account_id:'audit',items:[film]}];c.refreshServerEpisodeSchedules=async rows=>rows;c.claimDelivery=async()=>({id:'delivery',attempts:1,leaseToken:'token'});
 c.sendPush=async()=>pushes++;c.finishDelivery=async()=>{acknowledgements++;throw Error('Acknowledgement unavailable');};
 await assert.rejects(c.processPlannedReminders([{id:'device',account_id:'audit'}],{}),/Acknowledgement unavailable/);
 assert.equal(pushes,1);assert.equal(acknowledgements,1);
});
test('Notification taps preserve title identity and account on cold and existing-window launches',async()=>{
 for(const existing of [false,true]){
  const listeners={},opened=[],scope='https://example.test/Watch-Tracker/';let work,focused=0;
  const client={url:scope,navigate:async url=>{opened.push(url);return client;},focus:async()=>focused++};
  const self={registration:{scope},addEventListener:(name,fn)=>listeners[name]=fn,clients:{matchAll:async()=>existing?[client]:[],openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(fs.readFileSync(new URL('sw.js',root),'utf8'),{self,URL});
  listeners.notificationclick({notification:{data:{url:'https://evil.invalid/',itemId:'a/b c',accountId:'account',kind:'reminder'},close(){}},waitUntil:promise=>work=promise});await work;
  const url=new URL(opened[0]);assert.equal(url.origin,'https://example.test');assert.equal(url.hash,'#/title/a%2Fb%20c');assert.equal(url.searchParams.get('reminderAccount'),'account');assert.equal(focused,existing?1:0);
 }
});
test('Deployment status requires a valid signed job for this exact repository, workflow and run',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256'),other=await generateKeyPair('RS256');
 const body={runId:'123',runNumber:'456',runAttempt:'1',sha:'a'.repeat(40)};
 const claims={repository_id:'1346271034',repository_owner_id:'321054300',repository:'Cryptic011/Watch-Tracker',ref:'refs/heads/main',environment:'github-pages',event_name:'push',workflow_ref:'Cryptic011/Watch-Tracker/.github/workflows/pages.yml@refs/heads/main',run_id:'123',run_number:'456',run_attempt:'1',sha:body.sha};
 const sign=(payload={},signingKey=privateKey,expires='5m')=>new SignJWT({...claims,...payload}).setProtectedHeader({alg:'RS256'}).setIssuer('https://token.actions.githubusercontent.com').setAudience('watchlog-deployments').setIssuedAt().setNotBefore(Math.floor(Date.now()/1000)-1).setExpirationTime(expires).sign(signingKey);
 const {c,request}=worker({key:publicKey});
 const verify=token=>c.verifyDeploymentToken(new Request('https://audit.invalid',{headers:{'x-watchlog-deployment':token}}),body);
 assert.equal(await verify(await sign()),true);
 for(const change of [{repository_id:'999'},{ref:'refs/pull/1/merge'},{event_name:'pull_request'},{run_id:'999'},{run_attempt:'2'},{sha:'b'.repeat(40)},{workflow_ref:'Cryptic011/Watch-Tracker/.github/workflows/other.yml@refs/heads/main'},{environment:'other'}])assert.equal(await verify(await sign(change)),false);
 assert.equal(await verify(await sign({},other.privateKey)),false);assert.equal(await verify(await sign({},privateKey,Math.floor(Date.now()/1000)-60)),false);
 for(const token of ['', 'forged-token'])assert.equal((await request({action:'deployment_status',...body,status:'failure',failureSummary:'Forged'},token)).status,401);
  let lookups=0;
  const publicRun=worker({key:publicKey,fetcher:async(url,options)=>{lookups++;assert.equal(options.headers.Authorization,undefined);assert.equal(String(url),'https://api.github.com/repos/Cryptic011/Watch-Tracker/actions/runs/123');return new Response(JSON.stringify({id:123,run_number:456,run_attempt:1,head_sha:body.sha,status:'in_progress',conclusion:null,workflow_id:344533582}));}});
  const accepted=await publicRun.request({action:'deployment_status',...body,status:'failure'},await sign());
  assert.equal(accepted.status,200);assert.equal(lookups,1,'signed jobs can verify this public repository without a server PAT');
});
test('Archiving retains the same explicit reminder preference on web and native',()=>{
 const {c}=worker(),item={id:'show',title:'Archived',type:'Series',status:'Watching',archived:true,scheduledEpisodeReleases:[{season:1,number:2,raw:'2026-10-31T12:00:00Z'}]};
 assert.equal(c.reminderEvents(item).length,1);assert.equal(nativeEvents(item).length,1);
 assert.equal(c.reminderEvents({...item,hideFromWeeklyReleases:true}).length,0);assert.equal(nativeEvents({...item,hideFromWeeklyReleases:true}).length,0);
});
test('Repeated sign-in uses the current cloud library without resurrecting legacy records',async()=>{
 const source=fs.readFileSync(new URL('assets/js/sync.js',root),'utf8');
 const login=source.slice(source.indexOf('  async function loginPinAccount('),source.indexOf('  async function restorePinSession('));const accepted=[];
 const c=vm.createContext({pinApi:async()=>({items:[],revision:5}),collectPreviousLocalItems:async()=>assert.fail('A sign-in must not reimport legacy data'),establishCloudSession:async(_result,items)=>accepted.push(items)});
 vm.runInContext(login,c);await c.loginPinAccount('audit@example.test','1234');await c.loginPinAccount('audit@example.test','1234');
 assert.equal(accepted.length,2);assert.ok(accepted.every(items=>items.length===0));
});
test('Film editor preserves date-only uncertainty and round-trips a confirmed GMT time',()=>{
 const s=fs.readFileSync(new URL('assets/js/editor.js',root),'utf8');const nodes={'film-release-time':{value:''}};
 const c=vm.createContext({filmReleaseDate:{value:''},$:id=>nodes[id],toLocalInput:raw=>new Date(raw).toISOString().slice(0,16),storedDateFromInput:raw=>new Date(raw+'Z').toISOString()});
 vm.runInContext(s.slice(s.indexOf('  function setFilmReleaseInputs('),s.indexOf('  function updateFilmVerifyNote(')),c);
 c.setFilmReleaseInputs('2026-10-31');assert.equal(c.storedFilmRelease(),'2026-10-31');assert.equal(nodes['film-release-time'].value,'');
 c.setFilmReleaseInputs('2026-10-31T08:30:00Z');assert.equal(c.storedFilmRelease(),'2026-10-31T08:30:00.000Z');
  c.setFilmReleaseInputs('2026-10-31T00:30:00+01:00');assert.equal(c.storedFilmRelease(),'2026-10-30T23:30:00.000Z');
});
test('An unavailable film verification cannot erase a saved release time on opening the editor',async()=>{
 const s=fs.readFileSync(new URL('assets/js/editor.js',root),'utf8'),date={value:''},source={value:''},time={value:''};
 const c=vm.createContext({filmReleaseDate:date,filmReleaseSource:source,filmVerifyNote:{},$:id=>id==='film-release-time'?time:{value:''},normalizeTitle:value=>value.toLowerCase(),verifiedFilmReleaseData:async()=>({date:'',source:''}),rememberEditorVerification(){},toLocalInput:raw=>new Date(raw).toISOString().slice(0,16),storedDateFromInput:raw=>new Date(raw+'Z').toISOString()});
 vm.runInContext(s.slice(s.indexOf('  function setFilmReleaseInputs('),s.indexOf('  function editorVerificationKey('))+s.slice(s.indexOf('  async function fillFilmReleaseData('),s.indexOf('  function balancedSuggestions(')),c);
 await c.fillFilmReleaseData('Saved film',{seedDate:'2026-10-31T08:30:00Z',seedSource:'Verified service'});
 assert.equal(c.storedFilmRelease(),'2026-10-31T08:30:00.000Z');assert.equal(source.value,'Verified service');
});
