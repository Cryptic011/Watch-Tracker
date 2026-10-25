import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?from "npm:web-push-neo@0\.1\.2";\n/m,''));
function endpoint({statusError=false,expiredPush=false}={}){
  let handler,subscriptionEnabled=true;
  const row={id:'device',account_id:'account',endpoint:'https://web.push.apple.com/test',p256dh:'key',auth:'auth',enabled:true};
  const db={from(table){
    let operation='select';
    const result=()=>{
      if(table==='watchlog_pin_sessions')return {data:{account_id:'account',expires_at:'2099-01-01T00:00:00Z'}};
      if(table==='watchlog_push_config')return {data:{vapid_public_key:'public',vapid_private_key:'private'}};
      if(table==='watchlog_push_subscriptions')return statusError&&operation==='select'?{data:null,error:{message:'Database unavailable'}}:{data:{...row,enabled:subscriptionEnabled}};
      if(table==='watchlog_push_deliveries')return {data:operation==='insert'?{id:'delivery',attempts:1}:null};
      throw Error('Unexpected table '+table);
    };
    const query={select(){return this;},eq(){return this;},maybeSingle:async()=>result(),single:async()=>result(),insert(){operation='insert';return this;},update(values){operation='update';if(table==='watchlog_push_subscriptions')subscriptionEnabled=values.enabled;return this;},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};
    return query;
  }};
  vm.runInNewContext(source,{Deno:{env:{get:()=>''},serve:callback=>handler=callback},createClient:()=>db,TextEncoder,crypto,Response,Date,URL,AbortSignal,console:{error(){},log(){}},sendNotification:async()=>{if(expiredPush)throw Object.assign(Error('Gone'),{statusCode:410});}});
  return {request:async(action,token='session')=>{
    const response=await handler(new Request('https://example.test/reminders',{method:'POST',headers:{'content-type':'application/json','x-watchlog-session':token},body:JSON.stringify({action,endpoint:row.endpoint,requestId:'12345678-1234-1234-1234-123456789012'})}));
    return {status:response.status,data:await response.json()};
  },enabled:()=>subscriptionEnabled};
}

test('A subscription status database failure remains an error, never a false off result',async()=>{
  const result=await endpoint({statusError:true}).request('status');
  assert.equal(result.status,500);assert.equal(result.data.enabled,undefined);
});

test('An expired test endpoint is disabled and returns a reconnectable error',async()=>{
  const service=endpoint({expiredPush:true}),result=await service.request('test_reminder');
  assert.equal(result.status,410);assert.equal(result.data.code,'push_subscription_expired');
  assert.equal(service.enabled(),false);
});

test('Reminder status and delivery tests require a valid account session',async()=>{
  for(const action of ['status','test_reminder']){
    const result=await endpoint().request(action,'');
    assert.equal(result.status,401);assert.equal(result.data.code,'session_expired');
  }
});
