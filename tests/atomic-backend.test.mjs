import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';

const pin=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/watchlog-pin/index.ts',import.meta.url),'utf8'));
const reminders=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8'));
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('assert',helper+'\nreturn {extractFunction};')(assert);
const between=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

function accountHarness(){
  const deriveStarted=deferred(),deriveContinue=deferred(),calls=[];
  const state={account:{id:'account',email:'user@example.test',display_name:'User',pin_hash:'hash:1234',pin_salt:'salt',failed_attempts:0,locked_until:null},sessions:new Map(),pauseDerive:false};
  const db={from(table){
    const predicates=[];
    const query={select(){return query;},eq(key,value){predicates.push(row=>row[key]===value);return query;},async maybeSingle(){
      const rows=table==='watchlog_pin_accounts'?[state.account]:[...state.sessions.values()];
      return {data:structuredClone(rows.find(row=>predicates.every(p=>p(row)))||null),error:null};
    }};return query;
  },async rpc(name,args){
    calls.push({name,args});
    if(name==='watchlog_create_pin_session'){
      assert.equal(args.p_account,state.account.id);
      if(args.p_pin_hash!==state.account.pin_hash||args.p_pin_salt!==state.account.pin_salt)return {data:{ok:false,code:'invalid_login'}};
      if(state.account.locked_until&&Date.parse(state.account.locked_until)>Date.now())return {data:{ok:false,code:'locked',retryAfter:600}};
      state.sessions.set(args.p_token_hash,{token_hash:args.p_token_hash,account_id:args.p_account,expires_at:args.p_expires_at});return {data:{ok:true}};
    }
    assert.equal(name,'watchlog_change_pin');
    if(!state.sessions.has(args.p_session_token_hash))return {data:false};
    Object.assign(state.account,{pin_hash:args.p_pin_hash,pin_salt:args.p_pin_salt});return {data:true};
  }};
  const c=vm.createContext({console,Date,Uint8Array,crypto:webcrypto,db,SESSION_DAYS:30,
    normalizeEmail:v=>v,validEmail:()=>true,validPin:v=>/^\d{4}$/.test(v),readMaintenance:async()=>({enabled:false}),
    unb64:v=>v,b64:()=> 'new-salt',safeEqual:(a,b)=>a===b,sha256:async v=>v,randomToken:()=> 'new-session',
    MAINTENANCE_ADMIN_HASH:'not-owner',json:(body,status=200)=>({body,status}),readLibrary:async()=>({items:[],revision:0}),
    derivePin:async value=>{if(state.pauseDerive){deriveStarted.resolve();await deriveContinue.promise;}return 'hash:'+value;}});
  vm.runInContext([extractFunction(pin,'createSession'),extractFunction(pin,'getSession'),
    'async function loginHandler(body){const action="login";'+between(pin,'    if (action === "login") {','    const session = await getSession(req);')+'}',
    'async function changeHandler(body,req){const action="change_pin";const session=await getSession(req);if(!session)return json({code:"session_expired"},401);'+between(pin,'    if (action === "change_pin") {','    if (action === "logout") {')+'}',
  ].join('\n'),c);
  return {c,state,calls,deriveStarted,deriveContinue};
}

test('A login whose PIN was replaced during verification does not issue a session',async()=>{
  const h=accountHarness();h.state.pauseDerive=true;
  const request=h.c.loginHandler({email:h.state.account.email,pin:'1234'});
  await h.deriveStarted.promise;
  Object.assign(h.state.account,{pin_hash:'hash:5678',pin_salt:'recovery-salt'});h.state.sessions.clear();
  h.deriveContinue.resolve();const result=await request;
  assert.equal(result.status,401);assert.equal(result.body.code,'invalid_login');assert.equal(result.body.sessionToken,undefined);
  assert.equal(h.state.sessions.size,0);
  assert.deepEqual({...h.calls[0].args,p_expires_at:'future'},{p_account:'account',p_pin_hash:'hash:1234',p_pin_salt:'salt',p_token_hash:'new-session',p_expires_at:'future'});
});

