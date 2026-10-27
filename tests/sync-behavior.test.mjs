import { readAppSource } from "./app-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = readAppSource();
const copy=value=>JSON.parse(JSON.stringify(value));
function declaration(name){
  const start=html.search(new RegExp(`^  (?:async )?function ${name}\\(`,"m"));
  assert.notEqual(start,-1,`Missing ${name}`);
  const remainder=html.slice(start),end=remainder.search(/\n  (?:async )?function /);
  return end<0?remainder:remainder.slice(0,end);
}

// Models IndexedDB's serial read/write transactions, including reads whose
// success handler adds a write before the transaction is allowed to complete.
function memoryDB(initial){
  const records=new Map(Object.entries(initial).map(([key,value])=>[key,copy(value)]));
  const queue=[];
  let running=false;
  const run=()=>{
    if(running||!queue.length)return;
    running=true;
    setImmediate(()=>{
      const tx=queue.shift();
      while(tx.operations.length)tx.operations.shift()();
      tx.oncomplete?.();running=false;run();
    });
  };
  return{
    records,
    transaction(){
      const tx={operations:[],objectStore:()=>({
        get(key){const request={};tx.operations.push(()=>{request.result=records.has(key)?copy(records.get(key)):undefined;request.onsuccess?.();});return request;},
        put(value){const saved=copy(value);tx.operations.push(()=>records.set(saved.key,saved));},
      })};
      queue.push(tx);run();return tx;
    },
  };
}

const persistenceFunctions=["toMillis","canonicalRecordJSON","sameSyncValue","mergeEpisodeSetChanges","mergeEpisodeHistory","mergeRecordChanges","detectSyncConflicts","activePersistenceContext","setCloudBaseline","saveCache","cachePut","cacheGet","cloneLibrarySnapshot","createLibrarySnapshot","replayLocalChanges","acknowledgeCloudSnapshot","acknowledgeCachedSnapshot","libraryChangeSet","uploadCloudLibrary","queueLocalLibrarySave","queueCloudLibrarySave","persistLibrary","mergePendingCache","localSyncPending"];
function harness(extra={}){
  const pending=new Set();
  const context=vm.createContext({
    console:{warn(){},error(){}},structuredClone,setTimeout,clearTimeout,AbortController,window:{},
    currentUser:{id:"account"},cloudSessionToken:"token",persistenceGeneration:1,
    localSaveSequence:0,cloudBaseItems:[],cloudRevision:0,mediaItems:[],
    latestLocalSnapshot:null,queuedLocalSnapshot:null,queuedCloudSnapshot:null,
    localSaveInFlight:null,cloudSaveInFlight:null,lastCloudAccountId:"",lastLocalAccountId:"",
    lastCloudLibraryJSON:"",lastLocalLibraryJSON:"",CLOUD_SAVE_COALESCE_MS:0,
    nowISO:()=>"2026-09-05T10:00:00.000Z",render(){},setSync(){},applyPendingAppUpdate(){},
    scheduleCloudSync(){},noteCloudSyncFailure(){},cloudSyncRetryDelay:()=>1000,CLOUD_SYNC_INTERVAL_MS:10000,
    markPending(value,id="account"){if(value)pending.add(id);else pending.delete(id);},
    hasPending:(id="account")=>pending.has(id),
    migratePlannedStatuses:items=>({rows:items}),cleanLibraryRecords:items=>({items}),deduplicateLibrary:items=>({items,removedCount:0,titles:[]}),
    duplicateCleanupMessage:()=>"",showAppToast(){},
    ...extra,
  });
  vm.runInContext(persistenceFunctions.map(declaration).join("\n"),context);
  return context;
}

