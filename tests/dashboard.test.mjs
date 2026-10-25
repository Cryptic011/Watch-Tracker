import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readAppSource} from './app-source.mjs';
const html=readAppSource();
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(html,assert,vm);
function app(){
 const c=vm.createContext({Date,console});
 vm.runInContext(['toMillis','isEpisodeTrackable','normalizeReleasedEpisodeMap','positiveEpisodeMap','releasedEpisodeMap','normalizeWatchedEpisodeMap','legacyWatchedEpisodeMap','watchedEpisodeMap','nextWatchEpisode','calendarRange','calendarEvents','localISODate','weeklyReleasePattern','recurringWeeklyShows','scheduleEpisodeAirTimes','recurringScheduleDelay','scheduleBehindLevel','scheduleProgressMarker'].map(n=>extractFunction(html,n)).join('\n'),c);return c;
}
test('Schedule dots use amber for one or two released episodes behind and red for more than two',()=>{
 const c=app(),released={1:[1,2,3],2:[1,3]},all=Object.entries(released).flatMap(([season,episodes])=>episodes.map(episode=>[season,episode]));
 for(let behind=0;behind<=all.length;behind++){
  const watched={};
  for(const [season,episode] of all.slice(0,all.length-behind))(watched[season]||=[]).push(episode);
  const item={id:'show',type:'Series',status:'Watched',episodeScheduleVerified:true,releasedEpisodes:released,watchedEpisodes:watched};
  const before=JSON.stringify(item);
  assert.equal(c.scheduleBehindLevel(item),behind>2?'red':behind?'amber':'green');
  assert.equal(JSON.stringify(item),before,'calculating the marker never changes saved progress');
 }
});

test('Schedule dots ignore films, unknown schedules and unreleased episode totals',()=>{
 const c=app(),item={id:'anime',type:'Anime',episodeScheduleVerified:true,releasedEpisodes:{1:[1,3]},episodeCounts:{1:20},watchedEpisodes:{1:[1,3]}};
 assert.equal(c.scheduleBehindLevel(item),'green');
 assert.equal(c.scheduleBehindLevel({...item,watchedEpisodes:{1:[1]}}),'amber');
 assert.equal(c.scheduleBehindLevel({...item,type:'Film',watchedEpisodes:{}}),'');
 assert.equal(c.scheduleBehindLevel({id:'unknown',type:'Series',episodeCounts:{1:20}}),'');
 assert.equal(c.scheduleBehindLevel({type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,3],2:[1,2]},watchedSeasons:1,curSeason:2,curEp:1}),'amber','legacy progress remains respected');
});

test('Schedule markers contain no visible count and reuse results for repeated show cards',()=>{
 const c=app(),cache=new Map();let calls=0;
 c.scheduleBehindLevel=()=>{calls++;return 'red';};
 const marker=c.scheduleProgressMarker({id:'show'},cache);
 assert.equal(c.scheduleProgressMarker({id:'show'},cache),marker);assert.equal(calls,1);
 assert.ok(marker.includes('data-behind-level="red"')&&marker.includes('role="img"')&&marker.includes('aria-label='));
 assert.ok(marker.endsWith('></span>'),'the dot has no visible text or number');
 c.scheduleBehindLevel=()=>'green';
 assert.ok(c.scheduleProgressMarker({id:'caught-up'}).includes('aria-label="Up to date"'));
});

test('New episodes remain green until exactly 24 elapsed hours after airing',()=>{
 const c=app(),air=new Date('2026-10-23T12:00:00Z').getTime();
 const episode={season:2,number:5,raw:new Date(air).toISOString()};
 for(const metadata of [
  {scheduledEpisodeReleases:[episode]},
  {recurringWeeklySchedule:{episodes:[episode]}},
  {airingSeason:2,latestEpisodeNum:5,latestEpisodeDate:episode.raw}
 ]){
  const item={type:'Series',episodeScheduleVerified:true,releasedEpisodes:{2:[5]},watchedEpisodes:{},...metadata};
  assert.equal(c.scheduleBehindLevel(item,new Date(air-1)),'green');
  assert.equal(c.scheduleBehindLevel(item,new Date(air+86400000-1)),'green');
  assert.equal(c.scheduleBehindLevel(item,new Date(air+86400000)),'amber');
  assert.equal(c.scheduleBehindLevel(item,new Date(air+86400000+1)),'amber');
 }
});

