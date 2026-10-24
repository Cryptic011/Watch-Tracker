import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {generateKeyPair,SignJWT,jwtVerify} from 'jose';
import {authenticateDeploymentRequest,ACTIONS_AUDIENCE,ACTIONS_ISSUER} from '../supabase/functions/watchlog-reminders/deployment-identity.mjs';

const {privateKey,publicKey}=await generateKeyPair('RS256');
const expected={runId:'12345',runNumber:'197',runAttempt:'2',sha:'a'.repeat(40)};
const claims={repository:'Cryptic011/Watched-Tracker',repository_id:'1346271034',repository_owner_id:'321054300',ref:'refs/heads/main',sha:expected.sha,
  workflow_ref:'Cryptic011/Watched-Tracker/.github/workflows/pages.yml@refs/heads/main',environment:'github-pages',run_id:expected.runId,run_number:expected.runNumber,run_attempt:expected.runAttempt,event_name:'push'};
async function token(changes={},key=privateKey){
 const time=Math.floor(Date.now()/1000);
 return new SignJWT({iss:ACTIONS_ISSUER,aud:ACTIONS_AUDIENCE,sub:'repo:Cryptic011/Watched-Tracker:environment:github-pages',iat:time,nbf:time-1,exp:time+300,...claims,...changes}).setProtectedHeader({alg:'RS256'}).sign(key);
}
const request=value=>new Request('https://backend.test',{headers:value?{authorization:'Bearer '+value}:{}});
const verify=(value,options)=>jwtVerify(value,publicKey,options);

test('Signed deployment identity accepts only the configured workflow and originating run',async()=>{
 const result=await authenticateDeploymentRequest(request(await token()),expected,verify);
 assert.equal(result.run_id,expected.runId);
 await authenticateDeploymentRequest(request(await token({sub:'repo:Cryptic011@321054300/Watched-Tracker@1346271034:environment:github-pages',event_name:'workflow_dispatch'})),expected,verify);
});
test('Missing, public-key, forged, expired and incorrectly scoped deployment identities fail closed',async()=>{
 for(const value of ['', 'public-publishable-key', 'e30.e30.c2ln'])await assert.rejects(authenticateDeploymentRequest(request(value),expected,verify));
 const other=await generateKeyPair('RS256');
 await assert.rejects(authenticateDeploymentRequest(request(await token({},other.privateKey)),expected,verify));
 const now=Math.floor(Date.now()/1000);
 for(const changes of [
  {iss:'https://attacker.test'}, {aud:'some-other-service'}, {exp:now-60}, {iat:now-1200}, {nbf:now+120},
  {repository:'Other/Repo'}, {repository_id:'1'}, {repository_owner_id:'1'}, {ref:'refs/heads/untrusted'},
  {workflow_ref:'Cryptic011/Watched-Tracker/.github/workflows/other.yml@refs/heads/main'}, {environment:'preview'},
  {run_id:'999'}, {run_number:'999'}, {run_attempt:'1'}, {sha:'b'.repeat(40)}, {event_name:'pull_request'}, {sub:'repo:Other/Repo:environment:github-pages'},
 ])await assert.rejects(authenticateDeploymentRequest(request(await token(changes)),expected,verify),JSON.stringify(changes));
});
test('Reminder handler authenticates deployment callers before GitHub or database access',async()=>{
 const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,''));
 let handler,reads=0;
 const context={createClient:()=>({from(){reads++;throw Error('Unexpected database request');}}),createRemoteJWKSet:()=>publicKey,jwtVerify,authenticateDeploymentRequest,
  Deno:{env:{get:name=>({SUPABASE_URL:'https://backend.test',SUPABASE_SERVICE_ROLE_KEY:'unused',WATCHLOG_GITHUB_TOKEN:'server-only'})[name]},serve:fn=>handler=fn},
  URL,TextEncoder,Response,Request,AbortSignal,crypto:globalThis.crypto,console,
  fetch:async()=>{reads++;return Response.json({id:Number(expected.runId),run_number:Number(expected.runNumber),run_attempt:Number(expected.runAttempt),head_sha:expected.sha,status:'in_progress',conclusion:null,workflow_id:344533582});}};
 vm.runInNewContext(source,context);
 const body={action:'deployment_status',...expected,status:'failure',failureSummary:'Untrusted text'};
 for(const authorization of ['', 'Bearer public-publishable-key']){
  const result=await handler(new Request('https://backend.test',{method:'POST',headers:{'Content-Type':'application/json',authorization},body:JSON.stringify(body)}));
  assert.equal(result.status,401);assert.equal(reads,0);
 }
 const result=await handler(new Request('https://backend.test',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+await token()},body:JSON.stringify(body)}));
 assert.equal(result.status,200);assert.equal(reads,1,'only the authenticated request can verify the workflow');
 assert.equal((await result.json()).reason,'owner_account_not_configured');
});