test("An old acknowledgement preserves newer edits and rebases the next request",async()=>{
  const base=[{id:"a",title:"A"},{id:"b",title:"B"}];
  const first=[{id:"a",title:"A edited"},{id:"b",title:"B"}];
  const newest=[...first,{id:"c",title:"C added locally"}];
  const db=memoryDB({library:{key:"library",userId:"account",items:newest,dirty:true,localSequence:2,cloudItems:base,cloudRevision:0}});
  const app=harness({cacheDB:db,cloudBaseItems:base,mediaItems:newest});
  const sent=app.createLibrarySnapshot(first);
  const waiting=app.createLibrarySnapshot(newest);
  app.latestLocalSnapshot=waiting;app.queuedCloudSnapshot=waiting;
  // The other device deleted B and added D before the first write was merged.
  const accepted=[first[0],{id:"d",title:"D added remotely"}];
  await app.acknowledgeCloudSnapshot(sent,{...sent,items:accepted,json:JSON.stringify(accepted)},{revision:2});
  assert.deepEqual(copy(app.mediaItems).map(row=>row.id).sort(),["a","c","d"]);
  assert.deepEqual(copy(waiting.baseItems),accepted);
  assert.equal(waiting.expectedRevision,2);
  assert.equal(db.records.get("library").dirty,true);
  assert.deepEqual(db.records.get("library").items,copy(app.mediaItems));

  // A further remote edit must survive the queued request's conflict retry.
  const remote=[{id:"a",title:"A changed on other device"},accepted[1]];
  let calls=0;
  app.pinApi=async(action,payload,token,body)=>{
    calls++;
    if(calls===1)throw Object.assign(new Error("Conflict"),{code:"revision_conflict",items:remote,revision:3});
    const outgoing=JSON.parse(body);
    assert.equal(outgoing.expectedRevision,3);
    assert.equal(outgoing.items,undefined,'normal saves never send the whole Library');
    assert.deepEqual(outgoing.changes.map(change=>change.id),['c']);
    assert.equal(outgoing.changes[0].create.title,'C added locally');
    return{ok:true,revision:4};
  };
  await app.uploadCloudLibrary(waiting);
  assert.equal(calls,2);
  assert.equal(db.records.get("library").dirty,false);
  assert.equal(app.mediaItems.find(row=>row.id==="a").title,"A changed on other device");
});

test("Concurrent edits to the same show field are detected without flagging mergeable progress",()=>{
 const c=harness(),base=[{id:"show",title:"Original",platform:"A",watchedEpisodes:{1:[1]}}],local=[{id:"show",title:"Local",platform:"Local service",watchedEpisodes:{1:[1,2]}}],remote=[{id:"show",title:"Remote",platform:"Other service",watchedEpisodes:{1:[1,3]}}];
 const conflicts=c.detectSyncConflicts(base,local,remote);
 assert.deepEqual(copy(conflicts),[{id:"show",key:"title"},{id:"show",key:"platform"}]);
});

test("An offline edit survives when another device deletes the same title",()=>{
 const c=harness(),base=[{id:"shared-show",title:"Shared",platform:"Before"}],local=[{id:"shared-show",title:"Shared",platform:"Edited offline"}],remote=[];
 const merged=c.replayLocalChanges(base,local,remote);
 assert.equal(merged.length,1);assert.equal(merged[0].platform,"Edited offline");
 assert.deepEqual(copy(c.detectSyncConflicts(base,local,remote)),[{id:"shared-show",key:"record"}]);
});

test("A cache acknowledgement cannot overwrite a later device write",async()=>{
  const items=[{id:"a",title:"A"}];
  const db=memoryDB({library:{key:"library",userId:"account",items,localSequence:1,dirty:true,cloudRevision:0}});
  const app=harness({cacheDB:db,mediaItems:items});
  const snapshot=app.createLibrarySnapshot(items);
  const acknowledgement=app.acknowledgeCachedSnapshot(snapshot,snapshot,1);
  const newer=[{id:"a",title:"New edit"}];
  const write=app.saveCache(newer,"",{dirty:true,sequence:2,baseItems:items,baseRevision:1});
  await Promise.all([acknowledgement,write]);
  assert.equal(db.records.get("library").items[0].title,"New edit");
  assert.equal(db.records.get("library").dirty,true);
  assert.equal(db.records.get("library").localSequence,2);
});