test('Grace never hides an older backlog and expires for all episodes in a batch',()=>{
 const c=app(),air=new Date('2026-10-23T12:00:00Z').getTime();
 const scheduled=[1,2,3].map(number=>({season:2,number,raw:new Date(air).toISOString()}));
 const item={type:'Anime',episodeScheduleVerified:true,releasedEpisodes:{1:[1],2:[1,2,3]},watchedEpisodes:{1:[1]},scheduledEpisodeReleases:scheduled};
 assert.equal(c.scheduleBehindLevel(item,new Date(air+3600000)),'green');
 assert.equal(c.scheduleBehindLevel(item,new Date(air+86400000)),'red');
 assert.equal(c.scheduleBehindLevel({...item,watchedEpisodes:{}},new Date(air+3600000)),'amber');
 assert.equal(c.scheduleBehindLevel({...item,releasedEpisodes:{1:[1,2,3],2:[1,2,3]},watchedEpisodes:{}},new Date(air+3600000)),'red');
});

test('Date-only releases use local noon and daylight-saving changes do not shorten the 24-hour grace',()=>{
 const c=app(),item={type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1]},watchedEpisodes:{},scheduledEpisodeReleases:[{season:1,number:1,raw:'2026-10-23'}]};
 const noon=new Date(2026,9,23,12).getTime();
 assert.equal(c.scheduleBehindLevel(item,new Date(noon+86400000-1)),'green');
 assert.equal(c.scheduleBehindLevel(item,new Date(noon+86400000)),'amber');
 item.scheduledEpisodeReleases[0].raw='2026-10-24T20:00:00+01:00';
 const air=Date.parse(item.scheduledEpisodeReleases[0].raw);
 assert.equal(c.scheduleBehindLevel(item,new Date(air+86400000-1)),'green');
 assert.equal(c.scheduleBehindLevel(item,new Date(air+86400000)),'amber');
 item.scheduledEpisodeReleases[0].raw='not a date';
 assert.equal(c.scheduleBehindLevel(item,new Date(air)),'amber','missing air times cannot invent a grace period');
});

test('Marker expiry wakes the schedule even when the show has no selected recurring release',()=>{
 const c=app(),now=new Date(2026,9,23,12);
 const item={type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1]},scheduledEpisodeReleases:[{season:1,number:1,raw:new Date(now.getTime()-23*3600000).toISOString()}]};
 assert.equal(c.recurringScheduleDelay([],now,[item]),3600000);
});

test('Recurring shows retain an aired episode for exactly 24 hours then advance to the next confirmed episode',()=>{
 const c=app(),episodes=[8,15,22,29].map((day,index)=>({season:2,number:index+1,raw:new Date(2026,9,day,20).toISOString()}));
 const item={id:'weekly',title:'Weekly show',type:'Series',status:'Watched',recurringWeeklySchedule:c.weeklyReleasePattern(episodes)};
 const before=JSON.stringify(item),air=new Date(2026,9,22,20).getTime();
 assert.equal(c.recurringWeeklyShows([item],new Date(air+86400000-1))[0].episodes[0].number,3);
 assert.equal(c.recurringWeeklyShows([item],new Date(air+86400000-1))[0].state,'released');
 const next=c.recurringWeeklyShows([item],new Date(air+86400000))[0];
 assert.equal(next.episodes[0].number,4);assert.equal(next.state,'upcoming');assert.equal(next.day,4);
 assert.equal(JSON.stringify(item),before,'display rollover never edits the saved library');
});

test('Unannounced returns never occupy recurring weekdays, even with historical patterns',()=>{
 const c=app(),episodes=[8,15,22].map((day,index)=>({season:1,number:index+1,raw:new Date(2026,9,day,20).toISOString()}));
 const item={id:'pause',title:'On a break',type:'Anime',recurringWeeklySchedule:c.weeklyReleasePattern(episodes),scheduledEpisodeReleases:[],nextEpisodeNum:4,nextEpisodeDate:""};
 const past=new Date(2027,0,1),original=JSON.stringify(item);
 assert.equal(c.recurringWeeklyShows([item],past).length,0,'no announced date means no weekday slot');
 assert.equal(c.recurringWeeklyShows([{...item,nextEpisodeDate:'invalid'}],past).length,0);
 assert.equal(c.recurringWeeklyShows([{...item,recurringWeeklySchedule:{days:[2],episodes}}],past).length,0,'a historical Tuesday cannot be treated as next Tuesday');
 assert.equal(JSON.stringify(item),original,'rendering never edits saved metadata');
});