test('Session creation respects a lock applied after the initial account lookup',async()=>{
  const h=accountHarness();h.state.pauseDerive=true;
  const request=h.c.loginHandler({email:h.state.account.email,pin:'1234'});await h.deriveStarted.promise;
  h.state.account.locked_until=new Date(Date.now()+600000).toISOString();h.deriveContinue.resolve();
  const result=await request;assert.equal(result.status,429);assert.equal(result.body.retryAfter,600);assert.equal(h.state.sessions.size,0);
});

test('A PIN change cannot complete after recovery revoked its caller',async()=>{
  const h=accountHarness();h.state.pauseDerive=true;
  h.state.sessions.set('old-session',{token_hash:'old-session',account_id:'account',expires_at:new Date(Date.now()+86400000).toISOString()});
  const request=h.c.changeHandler({pin:'9999'},{headers:{get:key=>key==='x-watchlog-session'?'old-session':null}});
  await h.deriveStarted.promise;
  h.state.sessions.clear();Object.assign(h.state.account,{pin_hash:'hash:5678',pin_salt:'recovery-salt'});h.deriveContinue.resolve();
  const result=await request;assert.equal(result.status,401);assert.equal(result.body.code,'session_expired');assert.equal(h.state.account.pin_hash,'hash:5678');
  assert.equal(h.calls[0].name,'watchlog_change_pin');assert.equal(h.calls[0].args.p_session_token_hash,'old-session');
});

test('A valid login returns its transactionally created session',async()=>{
  const h=accountHarness(),result=await h.c.loginHandler({email:h.state.account.email,pin:'1234'});
  assert.equal(result.status,200);assert.equal(result.body.sessionToken,'new-session');assert.equal(h.state.sessions.size,1);
});

function deliveryHarness(rpc){
  const c=vm.createContext({console,Date,MAX_PUSH_ATTEMPTS:5,db:{rpc},statusCodeFor:error=>Number(error?.statusCode||0)});
  vm.runInContext(['claimDelivery','finishDelivery'].map(name=>extractFunction(reminders,name)).join('\n'),c);return c;
}

test('Delivery claims use one atomic database operation and preserve its ownership',async()=>{
  const calls=[];let claimed=false;
  const c=deliveryHarness(async(name,args)=>{calls.push({name,args});if(claimed)return {data:null};claimed=true;return {data:{id:'delivery',attempts:1,lease_token:'lease'}};});
  const results=await Promise.all([c.claimDelivery({id:'sub'},'account','show','event','2026-10-24T12:00:00Z',['old']),c.claimDelivery({id:'sub'},'account','show','event','2026-10-24T12:00:00Z',['old'])]);
  assert.equal(results.filter(Boolean).length,1);assert.equal(results[0].lease_token,'lease');
  assert.ok(calls.every(call=>call.name==='watchlog_claim_push_delivery'));
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)),{p_subscription:'sub',p_account:'account',p_item:'show',p_event_key:'event',p_scheduled_for:'2026-10-24T12:00:00Z',p_legacy_keys:['old']});
});

test('Completion cannot modify a reclaimed delivery or disable a device without ownership',async()=>{
  let received;const c=deliveryHarness(async(name,args)=>{assert.equal(name,'watchlog_finish_push_delivery');received=args;return {data:false};});
  assert.equal(await c.finishDelivery({id:'delivery',attempts:1,lease_token:'old-lease'},{id:'sub'},{statusCode:410}),false);
  assert.equal(received.p_lease,'old-lease');assert.equal(received.p_status,'expired');assert.equal(received.p_disable_subscription,true);
});

test('Delivery completion preserves success, retry delays and exhausted-attempt semantics',async()=>{
  const calls=[],c=deliveryHarness(async(name,args)=>{calls.push(args);return {data:true};});
  await c.finishDelivery({id:'a',attempts:1,lease_token:'one'},{});
  await c.finishDelivery({id:'b',attempts:2,lease_token:'two'},{},{message:'temporary'});
  await c.finishDelivery({id:'c',attempts:5,lease_token:'three'},{},{message:'temporary'});
  assert.equal(calls[0].p_status,'sent');assert.equal(calls[0].p_error,null);
  assert.equal(calls[1].p_status,'retry');assert.ok(Date.parse(calls[1].p_next_attempt)>Date.now());
  assert.equal(calls[2].p_status,'expired');assert.equal(calls[2].p_next_attempt,null);assert.equal(calls[2].p_disable_subscription,false);
});
