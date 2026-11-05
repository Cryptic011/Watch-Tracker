import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readAppSource} from './app-source.mjs';
const html=readAppSource();
const suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(html,assert,vm);
function app(){
 const c=vm.createContext({Date,Intl,URL,AbortSignal});
 vm.runInContext(fs.readFileSync(new URL('../assets/js/regional-releases.js',import.meta.url),'utf8'),c);
 vm.runInContext('const releaseClockItems=new WeakSet();\n'+['releaseViewingCountry','regionalScheduleItem','regionalScheduleEvent','releaseTimelineItem','releaseAvailableEpisodeMap','releaseSortInfo','currentSortInfo','upcomingSortInfo','isEpisodeTrackable','toLocalInput','storedDateFromInput','setReleaseInput','storedReleaseInput','episodeReleaseTimestamp','analyzeTVSchedule'].map(n=>extractFunction(html,n)).join('\n'),c);
 return c;
}
const broadcast='2026-10-30T01:00:00Z',release=broadcast;
const item={type:'Series',title:'9-1-1: Nashville',airingSeason:2,nextEpisodeNum:3,nextEpisodeDate:broadcast,scheduledEpisodeReleases:[{season:2,number:3,raw:broadcast}]};
test('Title reminder, Upcoming, release sorting and current status share the notification release clock',()=>{
 const c=app(),before=JSON.stringify(item),now=Date.parse('2026-10-29T23:01:00Z');
 const resolved=c.regionalScheduleEvent(item,{kind:'episode',raw:broadcast,season:2,number:3});
 assert.equal(resolved.raw,release);
 assert.equal(c.upcomingSortInfo(item,now).time,Date.parse(resolved.raw));
 assert.equal(c.upcomingSortInfo(item,now).season,2);
 assert.equal(c.releaseSortInfo(item,now).time,Date.parse(release));
 const between=Date.parse('2026-10-30T03:00:00Z');
 assert.equal(c.currentSortInfo(item,between).kind,'aired');
 assert.equal(c.currentSortInfo(item,Date.parse(release)+1).kind,'aired');
 assert.equal(JSON.stringify(item),before);
 const projected=c.releaseTimelineItem(item);
 assert.equal(c.releaseTimelineItem(projected),projected);
 assert.equal(c.upcomingSortInfo(projected,now).time,Date.parse(release));
});
test('Release editor saves the entered airtime without applying a hidden delay',()=>{
 const c=app(),input={value:'',dataset:{}};
 c.setReleaseInput(input,item,broadcast,{kind:'episode',season:2,number:3});
 assert.equal(input.value,'2026-10-30T01:00');
 assert.equal(c.storedReleaseInput(input),broadcast);
 input.value='2026-10-30T06:00';
 const stored=c.storedReleaseInput(input);
 assert.equal(c.regionalScheduleEvent(item,{raw:stored,kind:'episode',season:2,number:3}).raw,'2026-10-30T06:00:00.000Z');
 c.setReleaseInput(input,item,'2026-10-31',{kind:'episode',season:2,number:3});
 assert.equal(c.storedReleaseInput(input),'2026-10-31');
 c.setReleaseInput(input,{type:'Series',title:'Marshals',tvmazeShowId:'84526'},'2026-11-02T01:00:00Z',{kind:'episode',season:2,number:3});
 assert.equal(input.value,'2026-11-02T01:00');
 assert.equal(c.storedReleaseInput(input),'2026-11-02T01:00:00Z');
});
test('Season premieres, date-only events and Marshals source airtimes retain their meaning',()=>{
 const c=app(),now=Date.parse('2026-10-29T23:01:00Z');
 assert.equal(c.upcomingSortInfo({...item,nextEpisodeDate:'',nextSeasonNum:3,nextSeasonDate:broadcast,scheduledEpisodeReleases:[]},now).time,Date.parse(release));
 assert.equal(c.upcomingSortInfo({...item,nextEpisodeDate:'2026-10-30',scheduledEpisodeReleases:[]},now).dateOnly,true);
 const marshals={...item,title:'Marshals',tvmazeShowId:'84526',nextEpisodeDate:'2026-11-02T01:00:00Z',scheduledEpisodeReleases:[]};
 assert.equal(new Date(c.upcomingSortInfo(marshals,now).time).toISOString(),'2026-11-02T01:00:00.000Z');
});
test('A saved broadcaster-released episode stays unavailable until release without deleting watched history',()=>{
 const c=app(),now=Date.parse('2026-10-30T00:30:00Z');
 const map={2:[1,2,3]};
 assert.deepEqual(Array.from(c.releaseAvailableEpisodeMap(item,map,now)[2]),[1,2]);
 assert.deepEqual(Array.from(c.releaseAvailableEpisodeMap({...item,watchedEpisodes:{2:[3]}},map,now)[2]),[1,2,3]);
 assert.deepEqual(Array.from(c.releaseAvailableEpisodeMap({...item,watchedEpisodes:{2:{3:true}}},map,now)[2]),[1,2,3]);
 assert.deepEqual(Array.from(c.releaseAvailableEpisodeMap(item,map,Date.parse(release))[2]),[1,2,3]);
});