test('Distant returning shows enter the weekly schedule only at the two-week boundary',()=>{
 const c=app(),air=new Date(2027,0,5,20).getTime(),entry=air-14*86400000;
 const episodes=[-91,-84,0,7].map((days,index)=>({season:9,number:index+1,raw:new Date(air+days*86400000).toISOString()}));
 // Historical patterns and either source of confirmed dates obey the same limit.
 const shows=[
  {id:'rookie',title:'The Rookie',type:'Series',status:'Watched',recurringWeeklySchedule:{days:[new Date(air).getDay()],episodes:episodes.slice(0,2)},scheduledEpisodeReleases:episodes.slice(2)},
  {id:'rookie-north',title:'The Rookie North',type:'Series',status:'Planned',airingSeason:9,nextEpisodeNum:3,nextEpisodeDate:episodes[2].raw,recurringWeeklySchedule:{days:[new Date(air).getDay()],episodes:episodes.slice(0,2)}}
 ];
 const original=JSON.stringify(shows);
 assert.equal(c.recurringWeeklyShows(shows,new Date(2026,9,25)).length,0,'a distant date cannot occupy a weekly slot');
 assert.equal(c.recurringWeeklyShows(shows,new Date(entry-1)).length,0,'just over two weeks away stays hidden');
 assert.equal(c.recurringWeeklyShows(shows,new Date(entry)).length,2,'exactly two weeks away becomes visible');
 assert.equal(c.recurringWeeklyShows(shows,new Date(entry+1)).length,2);
 assert.equal(JSON.stringify(shows),original,'date filtering never changes saved library or reminder metadata');
});

test('A show on a long break disappears after the 24-hour grace until its return is within two weeks',()=>{
 const c=app(),air=new Date(2026,9,22,20).getTime();
 const episodes=[-7,0,70,77].map((days,index)=>({season:1,number:index+1,raw:new Date(air+days*86400000).toISOString()}));
 const item={id:'break',title:'Returning show',type:'Anime',recurringWeeklySchedule:c.weeklyReleasePattern(episodes)};
 assert.equal(c.recurringWeeklyShows([item],new Date(air+86400000-1))[0].state,'released');
 assert.equal(c.recurringWeeklyShows([item],new Date(air+86400000)).length,0);
 const entry=Date.parse(episodes[2].raw)-14*86400000;
 assert.equal(c.recurringWeeklyShows([item],new Date(entry-1)).length,0);
 assert.equal(c.recurringWeeklyShows([item],new Date(entry))[0].episodes[0].number,3);
});

test('The schedule wakes when a hidden release enters the two-week window, including date-only next episodes',()=>{
 const c=app(),now=new Date(2026,11,22,11),entry=now.getTime()+3600000,air=entry+14*86400000;
 const episode={season:1,number:1,raw:new Date(air).toISOString()};
 for(const metadata of [
  {scheduledEpisodeReleases:[episode]},
  {recurringWeeklySchedule:{episodes:[episode]}},
  {nextEpisodeDate:episode.raw},
  {nextEpisodeDate:c.localISODate(new Date(air))}
 ])assert.equal(c.recurringScheduleDelay([],now,[{type:'Series',...metadata}]),3600000);
});