test("An unchanged cloud save clears the durable pending marker without a request",async()=>{
  const items=[{id:"a",title:"A"}];
  const db=memoryDB({library:{key:"library",userId:"account",items,localSequence:1,dirty:true,cloudRevision:4}});
  const app=harness({cacheDB:db,mediaItems:items,pinApi:()=>{throw new Error("Unexpected request");}});
  app.setCloudBaseline(items,4);
  const snapshot=app.createLibrarySnapshot(items);
  await app.queueCloudLibrarySave(snapshot);
  assert.equal(db.records.get("library").dirty,false);
  assert.equal(db.records.get("library").cloudRevision,4);
  assert.equal(app.hasPending(),false);
});

test("Signing in again replays pending edits and deletions from that account's cache",()=>{
  const app=harness();
  const cached={userId:"account",dirty:true,cloudItems:[{id:"a",title:"A"},{id:"b",title:"B"}],items:[{id:"a",title:"A saved offline"}]};
  const remote=[{id:"a",title:"A"},{id:"b",title:"B"},{id:"c",title:"New remote title"}];
  assert.deepEqual(copy(app.mergePendingCache(cached,remote)),[{id:"a",title:"A saved offline"},{id:"c",title:"New remote title"}]);
  assert.deepEqual(copy(app.mergePendingCache({...cached,userId:"other"},remote)),remote);
});

test("Conflict replay merges individual fields and concurrent watched episode changes",()=>{
  const app=harness();
  const base=[{id:"show",title:"Show",platform:"Old",nextEpisodeDate:"2026-09-01T19:00:00.000Z",watchedEpisodes:{1:[1]},episodeHistory:[],updatedAt:"2026-09-01T10:00:00.000Z"}];
  const local=[{...base[0],platform:"New",watchedEpisodes:{1:[1,2]},episodeHistory:[{id:"local",kind:"mark",season:1,episode:2,watchedAt:"2026-09-01T11:00:00.000Z"}],updatedAt:"2026-09-01T11:00:00.000Z"}];
  const remote=[{...base[0],nextEpisodeDate:"2026-09-08T19:00:00.000Z",watchedEpisodes:{1:[1,3]},episodeHistory:[{id:"remote",kind:"mark",season:1,episode:3,watchedAt:"2026-09-01T12:00:00.000Z"}],updatedAt:"2026-09-01T12:00:00.000Z"}];
  const [merged]=app.replayLocalChanges(base,local,remote);
  assert.equal(merged.platform,"New");
  assert.equal(merged.nextEpisodeDate,"2026-09-08T19:00:00.000Z");
  assert.deepEqual(copy(merged.watchedEpisodes),{1:[1,2,3]});
  assert.deepEqual(copy(merged.episodeHistory.map(event=>event.id)),["local","remote"]);
});

test("A timed-out or incomplete successful response cannot acknowledge a save",async()=>{
  for(const response of [
    {ok:true,status:200,json:async()=>{throw Object.assign(new Error("Aborted"),{name:"AbortError"});}},
    {ok:true,status:200,json:async()=>({})},
    {ok:true,status:200,json:async()=>({ok:true})},
  ]){
    const app=harness({PIN_API:"https://example.test",CLOUD_REQUEST_TIMEOUT_MS:1000,fetch:async()=>response});
    vm.runInContext(declaration("pinApi"),app);
    await assert.rejects(app.pinApi("save"),error=>["timeout","invalid_response"].includes(error.code));
  }
});

test("A deferred refresh resumes after the save queue drains, but waits after a failed save",async()=>{
  for(const fails of [false,true]){
    let reloads=0;
    const items=[{id:"a",title:"A"}],db=memoryDB({});
    const app=harness({cacheDB:db,mediaItems:items,pendingAppUpdate:true,
      document:{getElementById:id=>id==='modal'?{classList:{contains:()=>true}}:{disabled:false}},
      window:{location:{reload:()=>reloads++}},saveBeforeAppRefresh:()=>{app.pendingAppUpdate=false;reloads++;},
      pinApi:async()=>{if(fails)throw new Error('Offline');return {ok:true,revision:1};}});
    vm.runInContext(declaration('appHasUnsavedWork')+'\n'+declaration('applyPendingAppUpdate'),app);
    await app.persistLibrary(items);
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(reloads,fails?0:1);
    assert.equal(app.pendingAppUpdate,fails);
    assert.equal(Boolean(app.queuedCloudSnapshot),fails);
  }
});