test('Regional streaming listings cannot override source airtimes anywhere in the timeline',async()=>{
 const c=app(),now=Date.now(),verified='2026-10-30T08:00:00Z',tracked={...item,tvmazeShowId:'123'};
 await c.WatchLogRegionalReleases.refresh([tracked],{country:'GB'},async()=>({ok:true,json:async()=>[{season:2,number:3,airdate:'2026-10-30',airtime:'08:00',airstamp:verified,_embedded:{show:{id:123,webChannel:{name:'Verified stream',country:{code:'GB'}}}}}]}),now);
 const timeline=c.releaseTimelineItem(tracked);
 assert.equal(timeline.nextEpisodeDate,broadcast);
 assert.equal(c.upcomingSortInfo(tracked,Date.parse('2026-10-29T23:01:00Z')).time,Date.parse(broadcast));
 const input={value:'',dataset:{}};
 c.setReleaseInput(input,tracked,broadcast,{kind:'episode',season:2,number:3});
 assert.equal(input.value,'2026-10-30T01:00');
 assert.equal(c.storedReleaseInput(input),broadcast);
});

test('The episode bar turns green at the confirmed release instant and labels Chicago Fire as released',()=>{
 const c=app();c.esc=String;c.formatLocalDateTime=date=>date.toISOString();c.formatLocalWeekdayDate=date=>date.toISOString().slice(0,10);
 vm.runInContext(extractFunction(html,'reminderMarkup'),c);
 const raw='2026-11-05T02:00:00Z',show={type:'Series',title:'Chicago Fire',airingSeason:15,nextEpisodeNum:5,nextEpisodeDate:raw,scheduledEpisodeReleases:[{season:15,number:5,raw}]};
 const before=c.reminderMarkup(show,false,Date.parse(raw)-1);
 assert.match(before,/S15 E5 Next Episode/);assert.doesNotMatch(before,/class="reminder released"/);
 for(const now of [Date.parse(raw),Date.parse('2026-11-05T17:26:00Z')]){
  const released=c.reminderMarkup(show,false,now);
  assert.match(released,/class="reminder released"/);assert.match(released,/S15 E5 Released/);assert.match(released,/2026-11-05T02:00:00\.000Z/);assert.doesNotMatch(released,/Next Episode/);
 }
 const uncertain=c.reminderMarkup({...show,nextEpisodeDate:'2026-11-05',scheduledEpisodeReleases:[]},false,Date.parse('2026-11-05T17:26:00Z'));
 assert.doesNotMatch(uncertain,/class="reminder released"|data-reminder-release-at/);
 const offset={...show,nextEpisodeDate:'2026-11-05T03:00:00+01:00',scheduledEpisodeReleases:[]};
 assert.match(c.reminderMarkup(offset,false,Date.parse(raw)),/S15 E5 Released/,'offset airtimes use the same UTC instant');
});
