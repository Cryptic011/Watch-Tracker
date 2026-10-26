import test from "node:test";
import {stripTypeScriptTypes} from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"supabase/functions/watchlog-reminders/index.ts"),"utf8");
function extract(name){
  const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1,`Missing ${name}`);
  const bodyStart=source.indexOf("{",start);let depth=0;
  for(let i=bodyStart;i<source.length;i++){if(source[i]==="{")depth++;else if(source[i]==="}"&&--depth===0)return source.slice(start,i+1);}
  throw new Error(`Could not extract ${name}`);
}

test("server refresh advances to the next true episode and keeps UTC timestamps",()=>{
  const context=vm.createContext({Date,Number,Array,Set,String,Object});
  vm.runInContext(["episodeUtcValue","episodeReleaseTime","buildServerEpisodeSchedule"].map(extract).join("\n")+"\nthis.build=buildServerEpisodeSchedule;",context);
  const item={id:"show",type:"Series",watchedEpisodes:{1:[1]},tvmazeShowId:"1"};
  const episodes=[
    {season:1,number:1,name:"One",airstamp:"2026-09-01T20:00:00+01:00"},
    {season:1,number:2,name:"Two",airstamp:"2026-09-10T20:00:00+01:00"},
    {season:1,number:3,name:"Three",airstamp:"2026-09-03T20:00:00+01:00"},
  ];
  const result=context.build(item,episodes,new Date("2026-09-06T12:00:00Z").getTime());
  assert.deepEqual(JSON.parse(JSON.stringify(result.releasedEpisodes)),{1:[1,3]});
  assert.equal(result.latestEpisodeNum,3);
  assert.equal(result.latestEpisodeDate,"2026-09-03T19:00:00.000Z");
  assert.equal(result.nextEpisodeNum,2);
  assert.equal(result.nextEpisodeDate,"2026-09-10T19:00:00.000Z");
  assert.deepEqual(result.watchedEpisodes,{1:[1]});
});

test("Weekly Releases opt-out disables episode reminders and re-enabling restores them", () => {
  const context = vm.createContext({ Date, Number, Array, Set, String, Object });
  vm.runInContext(
    ["plannedEvent", "reminderEvents"].map(name => extract(name).replace(/: Record<string, unknown>/g, "")).join("\n") + "\nthis.reminderEvents = reminderEvents;",
    context,
  );
  const show = {
    id: "show-1",
    type: "Series",
    status: "Watching",
    hideFromWeeklyReleases: false,
    nextEpisodeDate: "2026-11-01T20:00:00.000Z",
    nextEpisodeNum: 4,
    scheduledEpisodeReleases: [{ season: 2, number: 4, raw: "2026-11-01T20:00:00.000Z" }],
  };

  assert.equal(context.reminderEvents(show).length, 1, "enabled show has a reminder event");
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.reminderEvents({ ...show, hideFromWeeklyReleases: true }))),
    [],
    "excluded show has no reminder events, including known scheduled episodes",
  );
  assert.equal(
    context.reminderEvents({ ...show, hideFromWeeklyReleases: false }).length,
    1,
    "re-including the show restores reminder eligibility without changing its schedule",
  );
});

test('Release alerts survive an empty schedule, advancing next pointer and provider refresh failure',()=>{
 const c=vm.createContext({Date,Number,Array,Set,String,Object,Map});
 vm.runInContext(['plannedEvent','reminderEvents'].map(name=>extract(name).replace(/: Record<string, unknown>/g,'')).join('\n'),c);
 const raw='2026-10-26T00:00:00Z',later='2026-11-02T00:00:00Z';
 const item={type:'Series',status:'Watched',airingSeason:3,latestEpisodeNum:4,latestEpisodeDate:raw,nextEpisodeNum:5,nextEpisodeDate:later,scheduledEpisodeReleases:[],recurringWeeklySchedule:{episodes:[{season:3,number:4,raw},{season:3,number:5,raw:later}]}};
 const original=JSON.stringify(item),events=c.reminderEvents(item);
 assert.equal(events.length,2);assert.equal(events[0].raw,raw);assert.equal(events[1].raw,later);
 assert.equal(c.reminderEvents({...item,recurringWeeklySchedule:null,latestEpisodeDate:''}).length,1);
 assert.equal(c.reminderEvents({...item,scheduledEpisodeReleases:[null,{season:3,number:5,raw:'2026-11-03T00:00:00Z'}]})[1].raw,'2026-11-03T00:00:00Z');
 assert.equal(c.reminderEvents({...item,hideFromWeeklyReleases:true}).length,0);
 assert.equal(c.reminderEvents({type:'Series',nextEpisodeNum:2,nextEpisodeDate:raw})[0].raw,raw,'a missing season number does not suppress a known episode date');
 assert.equal(JSON.stringify(item),original);
});