test('Granular saves send only changed fields, watched-episode deltas, creates and deletions',()=>{
 const c=harness(),base=[{id:'s',title:'Show',notes:'old',episodeImages:{1:{1:'large unchanged artwork'}},watchedEpisodes:{1:[1,3],2:[1]}},{id:'keep',title:'Unchanged'},{id:'remove',title:'Removed'}];
 const after=[{...base[0],notes:'new',watchedEpisodes:{1:[1,2],2:[1]}},base[1],{id:'add',title:'Added'}];
 const changes=copy(c.libraryChangeSet(base,after));
 assert.deepEqual(changes,[{id:'s',set:{notes:'new'},unset:[],watched:{1:{add:[2],remove:[3]}}},{id:'add',create:{id:'add',title:'Added'}},{id:'remove',delete:true}]);
 assert.equal(JSON.stringify(changes).includes('large unchanged artwork'),false);
 assert.deepEqual(copy(c.libraryChangeSet(after,after)),[]);
});

test('Clearing a field to undefined removes its stored value',()=>{
 const c=harness(),before=[{id:'title',title:'Title',notes:'old'}],after=[{...before[0],notes:undefined}];
 const changes=copy(c.libraryChangeSet(before,after));assert.deepEqual(changes,[{id:'title',set:{},unset:['notes'],watched:{}}]);
});

function autoSyncHarness(extra={}){
 const scheduled=[],statuses=[];
 const app=harness({cloudSyncTimer:null,cloudSyncInFlight:null,cloudSyncFailures:0,cloudSyncAuthBlocked:false,cloudSyncIdleRounds:0,cloudSyncLastActivity:0,cloudSyncPollDelay:()=>10000,
  navigator:{onLine:true},document:{visibilityState:'visible',addEventListener(){}},window:{addEventListener(){}},authPin:{value:''},authEmail:{value:''},isSignUp:false,updateAuthMode(){},pauseDialogsForAuth(){},showAuth(){},showMessage(){},
  applyAccount(account){app.currentUser={id:account.id};},loadCacheRecord:async()=>app.cacheDB.records.get('library'),
  setSync:(text,state)=>statuses.push({text,state}),...extra});
 vm.runInContext(['retryPendingCloudSave','cloudSyncRetryDelay','cloudSyncPollDelay','noteCloudActivity','scheduleCloudSync','noteCloudSyncFailure','synchronizeCloudLibrary'].map(declaration).join('\n'),app);
 app.scheduleCloudSync=delay=>scheduled.push(delay);
 return {app,scheduled,statuses};
}

test('An automatic pull merges edits made during the read and persists the new cloud baseline',async()=>{
 const base=[{id:'s',title:'Show',notes:'before',watchedEpisodes:{1:[1]}}],remote=[{...base[0],watchedEpisodes:{1:[1,3]}}];
 const db=memoryDB({library:{key:'library',userId:'account',items:base,cloudItems:base,cloudRevision:0,dirty:false,localSequence:0}});
 let release;const read=new Promise(resolve=>release=resolve),writes=[];
 const {app,scheduled}=autoSyncHarness({cacheDB:db,mediaItems:copy(base),cloudBaseItems:copy(base),pinApi:async(action,payload,_token,body)=>{
  if(action==='load'){assert.equal(payload.knownRevision,0);return read;}
  const request=JSON.parse(body);writes.push(request);assert.equal(request.expectedRevision,1);return {ok:true,revision:2};
 }});
 const task=app.synchronizeCloudLibrary();app.mediaItems[0].notes='typed during read';
 release({ok:true,account:{id:'account'},items:remote,revision:1});assert.equal(await task,true);
 assert.equal(app.mediaItems[0].notes,'typed during read');assert.deepEqual(copy(app.mediaItems[0].watchedEpisodes),{1:[1,3]});
 assert.equal(writes.length,1);assert.equal(writes[0].changes[0].set.notes,'typed during read');assert.deepEqual(writes[0].changes[0].watched,{});
 assert.equal(db.records.get('library').dirty,false);assert.equal(db.records.get('library').cloudRevision,2);assert.equal(scheduled.at(-1),10000);
});

