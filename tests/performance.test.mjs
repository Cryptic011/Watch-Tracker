process.env.TZ = "UTC";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readAppSource} from './app-source.mjs';
const html=readAppSource();
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(html,assert,vm);
function functions(names,globals={}){
 const c=vm.createContext(globals);
 vm.runInContext(names.map(name=>extractFunction(html,name)).join('\n'),c);
 return c;
}
test('Quiet sync backs off to one minute but tracker activity and pending saves retain fast polling',()=>{
 let time=100000,tracker=null,pending=false;
 const c=functions(['cloudSyncPollDelay'],{Date:{now:()=>time},document:{querySelector:()=>tracker},cloudSyncLastActivity:0,cloudSyncIdleRounds:0,CLOUD_SYNC_INTERVAL_MS:10000,hasPending:()=>pending,localSyncPending:()=>false});
 for(const [round,delay] of [[0,10000],[1,20000],[2,40000],[3,60000],[99,60000]]){c.cloudSyncIdleRounds=round;assert.equal(c.cloudSyncPollDelay(),delay);}
 tracker={};assert.equal(c.cloudSyncPollDelay(),10000);tracker=null;
 pending=true;assert.equal(c.cloudSyncPollDelay(),10000);pending=false;
 c.cloudSyncLastActivity=time-1000;assert.equal(c.cloudSyncPollDelay(),10000);
});
test('Metadata maintenance and pending-reminder retries leave no recurring timer while hidden',()=>{
 for(const name of ['scheduleMetadataMaintenance','scheduleReminderStatusRetry']){
  const timers=new Map();let serial=0;
  const c=functions([name],{metadataMaintenanceTimer:null,backgroundReminderRetryTimer:null,backgroundReminderConnection:'pending',publicMaintenance:{enabled:false},currentUser:{id:'a'},navigator:{onLine:true},document:{visibilityState:'visible'},SERIES_RELEASE_CHECK_MS:60000,setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id)});
  c[name]();assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,60000);
  c.document.visibilityState='hidden';c[name]();assert.equal(timers.size,0);
  c.document.visibilityState='visible';c.navigator.onLine=false;c[name]();assert.equal(timers.size,0);
  c.navigator.onLine=true;c.currentUser=null;c[name]();assert.equal(timers.size,0);
  if(name==='scheduleMetadataMaintenance'){c.publicMaintenance.enabled=true;c[name]();assert.equal(timers.size,1,'an open maintenance notice can recover without reloading');}
 }
});
const sortNames=['isEpisodeTrackable','currentSortInfo','releaseSortInfo','addedSortTime','watchedSortTime','compareCurrentOrder','compareRecentOrder','compareReleaseRecency','sortMediaRows'];
test('Timeline sorts calculate expensive keys once per title and retain existing order',()=>{
 const now=Date.now();
 const rows=Array.from({length:400},(_,i)=>({id:String(i),title:'Show '+i,type:i%4?'Series':'Film',latestEpisodeDate:new Date(now-(i%20)*86400000).toISOString(),nextEpisodeDate:new Date(now+(i%10)*86400000).toISOString(),filmReleaseDate:'2024-01-01',nextEpisodeNum:5,createdAt:new Date(now-i*1000).toISOString(),scheduledEpisodeReleases:Array.from({length:24},(_,j)=>({season:1,number:j+1,raw:new Date(now-j*86400000).toISOString()}))}));
 for(const [mode,compare] of [['current','compareCurrentOrder'],['recent','compareRecentOrder'],['release','compareReleaseRecency']]){
  const clock=class extends Date{static now(){return now;}};
  const c=functions(sortNames,{Date:clock,activeSort:mode,titleCollator:new Intl.Collator('en-GB',{numeric:true})});
  const expected=[...rows].sort((a,b)=>c[compare](a,b,now)).map(item=>item.id);
  let currentCalls=0,releaseCalls=0;
  const current=c.currentSortInfo,release=c.releaseSortInfo;
  c.currentSortInfo=(...args)=>{currentCalls++;return current(...args);};
  c.releaseSortInfo=(...args)=>{releaseCalls++;return release(...args);};
  const result=c.sortMediaRows(rows).rows;
  assert.deepEqual(Array.from(result,item=>item.id),expected,mode+' keeps the established timeline');
  assert.equal(currentCalls,mode==='release'?0:rows.length);
  assert.equal(releaseCalls,mode==='current'?0:rows.length);
  assert.equal(rows[0].id,'0','sorting does not rearrange the saved library');
  rows[0].latestEpisodeDate=new Date(now-1000).toISOString();
  const nextExpected=[...rows].sort((a,b)=>c[compare](a,b,now)).map(item=>item.id);
  assert.deepEqual(Array.from(c.sortMediaRows(rows).rows,item=>item.id),nextExpected,'in-place changes cannot reuse stale sort keys');
 }
});
test('Statistics normalize released and watched progress once per show',()=>{
 const names=['isEpisodeTrackable','positiveEpisodeMap','normalizeReleasedEpisodeMap','releasedEpisodeMap','normalizeWatchedEpisodeMap','legacyWatchedEpisodeMap','watchedEpisodeMap','nextWatchEpisode','watchStatistics'];
 const c=functions(names);
 let releases=0,watched=0;const released=c.releasedEpisodeMap,seen=c.watchedEpisodeMap;
 c.releasedEpisodeMap=(...args)=>{releases++;return released(...args);};
 c.watchedEpisodeMap=(...args)=>{watched++;return seen(...args);};
 const rows=Array.from({length:200},(_,id)=>({id,type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,3]},watchedEpisodes:{1:[1,2]}}));
 const result=c.watchStatistics(rows);
 assert.equal(result.episodesWatched,400);assert.equal(result.showsInProgress,200);
 assert.equal(releases,rows.length);assert.equal(watched,rows.length);
});
test('Saves on Settings and Search do not sort or rebuild the hidden Library',()=>{
 let trackers=0;
 const c=functions(['render'],{renderFrame:0,currentUser:{id:'account'},currentTab:'settings',
  $:()=>({classList:{toggle(){}}}),categoryControlsVisible:()=>false,updateCounts(){},updateFloatingAddVisibility(){},renderDashboard(){},
  currentVisibleMediaRows(){throw Error('Hidden Library must not be sorted');},updateEpisodeTracker(){trackers++;}});
 c.render();c.currentTab='search';c.render();assert.equal(trackers,2);
});
test('Hidden Settings does not calculate watch statistics',()=>{
 let reads=0;
 const c=functions(['renderWatchStatistics'],{currentUser:{id:'account'},currentTab:'library',watchStatistics(){reads++;throw Error('Hidden statistics');}});
 c.renderWatchStatistics();c.currentTab='search';c.renderWatchStatistics();c.currentUser=null;c.currentTab='settings';c.renderWatchStatistics();assert.equal(reads,0);
});
test('Recurring schedule wakes at airing, 24-hour rollover, or GMT midnight',()=>{
 const c=functions(['recurringScheduleDelay']);
 const now=new Date(2026,9,23,12),air=new Date(now.getTime()+2*3600000);
 assert.equal(c.recurringScheduleDelay([{date:air}],now),2*3600000);
 const aired=new Date(now.getTime()-23*3600000);
 assert.equal(c.recurringScheduleDelay([{date:aired}],now),3600000);
 const midnight=new Date(now);midnight.setHours(24,0,0,0);
 assert.equal(c.recurringScheduleDelay([],now),midnight-now,'empty/TBA schedules do not wake every minute');
 const boundary=new Date(air.getTime()+86400000);
 assert.ok(c.recurringScheduleDelay([{date:air}],boundary)>0,'an expired release cannot create a zero-delay timer loop');
});
test('An unchanged Library keeps its existing poster DOM',()=>{
 const c=vm.createContext({window:{},URL,AbortSignal,document:{querySelectorAll:()=>[]}});
 vm.runInContext(fs.readFileSync(new URL('../library-gallery.js',import.meta.url),'utf8'),c);
 let writes=0;
 const host={classList:{add(){}},addEventListener(){},querySelectorAll:()=>[],set innerHTML(value){writes++;this.markup=value;}};
 const rows=[{id:'film',type:'Film',title:'Film'}],api={};
 c.window.WatchLogGallery.mount(host,rows,api);
 c.window.WatchLogGallery.mount(host,structuredClone(rows),api);
 assert.equal(writes,1,'saving identical content must preserve focus and loaded posters');
 c.window.WatchLogGallery.mount(host,[],api);assert.equal(writes,2);
});