test('Release processing sends at-release alerts for Planned seasons, films and watched episodes',async()=>{
 const now=Date.parse('2026-10-26T20:00:00Z'),raw=new Date(now).toISOString(),sent=[];
 class Clock extends Date {static now(){return now;}}
 const c=vm.createContext({Date:Clock,Number,Array,Set,String,Object,Map,TextEncoder,crypto,Response,URL,AbortSignal,console,Deno:{env:{get:()=>''},serve(){}},createClient:()=>({})});
 vm.runInContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?from "npm:web-push-neo@0\.1\.2";\n/m,'')),c);
 const items=[{id:'season',title:'Season premiere',type:'Series',status:'Planned',nextSeasonNum:2,nextSeasonDate:raw},{id:'film',title:'Film premiere',type:'Film',status:'Planned',filmReleaseDate:raw},{id:'show',title:'Returning series',type:'Series',status:'Watched',airingSeason:2,nextEpisodeNum:3,nextEpisodeDate:raw,scheduledEpisodeReleases:[]}];
 c.readLibraries=async()=>[{account_id:'account',items}];c.refreshServerEpisodeSchedules=async rows=>rows;
 c.claimDelivery=async()=>({id:'delivery',attempts:1});c.finishDelivery=async()=>{};c.sendPush=async(row,config,payload)=>sent.push(payload);
 const result=await c.processPlannedReminders([{account_id:'account',time_zone:'Europe/London'}],{});
 assert.equal(result.sent,3);assert.equal(result.failed,0);
 assert.deepEqual(sent.map(p=>p.title),['Season premiere','Film premiere','Returning series']);
 assert.ok(sent.every(p=>/now available/i.test(p.body)),'release alerts must not be replaced with late advance reminders');
});

test('Streaming-first worker never sends a UK Marshals release at US broadcast time',async()=>{
 let clock=Date.parse('2026-10-26T00:00:00Z');const sent=[],claimed=new Set();
 class Clock extends Date {static now(){return clock;}}
 const c=vm.createContext({Date:Clock,Number,Array,Set,String,Object,Map,Intl,TextEncoder,crypto,Response,URL,AbortSignal,console,Deno:{env:{get:()=>''},serve(){}},createClient:()=>({})});
 vm.runInContext(fs.readFileSync(path.join(root,'assets/js/regional-releases.js'),'utf8'),c);
 vm.runInContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?from "npm:web-push-neo@0\.1\.2";\n/m,'')),c);
 const item={id:'marshals',title:'Marshals',type:'Series',status:'Watching',tvmazeShowId:'84526',imdbId:'tt36849871',platform:'CBS',airingSeason:2,nextEpisodeNum:4,nextEpisodeDate:'2026-10-26T00:00:00Z',scheduledEpisodeReleases:[{season:2,number:4,raw:'2026-10-26T00:00:00Z'}]};
 c.readLibraries=async()=>[{account_id:'account',items:[item,{...item,id:'unverified',tvmazeShowId:'99999',imdbId:'tt9999999',title:'Unverified streaming'}]}];c.refreshServerEpisodeSchedules=async rows=>rows;
 c.claimDelivery=async(row,account,id,key)=>{if(claimed.has(key))return null;claimed.add(key);return{id:'delivery',attempts:1};};c.finishDelivery=async()=>{};c.sendPush=async(row,config,payload)=>sent.push(payload);
 const subscriptions=[{account_id:'account',locale:'en-GB',time_zone:'Europe/London'}];
 await c.processPlannedReminders(subscriptions,{});
 assert.equal(sent.filter(p=>/now available/i.test(p.body)).length,0,'US broadcast midnight is not UK streaming release');
 assert.ok(sent.every(p=>p.title==='Marshals'),'unverified streaming availability must not use broadcast dates');
 sent.length=0;clock=Date.parse('2026-10-26T08:00:00Z');
 await c.processPlannedReminders(subscriptions,{});
 assert.equal(sent.length,1);assert.equal(sent[0].body,'New episode now available on Paramount+');
 assert.match(sent[0].data.eventKey,/2026-10-26T08:00:00.000Z:lead-0h$/);
 assert.equal((await c.processPlannedReminders(subscriptions,{})).sent,0);
});