test('Overlapping automatic checks share one read and stale responses cannot regress accepted progress',async()=>{
 let release,calls=0;const accepted=[{id:'s',title:'Show',watchedEpisodes:{1:[1,2]}}];
 const {app}=autoSyncHarness({mediaItems:accepted,cloudBaseItems:accepted,cloudRevision:1,pinApi:()=>{calls++;return new Promise(resolve=>release=resolve);}});
 const first=app.synchronizeCloudLibrary(),second=app.synchronizeCloudLibrary();assert.equal(first,second);assert.equal(calls,1);
 app.cloudRevision=2;release({ok:true,account:{id:'account'},items:[],revision:1});assert.equal(await first,true);
 assert.equal(app.cloudRevision,2);assert.deepEqual(copy(app.mediaItems),accepted);
});

test('Late account reads cannot change a newly signed-in account',async()=>{
 let release;const {app}=autoSyncHarness({mediaItems:[],pinApi:()=>new Promise(resolve=>release=resolve)});
 const task=app.synchronizeCloudLibrary();app.currentUser={id:'other'};app.persistenceGeneration++;app.mediaItems=[{id:'private',title:'Other account'}];
 release({ok:true,account:{id:'account'},items:[{id:'old',title:'Old account'}],revision:2});assert.equal(await task,false);
 assert.equal(app.currentUser.id,'other');assert.equal(app.mediaItems[0].id,'private');
});

test('Transient checks back off within a bound and recover without losing the Library',async()=>{
 let fail=true;const items=[{id:'a',title:'Retained'}];
 const {app,scheduled,statuses}=autoSyncHarness({mediaItems:items,pinApi:async()=>{if(fail)throw Error('temporary outage');return {ok:true,account:{id:'account'},unchanged:true,revision:0};}});
 for(let i=0;i<8;i++){assert.equal(await app.synchronizeCloudLibrary(),false);assert.ok(scheduled.at(-1)>=1000&&scheduled.at(-1)<60500);}
 assert.deepEqual(copy(app.mediaItems),items);fail=false;assert.equal(await app.synchronizeCloudLibrary(),true);
 assert.equal(app.cloudSyncFailures,0);assert.equal(scheduled.at(-1),10000);assert.equal(statuses.at(-1).state,'ok');
});

test('Expired sessions stop retrying and retain queued changes for reauthentication',async()=>{
 let shown=0;const items=[{id:'a',title:'Saved locally'}],db=memoryDB({library:{key:'library',userId:'account',items,dirty:true}});
 const {app,scheduled}=autoSyncHarness({cacheDB:db,mediaItems:items,currentUser:{id:'account',email:'same@example.test'},isSignUp:true,showAuth:()=>shown++,pinApi:async()=>{throw Object.assign(Error('expired'),{status:401});}});
 assert.equal(await app.synchronizeCloudLibrary(),false);assert.equal(app.cloudSyncAuthBlocked,true);assert.equal(shown,1);
 assert.equal(app.authEmail.value,'same@example.test');assert.equal(app.isSignUp,false);
 assert.equal(await app.synchronizeCloudLibrary(),false);assert.equal(shown,1);assert.equal(db.records.get('library').dirty,true);
 // The actual scheduler refuses auth-blocked, hidden and offline sessions.
 let timers=0;app.setTimeout=()=>{timers++;return 1;};vm.runInContext(declaration('scheduleCloudSync'),app);
 app.scheduleCloudSync(0);app.cloudSyncAuthBlocked=false;app.document.visibilityState='hidden';app.scheduleCloudSync(0);
 app.document.visibilityState='visible';app.navigator.onLine=false;app.scheduleCloudSync(0);assert.equal(timers,0);
 app.navigator.onLine=true;app.scheduleCloudSync(0);assert.equal(timers,1);assert.ok(scheduled.length);
});

