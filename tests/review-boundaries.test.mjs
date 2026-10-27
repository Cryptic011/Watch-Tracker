import { readAppSource } from "./app-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {stripTypeScriptTypes} from "node:module";

const html = readAppSource();
const backend=stripTypeScriptTypes(fs.readFileSync(new URL("../supabase/functions/watchlog-reminders/index.ts",import.meta.url),"utf8"));
const suite=fs.readFileSync(new URL("./app-behavior.test.mjs",import.meta.url),"utf8");
const helper=suite.slice(suite.indexOf("function extractFunction"),suite.indexOf('test("Current'));
const {extractFunction}=new Function("html","assert","vm",helper+"\nreturn {extractFunction};")(html,assert,vm);
const copy=value=>JSON.parse(JSON.stringify(value));
const baseShow=()=>({id:"show",title:"Example",type:"Series",status:"Watching",tvmazeShowId:"1",totalSeasons:1,curSeason:1,curEp:5,watchedSeasons:0,watchedEpisodes:{1:[1,2,3,4,5]},airedEpisodeCounts:{1:6},episodeCounts:{1:8},episodeScheduleVerified:true,verifiedCompletedSeasons:0});
function frontend(extra={}){
  const names=["canonicalRecordJSON","sameSyncValue","mergeEpisodeSetChanges","mergeEpisodeHistory","mergeRecordChanges","replayLocalChanges","toMillis","toLocalInput","storedDateFromInput","episodeReleaseTimestamp","normalizeReleasedEpisodeMap","positiveEpisodeMap","isEpisodeTrackable","releasedEpisodeMap","normalizeWatchedEpisodeMap","progressWatchedEpisodeMap","highestWatchedEpisode","migratePlannedStatuses","knownSeasonTotal","isWeakFilmRecord"];
  const context=vm.createContext({console,nowISO:()=>"2026-09-06T12:00:00Z",localISODate:()=>"2026-09-06",...extra});
  vm.runInContext(names.map(name=>extractFunction(html,name)).join("\n"),context);
  return context;
}

test("Metadata-only sync preserves remote ticks and merged progress follows both devices",()=>{
  const app=frontend(),base=baseShow();
  const remote={...base,curEp:6,watchedEpisodes:{1:[1,2,3,4,5,6]}};
  const local={...base,nextEpisodeNum:7};
  const merged=app.replayLocalChanges([base],[local],[remote])[0];
  assert.deepEqual(copy(merged.watchedEpisodes),remote.watchedEpisodes);
  assert.equal(merged.curEp,6);
  const edited={...base,curEp:4,watchedEpisodes:{1:[1,2,3,4]}};
  const combined=app.replayLocalChanges([base],[edited],[remote])[0];
  assert.deepEqual(copy(combined.watchedEpisodes),{1:[1,2,3,4,6]});
  assert.equal(combined.curEp,6);
  assert.deepEqual(copy(app.replayLocalChanges([base],[edited],[])),[edited]);
});

test("Actual editor save keeps legacy ticks and stored UTC while updating progress",async()=>{
  const previous={...baseShow(),nextEpisodeDate:"2026-09-10T12:00:00.000Z",nextEpisodeNum:7};
  const values={"item-id":"show",title:"Example",type:"Series",status:"Watching","tvmaze-id":"1","cur-season":"1","cur-ep":"6","watched-seasons":"0","total-seasons":"1","next-episode-num":"7"};
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:values[id]??""});return nodes.get(id);};
  const app=frontend({currentUser:{id:"test"},mediaForm:{},saveBtn:{},$,mediaItems:[previous],
    freshEditorVerification:()=>null,pendingEditorVerification:()=>null,scheduleMetadataRefresh(){},
    findTrackedDuplicate:()=>null,normalizeTitle:value=>value.toLowerCase(),sameRecordWithoutUpdateTime:()=>false,
    render(){},closeEditor(){},showAppToast(){},persistLibrary:async()=>{},alert:message=>{throw Error(message);}});
  $("next-episode-date").value=app.toLocalInput(previous.nextEpisodeDate);
  vm.runInContext(html.slice(html.indexOf("mediaForm.onsubmit=async e=>{"),html.indexOf("  deleteBtn.onclick=")),app);
  await app.mediaForm.onsubmit({preventDefault(){}});
  assert.deepEqual(copy(app.mediaItems[0].watchedEpisodes),{1:[1,2,3,4,5,6]});
  assert.equal(app.mediaItems[0].nextEpisodeDate,previous.nextEpisodeDate);
  $("cur-ep").value="3";
  await app.mediaForm.onsubmit({preventDefault(){}});
  assert.deepEqual(copy(app.mediaItems[0].watchedEpisodes),{1:[1,2,3]});
  assert.equal(app.mediaItems[0].lastWatchedEpisode,3);
  assert.equal(app.storedDateFromInput("2026-09-10T12:00","2026-09-10"),"2026-09-10");
});