test('Recurring releases sort by displayed local clock time, even across different future weeks',()=>{
 const c=app(),make=(id,days,hour)=>({id,title:id,type:'Series',scheduledEpisodeReleases:days.map((day,index)=>({season:1,number:index+1,raw:new Date(2026,9,day,hour).toISOString()}))});
 const evening=make('17:00 show',[8,15,22],17);
 const overnight=make('01:00 show',[1,8,29],1);
 const dateOnly={id:'unknown-time',title:'Date-only show',type:'Series',
  scheduledEpisodeReleases:[8,15,22].map((day,index)=>({season:1,number:index+1,raw:'2026-10-'+String(day).padStart(2,'0')}))};
 const rows=c.recurringWeeklyShows([evening,dateOnly,overnight],new Date(2026,9,20,12));
 assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row=>row.item.id))),['01:00 show','17:00 show','unknown-time']);
 assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row=>row.day))),[4,4,4]);
 assert.equal(rows[0].date.getHours(),1);
 assert.equal(rows[1].date.getHours(),17);
 assert.equal(rows[0].date>rows[1].date,true,'broadcast times must outrank dates from different weeks');
});

test('A confirmed release is visible until exactly 24 hours after airing, then vanishes without another date',()=>{
 const c=app(),episodes=[8,15,22].map((day,index)=>({season:1,number:index+1,raw:new Date(2026,9,day,20).toISOString()}));
 const item={id:'finite',title:'Finite series',type:'Series',recurringWeeklySchedule:c.weeklyReleasePattern(episodes)};
 const air=new Date(2026,9,22,20).getTime();
 assert.equal(c.recurringWeeklyShows([item],new Date(air+86400000-1))[0].state,'released');
 assert.equal(c.recurringWeeklyShows([item],new Date(air+86400000)).length,0);
});

test('Recurring weekdays always sort Monday to Sunday and exclude films, one-off releases and explicitly hidden shows',()=>{
 const c=app(),make=(id,days)=>({id,title:id,type:'Series',status:'Planned',scheduledEpisodeReleases:days.map((day,index)=>({season:1,number:index+1,raw:new Date(2026,9,day,20).toISOString()}))});
 const monday=make('Monday',[12,19,26]),sunday=make('Sunday',[11,18,25]),thursday=make('Thursday',[8,15,22]);
 const rows=c.recurringWeeklyShows([sunday,{...monday,type:'Film'},{...thursday,hideFromWeeklyReleases:true},make('One-off',[20]),thursday,monday],new Date(2026,9,22,21));
 assert.equal(JSON.stringify(rows.map(row=>row.day)),JSON.stringify([1,4,0]));
 assert.equal(JSON.stringify(rows.map(row=>row.item.id)),JSON.stringify(['Monday','Thursday','Sunday']));
});

test('Recurring batch episodes deduplicate metadata and stay together before advancing',()=>{
 const c=app(),episodes=[{season:1,number:1,raw:'2026-10-15'},{season:1,number:2,raw:'2026-10-15'},{season:1,number:3,raw:'2026-10-22'},{season:1,number:4,raw:'2026-10-22'},{season:1,number:5,raw:'2026-10-29'}];
 const item={id:'batch',title:'Batch',type:'Series',airingSeason:1,nextEpisodeNum:3,nextEpisodeDate:'2026-10-22',recurringWeeklySchedule:c.weeklyReleasePattern(episodes),scheduledEpisodeReleases:episodes};
 const current=c.recurringWeeklyShows([item],new Date(2026,9,22,13))[0];
 assert.equal(current.date.getHours(),12);
 assert.equal(JSON.stringify(current.episodes.map(row=>row.number)),JSON.stringify([3,4]));
 assert.equal(c.recurringWeeklyShows([item],new Date(2026,9,23,12))[0].episodes[0].number,5);
});

test('Official weekly patterns and stored schedules persist through refreshes and edits',()=>{
 const c=app(),rows=[{season:4,number:1,raw:'2026-10-22T20:00:00Z'}];
 assert.equal(c.weeklyReleasePattern(rows),null);
 assert.equal(c.weeklyReleasePattern(rows,['Thursday']).days.length,1);
 assert.equal(c.weeklyReleasePattern([null,{season:1,number:0,raw:'bad'}]),null);
 const catalogue=fs.readFileSync(new URL('../assets/js/catalogue.js',import.meta.url),'utf8');
 assert.equal(catalogue.split('weeklyReleasePattern(schedule.episodes.map(').length-1,2);
 assert.ok(catalogue.includes('recurringWeeklySchedule:ended?null:')&&catalogue.includes('recurringWeeklySchedule:tvEnded?null:'));
 assert.match(fs.readFileSync(new URL('../assets/js/editor.js',import.meta.url),'utf8'),/recurringWeeklySchedule:type==="Film"\?null/);
 assert.match(fs.readFileSync(new URL('../assets/js/sync.js',import.meta.url),'utf8'),/recurringWeeklySchedule:scheduleVerified\?\(result.recurringWeeklySchedule\|\|null\)/);
});

