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
const broadcast='2026-10-30T01:00:00Z',release='2026-10-30T05:00:00.000Z';
const item={type:'Series',title:'9-1-1: Nashville',airingSeason:2,nextEpisodeNum:3,nextEpisodeDate:broadcast,scheduledEpisodeReleases:[{season:2,number:3,raw:broadcast}]};
test('Title reminder, Upcoming, release sorting and current status share the notification release clock',()=>{
 const c=app(),before=JSON.stringify(item),now=Date.parse('2026-10-29T23:01:00Z');
 const resolved=c.regionalScheduleEvent(item,{kind:'episode',raw:broadcast,season:2,number:3});
 assert.equal(resolved.raw,release);
 assert.equal(c.upcomingSortInfo(item,now).time,Date.parse(resolved.raw));
 assert.equal(c.upcomingSortInfo(item,now).season,2);
 assert.equal(c.releaseSortInfo(item,now).time,Date.parse(release));
 const between=Date.parse('2026-10-30T03:00:00Z');
 assert.equal(c.currentSortInfo(item,between).kind,'upcoming');
 assert.equal(c.currentSortInfo(item,Date.parse(release)+1).kind,'aired');
 assert.equal(JSON.stringify(item),before);
 const projected=c.releaseTimelineItem(item);
 assert.equal(c.releaseTimelineItem(projected),projected);
 assert.equal(c.upcomingSortInfo(projected,now).time,Date.parse(release));
});
test('Release editor preserves raw metadata and applies a changed release clock once',()=>{
 const c=app(),input={value:'',dataset:{}};
 c.setReleaseInput(input,item,broadcast,{kind:'episode',season:2,number:3});
 assert.equal(input.value,'2026-10-30T05:00');
 assert.equal(c.storedReleaseInput(input),broadcast);
 input.value='2026-10-30T06:00';
 const stored=c.storedReleaseInput(input);
 assert.equal(c.regionalScheduleEvent(item,{raw:stored,kind:'episode',season:2,number:3}).raw,'2026-10-30T06:00:00.000Z');
 c.setReleaseInput(input,item,'2026-10-31',{kind:'episode',season:2,number:3});
 assert.equal(c.storedReleaseInput(input),'2026-10-31');
 c.setReleaseInput(input,{type:'Series',title:'Marshals',tvmazeShowId:'84526'},'2026-11-02T01:00:00Z',{kind:'episode',season:2,number:3});
 assert.equal(input.value,'2026-11-02T08:00');
 assert.equal(c.storedReleaseInput(input),'2026-11-02T01:00:00Z');
});
test('Season premieres, date-only events and confirmed Marshals releases retain their meaning',()=>{
 const c=app(),now=Date.parse('2026-10-29T23:01:00Z');
 assert.equal(c.upcomingSortInfo({...item,nextEpisodeDate:'',nextSeasonNum:3,nextSeasonDate:broadcast,scheduledEpisodeReleases:[]},now).time,Date.parse(release));
 assert.equal(c.upcomingSortInfo({...item,nextEpisodeDate:'2026-10-30',scheduledEpisodeReleases:[]},now).dateOnly,true);
 const marshals={...item,title:'Marshals',tvmazeShowId:'84526',nextEpisodeDate:'2026-11-02T01:00:00Z',scheduledEpisodeReleases:[]};
 assert.equal(new Date(c.upcomingSortInfo(marshals,now).time).toISOString(),'2026-11-02T08:00:00.000Z');
});
test('A saved broadcaster-released episode stays unavailable until release without deleting watched history',()=>{
 const c=app(),now=Date.parse('2026-10-30T03:00:00Z');
 const map={2:[1,2,3]};
 assert.deepEqual(Array.from(c.releaseAvailableEpisodeMap(item,map,now)[2]),[1,2]);
 assert.deepEqual(Array.from(c.releaseAvailableEpisodeMap({...item,watchedEpisodes:{2:[3]}},map,now)[2]),[1,2,3]);
 assert.deepEqual(Array.from(c.releaseAvailableEpisodeMap(item,map,Date.parse(release))[2]),[1,2,3]);
});