function workerHarness(episodes,options={}){
  let clock=Date.parse("2026-09-06T12:00:00Z"),calls=0,regionalCalls=0;
  let library={account_id:"a",revision:0,items:[{...baseShow(),nextEpisodeNum:6,nextEpisodeDate:"2026-09-06T12:00:00Z"}]};
  const deliveries=[],claimed=new Set();
  function query(payload=null){
    const filters={};
    return{select(){return this;},eq(key,value){filters[key]=value;return this;},
      in:async()=>({data:[copy(library)]}),
      maybeSingle:async()=>{
        if(!payload)return{data:copy(library)};
        if(filters.revision!==library.revision)return{data:null};
        library={...library,...copy(payload)};return{data:{account_id:library.account_id}};
      }};
  }
  const context=vm.createContext({console,AbortSignal,URL,Date:class extends Date{static now(){return clock;}},
    fetch:async url=>{if(new URL(url).pathname==='/schedule/web'){regionalCalls++;return{ok:true,json:async()=>[]};}calls++;if(options.fail)throw Error("offline");if(options.conflict)library={...library,revision:library.revision+1,items:[]};return{ok:true,json:async()=>episodes};},
    db:{from:()=>({select:()=>query(),update:payload=>query(payload)}),rpc:async(name,args)=>{
      if(name==='watchlog_read_libraries')return {data:[copy(library)]};
      if(args.p_revision!==library.revision)return {data:{ok:false,code:'revision_conflict'}};
      library={...library,revision:library.revision+1,items:library.items.map(item=>{const change=args.p_changes.find(change=>change.id===item.id);return change?{...item,...copy(change.set)}:item;})};
      return {data:{ok:true,revision:library.revision}};
    }},
    claimDelivery:async(_sub,_account,_id,key)=>{if(claimed.has(key))return null;claimed.add(key);return{id:key};},
    sendPush:async(_sub,_config,payload)=>deliveries.push(payload),finishDelivery:async()=>{},sha256:async value=>value});
  if(options.regional)vm.runInContext(fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/regional-releases.js',import.meta.url),'utf8'),context);
  const asyncNames=["readLibraries","refreshServerEpisodeSchedules","processPlannedReminders"];
  const names=["episodeUtcValue","episodeReleaseTime","buildServerEpisodeSchedule","zonedLocalToUtc","scheduledEventTime","serverScheduleRefreshDue",...asyncNames,"plannedEvent","reminderEvents","reminderCopy","reminderStageIsDue"];
  // extractFunction retains the declaration's own async keyword. Do not
  // prepend it again: "async async function" fails to parse before any
  // reminder-worker regression tests can execute.
  vm.runInContext("const EPISODE_SCHEDULE_REFRESH_MS=21600000;\n"+names.map(name=>extractFunction(backend,name)).join("\n"),context);
  return{context,deliveries,setTime:value=>clock=Date.parse(value),setStatus:value=>library.items[0].status=value,getLibrary:()=>library,getCalls:()=>calls,getRegionalCalls:()=>regionalCalls,
    run:()=>context.processPlannedReminders([{account_id:"a",time_zone:"Europe/London"}],{})};
}

test('Closed-app backend refreshes episode and regional schedules before sending a reminder',async()=>{
  const worker=workerHarness([{season:1,number:6,airstamp:'2026-09-06T12:00:00Z'}],{regional:true});
  worker.setTime('2026-09-06T16:00:00Z'); // Existing airtime + four-hour availability rule.
  assert.equal(vm.runInContext('typeof document',worker.context),'undefined');
  assert.equal(vm.runInContext('typeof window',worker.context),'undefined');
  assert.equal((await worker.run()).sent,1);
  assert.equal(worker.getCalls(),1,'the server fetches fresh episode metadata itself');
  assert.equal(worker.getRegionalCalls(),30,'browser visibility cancellation cannot stop the backend feed queue');
  assert.equal(worker.deliveries[0].body,'New episode out now');
  assert.ok(worker.getLibrary().items[0].serverScheduleUpdatedAt,'the server persists its own schedule refresh');
  assert.deepEqual(worker.getLibrary().items[0].watchedEpisodes,{1:[1,2,3,4,5]});
  assert.equal((await worker.run()).sent,0,'later cron scans cannot resend the same reminder');
});

test("Cron keeps release-time alerts after rollover and advances without opening the app",async()=>{
  const episodes=[6,7,8].map((number,index)=>({season:1,number,airstamp:new Date(Date.parse("2026-09-06T12:00:00Z")+index*7*86400000).toISOString()}));
  const worker=workerHarness(episodes);
  for(const [index,status] of ["Planned","Watching","Watched"].entries()){
    worker.setStatus(status);worker.setTime(episodes[index].airstamp);
    assert.ok((await worker.run()).sent>0);
    assert.ok(worker.deliveries.some(payload=>payload.body==='New episode out now'&&payload.data.eventKey.includes(`e${index+6}:`)));
    assert.equal((await worker.run()).sent,0);
  }
  assert.deepEqual(worker.getLibrary().items[0].watchedEpisodes,{1:[1,2,3,4,5]});
});

test("Every episode in a same-time release receives its own reminder",async()=>{
  const worker=workerHarness([{season:1,number:6,airstamp:"2026-09-06T12:00:00Z"},{season:1,number:7,airstamp:"2026-09-06T12:00:00Z"}]);
  await worker.run();
  const release=worker.deliveries.filter(payload=>payload.body==='New episode out now');
  assert.equal(release.length,2);
  assert.equal(new Set(release.map(row=>row.data.eventKey)).size,2);
  assert.equal(worker.deliveries.length,2,'a release scan does not also send stale advance reminders');
});

test('Background scans catch up only the current reminder stage',async()=>{
  const release='2026-09-06T12:00:00Z';
  for(const [clock,expected] of [
    ['2026-09-05T11:59:59Z',[]],
    ['2026-09-05T12:00:00Z',['New episode out in 1 day']],
    ['2026-09-06T06:00:00Z',['New episode out in 6 hours']],
    ['2026-09-06T12:00:00Z',['New episode out now']],
    ['2026-09-07T12:00:00Z',[]],
  ]){
    const worker=workerHarness([{season:1,number:6,airstamp:release}]);
    worker.setTime(clock);await worker.run();
    assert.deepEqual(worker.deliveries.map(row=>row.body),expected,clock);
    assert.equal((await worker.run()).sent,0,'repeated scans cannot duplicate the stage');
  }
});

test("Provider failure preserves saved progress and a concurrent deletion suppresses stale alerts",async()=>{
  const offline=workerHarness([],{fail:true});await offline.run();
  assert.deepEqual(offline.getLibrary().items[0].watchedEpisodes,{1:[1,2,3,4,5]});
  assert.equal(offline.getLibrary().revision,0);
  const conflict=workerHarness([{season:1,number:6,airstamp:"2026-09-06T12:00:00Z"}],{conflict:true});
  assert.equal((await conflict.run()).sent,0);
  assert.deepEqual(conflict.getLibrary().items,[]);
});

test("UTC instants schedule identically across subscription time zones",()=>{
  const app=frontend(),worker=workerHarness([]).context;
  const raw=app.episodeReleaseTimestamp({airstamp:"2026-09-06T13:00:00+01:00"});
  for(const zone of ["Europe/London","America/New_York","Asia/Tokyo"]){
    assert.equal(worker.scheduledEventTime(raw,zone),Date.parse("2026-09-06T12:00:00Z"));
  }
});

test('Reminder notifications use the title as heading and a concise release message',()=>{
 const c=vm.createContext({});vm.runInContext(extractFunction(backend,'reminderCopy'),c);
 for(const [item,event,lead,body] of [
  [{title:'NCIS'},{kind:'episode',season:23,number:2},6,'New episode out in 6 hours'],
  [{title:'Doomsday'},{kind:'film'},24,'Film out in 1 day'],
  [{title:'Reacher'},{kind:'season',number:4},6,'New episode out in 6 hours'],
  [{title:'Ted Lasso'},{kind:'episode',season:3,number:2},0,'New episode out now'],
  [{title:'Reacher'},{kind:'season',number:4},0,'New episode out now'],
  [{title:'Doomsday'},{kind:'film'},0,'Film out now'],
 ]){const copy=c.reminderCopy(item,event,lead);assert.equal(copy.title,item.title);assert.equal(copy.body,body);}
});

test('Saving an older edit form preserves episode ticks received from another device',async()=>{
 const base=baseShow(),remote={...base,platform:'Old',curEp:6,lastWatchedEpisode:6,watchedEpisodes:{1:[1,2,3,4,5,6]}};
 const values={'item-id':'show',title:'Example',type:'Series',status:'Watching','tvmaze-id':'1','cur-season':'1','cur-ep':'5','watched-seasons':'0','total-seasons':'1',platform:'New service'};
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:values[id]??''});return nodes.get(id);};
 const app=frontend({currentUser:{id:'test'},mediaForm:{_baseItem:{...base,platform:'Old'}},saveBtn:{},$,mediaItems:[remote],
  freshEditorVerification:()=>null,pendingEditorVerification:()=>null,scheduleMetadataRefresh(){},findTrackedDuplicate:()=>null,normalizeTitle:value=>value.toLowerCase(),sameRecordWithoutUpdateTime:()=>false,
  render(){},closeEditor(){},showAppToast(){},persistLibrary:async()=>{},alert:message=>{throw Error(message);}});
 vm.runInContext(html.slice(html.indexOf('mediaForm.onsubmit=async e=>{'),html.indexOf('  deleteBtn.onclick=')),app);
 await app.mediaForm.onsubmit({preventDefault(){}});
 assert.equal(app.mediaItems[0].platform,'New service');assert.deepEqual(copy(app.mediaItems[0].watchedEpisodes),remote.watchedEpisodes);assert.equal(app.mediaItems[0].curEp,6);
});
