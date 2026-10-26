import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/regional-releases.js',import.meta.url),'utf8');
function engine(){const c=vm.createContext({Intl,Date,URL,AbortSignal});vm.runInContext(source,c);return c.WatchLogRegionalReleases;}
const show={id:'marshals',title:'Marshals',type:'Series',imdbId:'tt36849871',tvmazeShowId:'84526',releaseYear:'2026',platform:'CBS',airingSeason:2,nextEpisodeNum:4,nextEpisodeDate:'2026-10-26T00:00:00Z',scheduledEpisodeReleases:[{season:2,number:4,raw:'2026-10-26T00:00:00Z'}],recurringWeeklySchedule:{days:[0],episodes:[{season:2,number:4,raw:'2026-10-26T00:00:00Z'}]}};
test('UK Marshals uses Monday 08:00 Paramount+ without changing saved broadcast metadata',()=>{
 const api=engine(),before=JSON.stringify(show),result=api.resolve(show,{country:'GB'});
 assert.equal(result.nextEpisodeDate,'2026-10-26T08:00:00.000Z');assert.equal(result.platform,'Paramount+');
 assert.equal(result.scheduledEpisodeReleases[0].raw,result.nextEpisodeDate);assert.equal(result.recurringWeeklySchedule.days[0],1);
 assert.equal(result.releaseSchedule.timeSource,'User-confirmed');assert.equal(result.releaseSchedule.sources.length,2);
 assert.equal(JSON.stringify(show),before);assert.equal(api.resolve(result,{country:'GB'}),result);
 assert.equal(api.resolve(show,{country:'US'}),show);assert.equal(api.resolve(show,{country:'CA'}),show);
 assert.equal(api.resolve({...show,imdbId:'tt000001'},{country:'GB'}).platform,'CBS','conflicting identity must not match');
});
test('Regional streaming clock stays 08:00 London through UK and US daylight-saving differences',()=>{
 const api=engine();
 for(const [broadcast,expected] of [['2026-03-23T00:00:00Z','2026-03-23T08:00:00.000Z'],['2026-03-30T00:00:00Z','2026-03-30T07:00:00.000Z'],['2026-10-19T00:00:00Z','2026-10-19T07:00:00.000Z'],['2026-10-26T00:00:00Z','2026-10-26T08:00:00.000Z'],['2026-11-02T01:00:00Z','2026-11-02T08:00:00.000Z']])assert.equal(api.resolve({...show,nextEpisodeDate:broadcast},{country:'GB'}).nextEpisodeDate,expected);
});
test('Device language does not turn France or Ireland into the UK and an explicit viewing region wins',()=>{
 const api=engine();assert.equal(api.country({timeZone:'Europe/Paris',locale:'en-GB'}),'FR');assert.equal(api.country({timeZone:'Europe/Dublin',locale:'en-GB'}),'IE');assert.equal(api.country({timeZone:'Europe/London',locale:'en-US'}),'GB');assert.equal(api.country({country:'US',timeZone:'Europe/London'}),'US');
});
test('Regional web listings cross-check provider country, show identity and episode; unknown times stay date-only',async()=>{
 const api=engine(),item={type:'Series',tvmazeShowId:'12',imdbId:'tt1234568',nextEpisodeDate:'2026-10-26T00:00:00Z'},now=Date.parse('2026-10-26T01:00:00Z');
 const make=(number,options={})=>({season:2,number,airdate:'2026-10-26',airtime:'08:00',airstamp:'2026-10-26T08:00:00Z',_embedded:{show:{id:12,externals:{imdb:'tt1234568'},webChannel:{name:'Example stream',country:{code:'GB'}}}},...options});
 const fetcher=async()=>({ok:true,json:async()=>[make(1),make(9,{_embedded:{show:{id:12,externals:{imdb:'tt1234568'},webChannel:{name:'Global stream',country:null}}}}),make(4),make(5,{airtime:''}),make(6,{_embedded:{show:{id:12,externals:{imdb:'tt1234568'},webChannel:{name:'Wrong region',country:{code:'US'}}}}}),make(7,{_embedded:{show:{id:12,externals:{imdb:'tt9999999'},webChannel:{name:'Wrong title',country:{code:'GB'}}}}})]});
 await api.refresh([item],{country:'GB'},fetcher,now);
 const event={season:2,number:4,raw:'2026-10-26T00:00:00Z'};
 assert.equal(api.resolveEvent(item,event,{country:'GB'},now).raw,'2026-10-26T08:00:00Z');
 assert.equal(api.resolveEvent(item,{...event,number:5},{country:'GB'},now).raw,'2026-10-26');
 for(const number of [6,7,8])assert.equal(api.resolveEvent(item,{...event,number},{country:'GB'},now).releaseSchedule,undefined);
 assert.equal(api.resolveEvent(item,{kind:'season',season:2,number:2,raw:event.raw},{country:'GB'},now).raw,'2026-10-26T08:00:00Z','season premiere uses episode one rather than episode two');
 assert.equal(api.resolveEvent(item,event,{country:'US'},now).releaseSchedule,undefined);
 await api.refresh([item],{country:'US'},fetcher,now);
 assert.equal(api.resolveEvent(item,{...event,number:9},{country:'US'},now).platform,'Global stream','cached global feeds remain available after switching regions');
 assert.equal(api.resolveEvent(item,event,{country:'GB'},now+6*3600000).releaseSchedule,undefined);
});
test('A special broadcast outside the checked weekday does not invent a streaming release',()=>{
 const api=engine(),item=api.resolve({...show,nextEpisodeDate:'2026-10-27T00:00:00Z'},{country:'GB'});
 assert.equal(api.resolveEvent(item,{season:2,number:4,raw:item.nextEpisodeDate},{country:'GB'}).streamingUnconfirmed,true);
});
test('Regional refresh covers every date in the two-week window with bounded concurrency',async()=>{
 const api=engine(),now=Date.parse('2026-10-26T01:00:00Z'),dates=new Set();let active=0,peak=0;
 const item={type:'Series',tvmazeShowId:'59',imdbId:'tt2261391'};
 await api.refresh([item],{country:'GB'},async url=>{
  active++;peak=Math.max(peak,active);await Promise.resolve();active--;
  const date=new URL(url).searchParams.get('date');dates.add(date);
  return {ok:true,json:async()=>date==='2026-11-05'?[{season:15,number:7,airdate:date,airtime:'09:00',airstamp:date+'T09:00:00Z',_embedded:{show:{id:59,externals:{imdb:item.imdbId},webChannel:{name:'Example stream',country:{code:'GB'}}}}}]:[]};
 },now);
 assert.equal(dates.size,15);assert.ok(dates.has('2026-11-08'));assert.ok(peak<=3);
 const event=api.resolveEvent(item,{season:15,number:7,raw:'2026-11-04T22:00:00Z'},{country:'GB'},now);
 assert.equal(event.raw,'2026-11-05T09:00:00Z');assert.equal(event.platform,'Example stream');
});
test('Browser and deployed reminder worker share identical regional schedule rules',()=>assert.equal(source,fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/regional-releases.js',import.meta.url),'utf8')));
