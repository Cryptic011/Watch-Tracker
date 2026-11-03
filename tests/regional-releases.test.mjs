import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/regional-releases.js',import.meta.url),'utf8');
function engine(){const c=vm.createContext({Intl,Date,URL,AbortSignal});vm.runInContext(source,c);return c.WatchLogRegionalReleases;}
test('Airtimes stay unchanged across titles, countries and daylight-saving dates',()=>{
 const api=engine();
 for(const title of ['FBI','CIA','Marshals'])for(const region of ['GB','US','CA'])for(const raw of ['2026-11-03T01:00:00Z','2026-11-03T02:01:00Z','2026-03-30T00:30:00+01:00']){
  const item={title,type:'Series',platform:'CBS',nextEpisodeDate:raw},event={season:2,number:5,raw};
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
 assert.equal(result.nextEpisodeDate,'2026-11-02T01:00:00Z');assert.equal(result.platform,'CBS');assert.equal(result.releaseSchedule,null);assert.equal(JSON.stringify(item),before);
 assert.equal(api.resolveEvent(item,item.scheduledEpisodeReleases[0]).raw,'2026-11-02T01:00:00Z');
});
test('A date without an airtime never gains an invented clock',()=>{
 const event=engine().resolveEvent({type:'Series'},{raw:'2026-11-03',season:1,number:2});assert.equal(event.raw,'2026-11-03');assert.equal(event.streamingUnconfirmed,true);
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
