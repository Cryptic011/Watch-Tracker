import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/js/reminders.js',import.meta.url),'utf8').split('  async function pinApi(')[0];
function harness({permission='granted',missing=false}={}){
  const node=()=>({textContent:'',disabled:false,dataset:{},style:{},listeners:{},classList:{values:new Set(),toggle(name,on){on?this.values.add(name):this.values.delete(name);},contains(name){return this.values.has(name);}},addEventListener(name,callback){this.listeners[name]=callback;}});
  const enable=node(),disable=node(),status=node(),testButton=node(),quick=node(),label=node();quick.querySelector=()=>label;
  const nodes={'test-background-reminder':testButton,'quick-reminder-status':quick};
  let subscription,serial=0,registered=0,permissionRequests=0,serverEnabled=!missing,failStatus=false,expireTest=false,localFailure=false,statusGate=null,testGate=null;
  const calls=[],prefs=new Map();
  const makeSubscription=()=>({endpoint:`https://web.push.apple.com/${++serial}`,toJSON(){return {endpoint:this.endpoint,keys:{auth:'auth',p256dh:'key'}};},unsubscribe:async()=>{if(localFailure)throw Error('Device unavailable');subscription=null;return true;}});
  subscription=missing?null:makeSubscription();
  const worker={active:{},pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription=makeSubscription()}};
  const Notification={permission,requestPermission:async()=>{permissionRequests++;return Notification.permission='granted';}};
  const window={Notification,PushManager:{},addEventListener(){},matchMedia:()=>({matches:true})};
  const navigator={userAgent:'iPhone',standalone:true,serviceWorker:{getRegistration:async()=>worker,register:async()=>{registered++;throw Error('Update download failed');},ready:Promise.resolve(worker)}};
  const context=vm.createContext({window,navigator,Notification,document:{visibilityState:'visible',addEventListener(){},querySelectorAll:()=>[],getElementById:id=>nodes[id]},backgroundReminderStatus:status,enableBackgroundReminders:enable,disableBackgroundReminders:disable,currentUser:{id:'account'},cloudSessionToken:'session',DEVICE_TIME_ZONE:'Europe/London',USER_LOCALE:'en-GB',REMINDER_API:'https://example.test/reminders',CLOUD_REQUEST_TIMEOUT_MS:1000,AbortController,setTimeout,clearTimeout,Uint8Array,atob,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},localStorage:{getItem:key=>prefs.get(key)||null,setItem:(key,value)=>prefs.set(key,value)},fetch:async(_url,request)=>{
    const body=JSON.parse(request.body);calls.push(body);
    if(body.action==='status'&&statusGate)await statusGate;
    if(body.action==='test_reminder'&&testGate)await testGate;
    let data={ok:true},code=200;
    if(body.action==='public_key')data.publicKey='AQID';
    if(body.action==='subscribe')serverEnabled=true;
    if(body.action==='unsubscribe')serverEnabled=false;
    if(body.action==='status'){if(failStatus)throw Error('offline');data.enabled=serverEnabled;}
    if(body.action==='test_reminder'&&expireTest){expireTest=false;data={error:'Expired',code:'push_subscription_expired'};code=410;}
    return {ok:code===200,status:code,json:async()=>data};
  }});
  vm.runInContext(source,context);
  return {context,enable,disable,status,testButton,label,calls,worker,
    check:()=>context.refreshBackgroundReminderStatus(),
    reconnect:()=>enable.onclick(),test:()=>testButton.listeners.click(),off:()=>disable.onclick(),
    loseSubscription:()=>subscription=null,failStatus:()=>failStatus=true,expireTest:()=>expireTest=true,failLocal:()=>localFailure=true,
    gateStatus:()=>{let release;statusGate=new Promise(resolve=>release=resolve);return release;},
    gateTest:()=>{let release;testGate=new Promise(resolve=>release=resolve);return release;},
    stats:()=>({registered,permissionRequests,serverEnabled,subscription,serial}),
  };
}