test('Calendar shows the selected week remainder and Upcoming from today through the 29th',()=>{
 const c=app(),now=new Date(2026,9,22,18),week=c.calendarRange('week',now),upcoming=c.calendarRange('upcoming',now),today=c.calendarRange('today',now);
 assert.equal(c.localISODate(week.start),'2026-10-22');
 assert.equal(week.days,4);
 assert.equal(c.localISODate(week.priorStart),'2026-10-19');
 assert.equal(week.priorDays,3);
 assert.equal(c.localISODate(upcoming.start),'2026-10-22');
 assert.equal(upcoming.days,8);
 assert.equal(upcoming.label,'22–29 Oct');
 assert.equal(c.localISODate(today.start),'2026-10-22');
 assert.equal(today.days,1);
 const items=['2026-10-18','2026-10-19','2026-10-21','2026-10-22','2026-10-25','2026-10-26','2026-10-29','2026-10-30'].map((date,index)=>({id:String(index),title:date,type:'Film',filmReleaseDate:date}));
 assert.equal(JSON.stringify(c.calendarEvents(items,week.start,week.days).events.map(event=>event.item.title)),JSON.stringify(['2026-10-22','2026-10-25']));
 assert.equal(JSON.stringify(c.calendarEvents(items,week.priorStart,week.priorDays).events.map(event=>event.item.title)),JSON.stringify(['2026-10-19','2026-10-21']));
 assert.equal(JSON.stringify(c.calendarEvents(items,upcoming.start,upcoming.days).events.map(event=>event.item.title)),JSON.stringify(['2026-10-22','2026-10-25','2026-10-26','2026-10-29']));
});
test('Calendar shows only the selected window while retaining TBA and excluded sections',()=>{
 const dashboard=fs.readFileSync(new URL('../assets/js/dashboard.js',import.meta.url),'utf8');
 assert.doesNotMatch(dashboard,/upcomingBeyondWeek|upcomingMarkup|next 30 days/i);
 assert.match(dashboard,/data-dashboard-section="unknown"/);
 assert.match(dashboard,/data-dashboard-section="excluded"/);
 assert.match(dashboard,/data-dashboard-section="prior"/);
 assert.match(dashboard,/Prior Releases/);
});
test('Next to watch selects released gaps before later seasons and ignores announced totals',()=>{
 const c=app(),item={type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,4],2:[1]},watchedEpisodes:{1:[1,4]},episodeCounts:{1:20}};
 assert.equal(JSON.stringify(c.nextWatchEpisode(item)),JSON.stringify({season:1,episode:2}));
 item.watchedEpisodes={1:[1,2,4],2:[1]};assert.equal(c.nextWatchEpisode(item),null);
 assert.equal(c.nextWatchEpisode({type:'Film'}),null);
});
test('Calendar includes every batch episode, deduplicates next episode, preserves date-only and excludes eighth day',()=>{
 const c=app(),now=new Date(2026,8,20,18),items=[{id:'s',title:'Show',type:'Series',airingSeason:1,nextEpisodeNum:2,nextEpisodeDate:'2026-09-21T20:00:00',scheduledEpisodeReleases:[{season:1,number:2,raw:'2026-09-21T20:00:00'},{season:1,number:3,raw:'2026-09-21T20:00:00'}]},{id:'f',title:'Film',type:'Film',filmReleaseDate:'2026-09-20'},{id:'out',title:'Outside',type:'Film',filmReleaseDate:'2026-09-27'},{id:'tba',title:'Unknown',type:'Film',status:'Planned',releaseYear:'2027'}];
 const result=c.calendarEvents(items,now);assert.equal(result.events.length,3);assert.equal(result.events[0].dateOnly,true);assert.equal(result.unknown.length,1);
});
test('Sync feedback stays in the header without a duplicate Library banner',()=>{
 const label={textContent:''},quick={dataset:{},querySelector:()=>label};
 const c=vm.createContext({document:{getElementById:id=>{assert.equal(id,'quick-sync-status');return quick;}},syncStatus:{},syncDot:{}});
 vm.runInContext(extractFunction(html,'setSync'),c);
 c.setSync('Syncing your changes…','warn');assert.equal(label.textContent,'Syncing');assert.equal(quick.dataset.state,'syncing');
 c.setSync('Synced. This library is available on your other devices.','ok');assert.equal(label.textContent,'Synced');assert.equal(quick.dataset.state,'ok');
 c.setSync('Offline. Changes are saved on this device.','warn');assert.equal(label.textContent,'Needs attention');assert.equal(quick.dataset.state,'attention');assert.match(c.syncStatus.textContent,/Offline/);
 assert.doesNotMatch(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),/id="library-save-status"/);
});