test('A long season is applied as one progress update with bounded work',()=>{
 const names=['isEpisodeTrackable','positiveEpisodeMap','toMillis','normalizeReleasedEpisodeMap','releasedEpisodeMap','releasedEpisodeCounts','normalizeWatchedEpisodeMap','legacyWatchedEpisodeMap','watchedEpisodeMap','highestWatchedEpisode','fullyWatchedSeasonCount','applyEpisodeToggle','applySeasonToggle'];
 const c=functions(names,{localISODate:()=> '2026-10-23'});
 const released=Array.from({length:500},(_,i)=>i+1),events=released.map(episode=>({id:'mark-'+episode,season:1,episode,kind:'mark',watchedAt:'2026-10-23T12:00:00Z'}));
 const item={type:'Series',status:'Planned',episodeScheduleVerified:true,releasedEpisodes:{1:released,2:[1,2,3]},episodeCounts:{1:500,2:3},verifiedCompletedSeasons:2,watchedEpisodes:{2:[1,2,3]},curSeason:2,curEp:3,episodeHistory:[{id:'older'}]};
 const before=JSON.stringify(item);let calls=0;const original=c.releasedEpisodeMap;
 c.releasedEpisodeMap=(...args)=>{calls++;return original(...args);};
 const marked=c.applySeasonToggle(item,1,true,events);
 assert.ok(calls<=4,'episode normalization must not grow with the number of toggled episodes');
 assert.equal(marked.watchedEpisodes[1].length,500);assert.equal(marked.watchedEpisodes[2].length,3);
 assert.equal(marked.watchedSeasons,2);assert.equal(marked.curSeason,2);assert.equal(marked.curEp,3);
 assert.equal(marked.status,'Watching');assert.equal(marked.episodeHistory.length,500);
 assert.equal(marked.episodeHistory[0].id,'mark-1');assert.equal(marked.episodeHistory.at(-1).id,'mark-500');
 assert.equal(JSON.stringify(item),before,'batching cannot mutate the original record needed for rollback');
 const unmarked=c.applySeasonToggle({...marked,curSeason:1,curEp:500},1,false,events.map(event=>({...event,kind:'unmark'})));
 assert.equal(unmarked.watchedEpisodes[1],undefined);assert.equal(unmarked.watchedEpisodes[2].length,3);
 assert.equal(unmarked.watchedSeasons,1);assert.equal(unmarked.curSeason,2);assert.equal(unmarked.curEp,3);
});

test('Recent additions sort by original creation time across statuses, without using edit timestamps',()=>{
 const c=functions(['sortMediaRows','recentAdditionTime','itemMatchesCurrentView'],{activeSort:'title',activeFilter:'Recent',currentTab:'library',categoryControlsVisible:()=>true,librarySearchScore:()=>1,titleCollator:new Intl.Collator('en')});
 const items=[{id:'older',title:'A',status:'Watched',createdAt:'2020-01-01',updatedAt:'2099-01-01'},
  {id:'new',title:'Z',status:'Watching',createdAt:'2026-11-01'},
  {id:'unknown',title:'B',status:'Planned',updatedAt:'2099-01-02'}];
 assert.deepEqual(Array.from(c.sortMediaRows(items).rows,item=>item.id),['new','older','unknown']);
 for(const item of items)assert.equal(c.itemMatchesCurrentView(item,'',[],Date.now()),true);
 assert.equal(items[0].id,'older','sorting does not mutate saved records');
});