test('A lost subscription replaces stale Turn Off controls with Reconnect',async()=>{
  const h=harness();await h.check();assert.equal(h.disable.classList.contains('hidden'),false);
  h.loseSubscription();assert.equal(await h.check(),false);
  assert.equal(h.enable.textContent,'Reconnect Reminders');
  assert.equal(h.enable.classList.contains('hidden'),false);
  assert.equal(h.disable.classList.contains('hidden'),true);
  assert.equal(h.testButton.disabled,true);
  await h.reconnect();
  assert.equal(h.label.textContent,'Reminders on');assert.equal(h.testButton.disabled,false);
  assert.equal(h.stats().registered,0,'existing active worker survives update download failures');
  assert.equal(h.stats().permissionRequests,0,'granted permission needs no new permission prompt');
});

test('A test repairs a disappeared subscription without depending on library saves',async()=>{
  const h=harness();await h.check();h.loseSubscription();await h.test();
  assert.equal(h.calls.filter(row=>row.action==='test_reminder').length,1);
  assert.equal(h.stats().serial,2);assert.equal(h.label.textContent,'Reminders on');
  assert.match(h.status.textContent,/accepted/);
});

test('An expired push endpoint is renewed once and the same test request is retried',async()=>{
  const h=harness();await h.check();h.expireTest();await h.test();
  const tests=h.calls.filter(row=>row.action==='test_reminder');
  assert.equal(tests.length,2);assert.equal(tests[0].requestId,tests[1].requestId);
  assert.notEqual(tests[0].endpoint,tests[1].endpoint);assert.equal(h.stats().serial,2);
  assert.equal(h.testButton.disabled,false);
});

test('Permission refusal and network failure cannot leave enabled controls showing',async()=>{
  const blocked=harness({permission:'denied'});await blocked.check();
  assert.equal(blocked.enable.disabled,true);assert.equal(blocked.testButton.disabled,true);
  assert.equal(blocked.disable.classList.contains('hidden'),true);assert.match(blocked.status.textContent,/blocked/);
  const h=harness();await h.check();h.failStatus();await h.check();
  assert.equal(h.disable.classList.contains('hidden'),true);assert.equal(h.enable.disabled,false);
  assert.equal(h.label.textContent,'Reminder issue');
});

test('Turning reminders off wins over an older status response',async()=>{
  const h=harness();await h.check();const release=h.gateStatus();
  const checking=h.check();await new Promise(resolve=>setImmediate(resolve));
  const turningOff=h.off();release();await Promise.all([checking,turningOff]);
  assert.equal(h.stats().serverEnabled,false);assert.equal(h.stats().subscription,null);
  assert.equal(h.label.textContent,'Reminders off');assert.equal(h.disable.classList.contains('hidden'),true);
  assert.equal(h.testButton.disabled,true);
});

test('Signing back in does not silently restore a deliberately disabled device',async()=>{
  const h=harness();await h.check();h.failLocal();await h.off();
  await h.context.syncExistingBackgroundPush();
  assert.equal(h.calls.filter(row=>row.action==='subscribe').length,0);
  assert.equal(h.stats().serverEnabled,false);assert.equal(h.testButton.disabled,true);
});

test('Permission is requested synchronously from the enable action',async()=>{
  const h=harness({permission:'default',missing:true});const connecting=h.reconnect();
  assert.equal(h.stats().permissionRequests,1);await connecting;
  assert.equal(h.label.textContent,'Reminders on');
});

test('A test response from a previous account cannot re-enable reminder controls',async()=>{
  const h=harness();await h.check();const release=h.gateTest(),sending=h.test();
  await new Promise(resolve=>setImmediate(resolve));
  h.context.cloudSessionToken='another-account-session';h.context.currentUser={id:'other-account'};
  h.context.setBackgroundReminderStatus('Sign in to manage background reminders.');
  release();await sending;
  assert.equal(h.label.textContent,'Reminders off');assert.equal(h.disable.classList.contains('hidden'),true);
  assert.equal(h.testButton.disabled,true);
});