const backend=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,''));
async function requestHistory({session=true,owner=false}={}){
 const reads=[],filters=[];let handler;
 const db={from(table){reads.push(table);const q={select(){return q},eq(k,v){filters.push([table,k,v]);return q},order(){return q},limit(){return q},single(){return Promise.resolve({data:{email:'owner@example.test'}})},maybeSingle(){return Promise.resolve({data:{items:[]}})},then(resolve){resolve({data:[]})}};return q},rpc(name,args){reads.push(name);filters.push([name,'p_accounts',args.p_accounts]);return Promise.resolve({data:[{items:[]}],error:null});}};
 const c=vm.createContext({TextEncoder,Response,Request,console,Date,createClient:()=>db,Deno:{env:{get:()=>''},serve:fn=>handler=fn}});vm.runInContext(backend,c);
 vm.runInContext(`getSession=async()=>${session?"({accountId:'session-owner'})":"null"};sha256=async()=>${owner?'PRIVATE_TEST_ACCOUNT_HASH':"'other-account'"};`,c);
 const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'private_history',accountId:'victim'})}));return {response,reads,filters};
}
test('Reminder history rejects signed-out sessions and permits any signed-in account',async()=>{
 const anon=await requestHistory({session:false});assert.equal(anon.response.status,401);assert.equal(anon.reads.length,0);
 const other=await requestHistory();assert.equal(other.response.status,200);assert.ok(other.reads.includes('watchlog_push_deliveries'));
});
test('Private reminder history scopes every data query to the verified session, ignoring supplied account ID',async()=>{
 const result=await requestHistory();assert.equal(result.response.status,200);
 for(const table of ['watchlog_push_deliveries','watchlog_push_subscriptions'])assert.ok(result.filters.some(([t,k,v])=>t===table&&k==='account_id'&&v==='session-owner'));
 assert.ok(result.filters.some(([t,k,v])=>t==='watchlog_read_libraries'&&k==='p_accounts'&&JSON.stringify(v)==='[\"session-owner\"]'));
 assert.equal((await result.response.json()).enabledDevices,0);
});

test('Dashboard keeps unchanged DOM and preserves expanded sections after changed content',()=>{
 const details=[{dataset:{dashboardSection:'next'},open:true},{dataset:{dashboardSection:'unknown'},open:false}];
 let writes=0;
 const root={querySelectorAll(selector){return selector.endsWith('[open]')?details.filter(node=>node.open):details;},set innerHTML(value){writes++;for(const node of details)node.open=false;}};
 const c=vm.createContext({});vm.runInContext(extractFunction(html,'updateDashboardMarkup'),c);
 c.updateDashboardMarkup(root,'first');assert.equal(writes,1);assert.equal(details[0].open,true);assert.equal(details[1].open,false);
 c.updateDashboardMarkup(root,'first');assert.equal(writes,1);
 c.updateDashboardMarkup(root,'changed');assert.equal(writes,2);assert.equal(details[0].open,true);
 details[0].open=false;details[1].open=true;
 c.updateDashboardMarkup(root,'changed again');assert.equal(details[0].open,false);assert.equal(details[1].open,true);
});
test('Watch statistics render in Account and Sync, not above the release calendar',()=>{
 const dashboard=fs.readFileSync(new URL('../assets/js/dashboard.js',import.meta.url),'utf8');
 assert.match(dashboard,/settings-watch-statistics/);
 assert.match(dashboard,/querySelector\('\.profile-card'\)/);
 assert.doesNotMatch(dashboard,/updateDashboardMarkup\(root,statsMarkup/);
});
test('Header provides a profile shortcut and compact sync/reminder status chips',()=>{
 const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(index,/id="user-pill" class="user-pill" type="button" aria-label="Open Account and Sync"/);
 assert.match(index,/id="quick-sync-status"/);assert.match(index,/id="quick-reminder-status"/);
 const sync=fs.readFileSync(new URL('../assets/js/sync.js',import.meta.url),'utf8');
 const reminders=fs.readFileSync(new URL('../assets/js/reminders.js',import.meta.url),'utf8');
 assert.match(sync,/quick-sync-status/);assert.match(reminders,/quick-reminder-status/);
});
test('Next to watch handles long histories and nonsequential input without changing release data',()=>{
 const c=app(),episodes=Array.from({length:2000},(_,i)=>i+1),item={type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[...episodes].reverse(),2:[1]},watchedEpisodes:{1:episodes.filter(n=>n!==1999)}};
 const before=JSON.stringify(item);
 assert.equal(JSON.stringify(c.nextWatchEpisode(item)),JSON.stringify({season:1,episode:1999}));
 assert.equal(JSON.stringify(item),before);
});