test('Conditional load acknowledgements require the exact requested revision',async()=>{
 for(const [knownRevision,returnedRevision,valid] of [[4,4,true],[4,3,false],[undefined,4,false]]){
  const app=harness({PIN_API:'https://example.test',CLOUD_REQUEST_TIMEOUT_MS:1000,fetch:async()=>({ok:true,json:async()=>({ok:true,account:{id:'account'},unchanged:true,revision:returnedRevision})})});
  vm.runInContext(declaration('pinApi'),app);
  if(valid)assert.equal((await app.pinApi('load',{knownRevision})).unchanged,true);
  else await assert.rejects(app.pinApi('load',{knownRevision}),error=>error.code==='invalid_response');
 }
});

test('A failed device write cannot upload an older cached copy and is retried before cloud sync',async()=>{
 const base=[{id:'a',title:'A',notes:'old'}],edited=[{...base[0],notes:'new'}],db=memoryDB({library:{key:'library',userId:'account',items:base,cloudItems:base,cloudRevision:0,dirty:false,localSequence:0}});
 const writes=[];const {app}=autoSyncHarness({cacheDB:db,cloudBaseItems:base,mediaItems:edited,pinApi:async(action,payload,_token,body)=>{if(action==='load')return {ok:true,account:{id:'account'},unchanged:true,revision:1};writes.push(JSON.parse(body));return {ok:true,revision:1};}});
 app.latestLocalSnapshot=app.createLibrarySnapshot(edited);app.markPending(true);const save=app.queueLocalLibrarySave;app.queueLocalLibrarySave=async()=>{throw Error('device write failed');};
 assert.equal(await app.synchronizeCloudLibrary(),false);assert.equal(writes.length,0);assert.equal(db.records.get('library').items[0].notes,'old');
 app.queueLocalLibrarySave=save;assert.equal(await app.synchronizeCloudLibrary(),true);
 assert.equal(writes.length,1);assert.equal(writes[0].changes[0].set.notes,'new');assert.equal(db.records.get('library').items[0].notes,'new');assert.equal(db.records.get('library').dirty,false);
});


test('A safety-blocked empty save restores cloud titles while retaining an independent new title',async()=>{
 const original=[{id:'a',title:'A'},{id:'b',title:'B'}],server=[{id:'a',title:'A updated remotely'},original[1]],local=[{id:'c',title:'New title'}];
 const db=memoryDB({library:{key:'library',userId:'account',items:local,localSequence:1,cloudItems:original,cloudRevision:1}});
 const app=harness({cacheDB:db,mediaItems:local,cloudBaseItems:original,cloudRevision:1,localSaveSequence:1});let calls=0;
 app.pinApi=async(action,payload,token,body)=>{
  if(++calls===1)throw Object.assign(Error('Removal blocked'),{code:'library_safety_block',items:server,revision:2});
  const request=JSON.parse(body);assert.equal(request.expectedRevision,2);
  assert.equal(request.changes.length,1);assert.equal(request.changes[0].create.title,'New title');return{ok:true,revision:3};
 };
 await app.uploadCloudLibrary(app.createLibrarySnapshot(local,{sequence:1}));
 assert.equal(calls,2);assert.equal(app.mediaItems.length,3);
 assert.equal(app.mediaItems.find(row=>row.id==='a').title,'A updated remotely');assert.equal(db.records.get('library').items.length,3);
});

test('Device recovery copies survive an empty overwrite and retain the five most recent nonempty versions',async()=>{
 const db=memoryDB({library:{key:'library',userId:'account',items:[{id:'a',title:'A'}]}}),app=harness({cacheDB:db});
 await app.cachePut({key:'library',userId:'account',items:[]},db);
 assert.equal(db.records.get('library-recovery').versions[0].items[0].title,'A');
 for(let i=0;i<7;i++)await app.cachePut({key:'library',userId:'account',items:[{id:'a',title:'Version '+i}]},db);
 assert.equal(db.records.get('library-recovery').versions.length,5);assert.equal(db.records.get('library-recovery').versions[0].items[0].title,'Version 5');
 await app.cachePut({key:'library',userId:'different-account',items:[]},db);
 assert.equal(db.records.get('library-recovery').userId,'account','another account cannot overwrite this recovery history');
});
