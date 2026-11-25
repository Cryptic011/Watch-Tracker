import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/regional-releases.js',import.meta.url),'utf8');
function engine(){const c=vm.createContext({Intl,Date,URL,AbortSignal});vm.runInContext(source,c);return c.WatchLogRegionalReleases;}
test('Catalogue defaults match verified UK streaming identities and preserve explicit choices and other regions',()=>{
 const api=engine(),item={title:'Marshals',format:'Series',tvmazeId:'84526',platform:'CBS'};
 assert.equal(api.catalogueItem(item,{country:'GB'}).platform,'Paramount+');
 assert.equal(item.platform,'CBS');
 for(const row of [{...item,tvmazeId:'1'},{...item,imdbId:'tt0000000'},{...item,format:'Film'},{...item,platform:'Prime Video'}])assert.equal(api.catalogueItem(row,{country:'GB'}),row);
 assert.equal(api.catalogueItem(item,{country:'US'}),item);
 assert.equal(api.resolve(item,{country:'GB'}).platform,'CBS','saved broadcast entries are never silently reassigned');
});
// Regression: stale provider rows must not override the official Paramount Press Express episode record.
test('Official Sheriff Country episode release overrides conflicting broadcast/provider dates everywhere',()=>{
 const api=engine(),item={type:'Series',title:'Sheriff Country',tvmazeShowId:'76568',imdbId:'tt32268630',platform:'Paramount+',broadcastPlatform:'CBS',
  airingSeason:2,nextEpisodeNum:7,nextEpisodeDate:'2026-12-05T08:00:00Z',
  scheduledEpisodeReleases:[{season:2,number:7,title:'Stand Your Ground',raw:'2026-12-05T01:00:00Z'}],
  recurringWeeklySchedule:{episodes:[{season:2,number:7,title:'Stand Your Ground',raw:'2026-12-05T01:00:00Z'}]}};
 const result=api.resolve(item,{country:'GB'});
 assert.equal(result.nextEpisodeDate,'2026-12-12T08:00:00Z');
 assert.equal(result.scheduledEpisodeReleases[0].raw,'2026-12-12T08:00:00Z');
 assert.equal(result.scheduledEpisodeReleases[0].broadcastRaw,'2026-12-12T01:00:00Z');
 assert.equal(result.recurringWeeklySchedule.episodes[0].raw,'2026-12-12T08:00:00Z');
 assert.equal(result.scheduledEpisodeReleases[0].officialRelease,true);
 assert.equal(result.scheduledEpisodeReleases[0].releaseDateConfirmed,true);
 assert.equal(result.scheduledEpisodeReleases[0].releaseTimeConfirmed,false,'the official source confirms next-day availability, not the exact UK hour');
 assert.match(result.scheduledEpisodeReleases[0].releaseSource,/paramountpressexpress\\.com/);
 const page=api.resolveEvent(result,{season:2,number:7,raw:'2026-12-05T01:00:00Z'},{country:'GB'});
 assert.equal(page.raw,result.nextEpisodeDate);
 assert.equal(page.streamingUnconfirmed,false);
 const nextWeek=api.resolveEvent(result,{season:2,number:8,raw:'2026-12-12T01:00:00Z'},{country:'GB'});
 assert.equal(nextWeek.raw,'2026-12-19T08:00:00Z');
});
test('Airtimes stay unchanged across titles, countries and daylight-saving dates',()=>{
 const api=engine();
 for(const title of ['FBI','CIA','Marshals'])for(const region of ['GB','US','CA'])for(const raw of ['2026-11-03T01:00:00Z','2026-11-03T02:01:00Z','2026-03-30T00:30:00+01:00']){
  const item={title,type:'Series',platform:'CBS',broadcastPlatform:'CBS',nextEpisodeDate:raw},event={season:2,number:5,raw};
  assert.equal(api.resolve(item,{country:region}).nextEpisodeDate,raw);
  const result=api.resolveEvent(item,event,{country:region});
  assert.equal(result.raw,raw);assert.equal(result.streamingUnconfirmed,false);assert.equal(result.releaseSchedule.key,'provider-airtime');
  assert.equal(event.raw,raw);assert.equal(api.resolveEvent(item,result).raw,raw,'resolving twice never adds a delay');
 }
});
test('A regional refresh never requests or substitutes a different streaming time',async()=>{
 let calls=0;await engine().refresh([{type:'Series',tvmazeShowId:'59'}],{country:'GB'},()=>{calls++;});assert.equal(calls,0);
});
test('Previously adjusted events recover their original source time without modifying saved history',()=>{
 const api=engine(),item={type:'Series',platform:'Paramount+',broadcastPlatform:'CBS',releaseSchedule:{key:'marshals-gb-paramount-8'},nextEpisodeDate:'2026-11-02T08:00:00Z',scheduledEpisodeReleases:[{season:2,number:4,raw:'2026-11-02T08:00:00Z',broadcastRaw:'2026-11-02T01:00:00Z'}]};
 const before=JSON.stringify(item),result=api.resolve(item);
 assert.equal(result.nextEpisodeDate,'2026-11-02T01:00:00Z');assert.equal(result.platform,'Paramount+');assert.equal(result.releaseSchedule,null);assert.equal(JSON.stringify(item),before);
 assert.equal(api.resolveEvent(result,result.scheduledEpisodeReleases[0]).streamingUnconfirmed,true);
 assert.equal(api.resolveEvent(item,item.scheduledEpisodeReleases[0]).raw,'2026-11-02T01:00:00Z');
});
test('A date without an airtime never gains an invented clock',()=>{
 const event=engine().resolveEvent({type:'Series'},{raw:'2026-11-03',season:1,number:2});assert.equal(event.raw,'2026-11-03');assert.equal(event.streamingUnconfirmed,true);
});
test('Changing a streaming platform never silently selects the old broadcaster or confirms its clock',()=>{
 const api=engine(),raw='2026-11-16T01:00:00Z';
 const item={type:'Series',title:'Marshals',tvmazeShowId:'84526',platform:'Prime Video',broadcastPlatform:'CBS',nextEpisodeDate:raw};
 const result=api.resolve(item,{country:'GB'}),event=api.resolveEvent(result,{raw},{country:'GB'});
 assert.equal(result.platform,'Prime Video');assert.equal(event.platform,'Prime Video');
 assert.equal(event.streamingUnconfirmed,true);assert.equal(event.releaseSchedule,null);
 const broadcast=api.resolveEvent({...item,platform:'CBS'},{raw},{country:'GB'});
 assert.equal(broadcast.raw,raw);assert.equal(broadcast.streamingUnconfirmed,false);
 const streaming=api.resolveEvent({...item,platform:'Paramount+'},event,{country:'GB'});
 assert.equal(streaming.raw,'2026-11-16T08:00:00.000Z');assert.equal(streaming.releaseSourceMismatch,false);
});
test('Device language does not turn France or Ireland into the UK and an explicit viewing region wins',()=>{
 const api=engine();assert.equal(api.country({timeZone:'Europe/Paris',locale:'en-GB'}),'FR');assert.equal(api.country({timeZone:'Europe/Dublin',locale:'en-GB'}),'IE');assert.equal(api.country({timeZone:'Europe/London',locale:'en-US'}),'GB');assert.equal(api.country({country:'US',timeZone:'Europe/London'}),'US');
});
test('Browser and deployed reminder worker share identical airtime rules',()=>assert.equal(source,fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/regional-releases.js',import.meta.url),'utf8')));

test('Film alerts still require a verified release source as well as a clock time',()=>{
 const event={raw:'2026-11-03T01:00:00Z'},api=engine();
 assert.equal(api.resolveEvent({type:'Film'},event).streamingUnconfirmed,true);
 assert.equal(api.resolveEvent({type:'Film',filmReleaseSource:'Manual'},event).streamingUnconfirmed,false);
});

test('Selected Paramount+ UK shows use their streaming day at 08:00 without altering source records',()=>{
 const api=engine();
 for(const [title,showId,imdbId,raw,expected] of [
  ['Marshals','84526','tt36849871','2026-11-16T01:00:00Z','2026-11-16T08:00:00.000Z'],
  ['Marshals','84526','tt36849871','2026-03-29T20:00:00-04:00','2026-03-30T08:00:00.000Z'],
  ['Sheriff Country','76568','tt32268630','2026-11-13T20:00:00Z','2026-11-14T08:00:00.000Z'],
 ]){
  const item={title,type:'Series',tvmazeShowId:showId,imdbId,platform:'Paramount+',broadcastPlatform:'CBS',nextEpisodeDate:raw,latestEpisodeDate:raw,nextSeasonDate:raw,scheduledEpisodeReleases:[{season:2,number:3,raw}],recurringWeeklySchedule:{episodes:[{season:2,number:3,raw}]},watchedEpisodes:{1:[1]}};
  const before=JSON.stringify(item),projected=api.resolve(item,{country:'GB'});
  assert.equal(projected.platform,'Paramount+');assert.equal(projected.nextEpisodeDate,expected);assert.equal(projected.latestEpisodeDate,expected);assert.equal(projected.nextSeasonDate,expected);
  assert.equal(projected.scheduledEpisodeReleases[0].raw,expected);assert.equal(projected.recurringWeeklySchedule.episodes[0].raw,expected);
  assert.equal(projected.scheduledEpisodeReleases[0].broadcastRaw,raw);
  assert.equal(api.resolve(projected,{country:'GB'}).nextEpisodeDate,expected);
  assert.equal(api.resolveEvent(projected,projected.scheduledEpisodeReleases[0],{country:'GB'}).raw,expected);
  assert.equal(JSON.stringify(item),before);
  assert.equal(api.resolveEvent({...item,platform:'CBS'},{raw},{country:'GB'}).raw,raw);
  assert.equal(api.resolveEvent(item,{raw},{country:'US'}).raw,raw);
  assert.equal(api.resolveEvent({...item,imdbId:'tt99999999'},{raw},{country:'GB'}).raw,raw);
 }
});