test('Calendar never treats planned or saved watch status as an unreleased title',()=>{
 const c=app(),now=new Date(2026,8,20),items=['Planned','Saved','Watching','Watched'].flatMap(status=>[
  {id:status+'film',title:'Old film',type:'Film',status,releaseYear:'2014'},
  {id:status+'show',title:'Released show',type:'Series',status,episodeScheduleVerified:true,releasedEpisodes:{1:[1,2]}},
  {id:status+'unknown',title:'Missing metadata',type:'Film',status}
 ]);
 assert.equal(c.calendarEvents(items,now).unknown.length,0);
});
test('Calendar names actual undated upcoming episodes and seasons regardless of watch status',()=>{
 const c=app(),now=new Date(2026,8,20),released={episodeScheduleVerified:true,releasedEpisodes:{1:[1,2]}};
 const items=[
  {id:'season',title:'Returning show',type:'Series',status:'Watched',...released,nextSeasonNum:2,scheduledEpisodeReleases:[{season:1,number:2,raw:'2025-01-01'}]},
  {id:'episode',title:'Airing show',type:'Series',status:'Watching',...released,airingSeason:1,nextEpisodeNum:3},
  {id:'stale',title:'Already released',type:'Series',status:'Planned',...released,airingSeason:1,nextEpisodeNum:2,nextSeasonNum:1},
  {id:'future',title:'Future film',type:'Film',status:'Watching',releaseYear:2027}
 ];
 const result=c.calendarEvents(items,now);
 assert.equal(JSON.stringify(result.unknown.map(item=>[item.id,item.announcement])),JSON.stringify([['season','Season 2'],['episode','S1 E3'],['future','Film release']]));
});

test('Chicago Fire stays in its airing season and is not falsely shown as season 16 TBA',()=>{
 const c=app(),now=new Date(2026,9,22),item={id:'chicago-fire',title:'Chicago Fire',type:'Series',airingSeason:15,curSeason:15,nextEpisodeNum:4,nextEpisodeDate:'2026-10-28T21:00:00',nextSeasonNum:16,episodeScheduleVerified:true,releasedEpisodes:{15:[1,2,3]},scheduledEpisodeReleases:[{season:15,number:4,raw:'2026-10-28T21:00:00'}]};
 const result=c.calendarEvents([item],now,30);
 assert.equal(result.events.find(event=>event.item.id==='chicago-fire')?.label,'S15 E4');
 assert.equal(result.unknown.some(row=>row.id==='chicago-fire'),false);
});



test('Weekly release opt-out is saved per show without removing library tracking', () => {
  const editor=fs.readFileSync(new URL('../assets/js/editor.js',import.meta.url),'utf8');
  const dashboard=fs.readFileSync(new URL('../assets/js/dashboard.js',import.meta.url),'utf8');
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/id="hide-from-weekly-releases" type="checkbox"/);
  assert.ok(editor.includes('hideFromWeeklyReleases:type==="Film"?false:$("hide-from-weekly-releases").checked'));
  assert.match(editor,/item\.hideFromWeeklyReleases===true/);
  assert.match(dashboard,/if\(item\.hideFromWeeklyReleases===true\)continue;/);
});


test('Changelog shows the actual workflow run number and explains the Weekly Releases fix', () => {
  const app=readAppSource()+fs.readFileSync(new URL('../assets/js/app-core.js',import.meta.url),'utf8');
  const notes=JSON.parse(fs.readFileSync(new URL('../release-notes.json',import.meta.url),'utf8'));
  assert.ok(app.includes('Number.isInteger(entry.workflowRunNumber)'));
  assert.ok(app.includes('workflowRunNumber:Number.isInteger(run.run_number)?run.run_number:null'));
  assert.ok(app.includes('workflowRunAttempt:Number.isInteger(run.run_attempt)?run.run_attempt:null'));
  assert.ok(app.includes('summary.textContent=(Number.isInteger(entry.workflowRunNumber)?"Run "+entry.workflowRunNumber+" ("+String(entry.commit||"").slice(0,7)+")":"Run unavailable ("+String(entry.commit||"").slice(0,7)+")")'));
  assert.ok(app.includes('actions/runs?per_page=100&page="+page'));
  
  const previousRelease=notes['5fea71a85451ab9d63f9411b55faf456333db173'];
  assert.ok(previousRelease.changes.some(change=>/actual run number and attempt/i.test(change)));
  assert.ok(previousRelease.changes.some(change=>/library export and merge-based restore/i.test(change)));
  assert.ok(notes['737498912c0ad423cc4de25468de8bc2a79b80a0'].changes.some(change=>/build failed/i.test(change)));
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../assets/css/app.css',import.meta.url),'utf8');
  const dashboard=fs.readFileSync(new URL('../assets/js/dashboard.js',import.meta.url),'utf8');
  assert.match(index,/Exclude this show from Weekly Releases/);
  assert.match(css,/\.weekly-release-preference-copy\{display:flex/);
  assert.match(dashboard,/data-calendar-range/);
  assert.match(dashboard,/data-calendar-include/);
});


test('Watch statistics count saved films and logged released episodes without mutating progress',()=>{
 const c=app();
 const items=[
  {id:'film-watched',type:'Film',status:'Watched'},
  {id:'film-planned',type:'Film',status:'Planned'},
  {id:'series',type:'Series',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,3],2:[1]},watchedEpisodes:{1:[1,2]},status:'Watching'},
  {id:'anime',type:'Anime',episodeScheduleVerified:true,releasedEpisodes:{1:[1]},watchedEpisodes:{1:[1]},status:'Watched'},
  {id:'excluded',type:'Series',hideFromWeeklyReleases:true,episodeScheduleVerified:true,releasedEpisodes:{1:[1]},watchedEpisodes:{1:[1]}}
 ];
 const fn=extractFunction(html,'watchStatistics');
 vm.runInContext(fn,c);
 const before=JSON.stringify(items);
 assert.deepEqual(JSON.parse(JSON.stringify(c.watchStatistics(items))),{libraryCount:5,filmsWatched:1,episodesWatched:4,showsInProgress:1,showsCompleted:2});
 assert.equal(JSON.stringify(items),before,'statistics do not mutate saved records');
});

test("Identical series episode entries render once across distinct sync record IDs",()=>{
  const c=app();
  const episodes=[
    {season:1,number:1,raw:"2026-10-15T20:00:00Z"},
    {season:1,number:2,raw:"2026-10-22T20:00:00Z"}
  ];
  const first={id:"duplicate-a",title:"Example: City",platform:"CBS",type:"Series",
    tvmazeShowId:"123",releasedEpisodes:{1:[1]},scheduledEpisodeReleases:episodes,
    recurringWeeklySchedule:c.weeklyReleasePattern(episodes)};
  const second={...first,id:"duplicate-b",imdbId:"tt0123456"};
  const now=new Date("2026-10-21T12:00:00Z");
  const recurring=c.recurringWeeklyShows([first,second],now);
  assert.equal(recurring.length,1);
  assert.equal(recurring[0].item.id,"duplicate-b");
  const calendar=c.calendarEvents([first,second],now,7);
  assert.equal(calendar.events.length,1);
});
