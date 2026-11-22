import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/catalogue.js',import.meta.url),'utf8');
function tracker(failed=''){
 const context={cachedMetadataRequest:(_cache,_key,task)=>task(),normalizeTitle:value=>String(value).toLowerCase(),fetchJSONWithTimeout:async url=>{
  if(failed&&url.endsWith('/'+failed))throw Error('offline');
  if(url.endsWith('/episodes'))return [{season:8,number:2,name:'Crossing Lines',airstamp:'2026-11-06T01:00:00Z',image:null},{season:0,number:1,name:'Special'},{season:8,number:null,name:'Unnumbered'}];
  if(url.endsWith('/seasons'))return [{number:7,image:{original:'https://static.tvmaze.com/season7.jpg'}},{number:8,image:null}];
  return {id:12,name:'Example',image:{original:'https://static.tvmaze.com/show.jpg'},externals:{imdb:'tt1234567'}};
 }};
 vm.runInNewContext(source.slice(source.indexOf('  function officialEpisodeImageMap('),source.indexOf('  function completeTitleSynopsis(')),context);
 return context.fetchOfficialTrackerArtwork({tvmazeShowId:'12',imdbId:'tt1234567',title:'Example'});
}
test('Verified tracker metadata keeps episode names, season covers and the show cover separate',async()=>{
 const art=await tracker();
 assert.equal(art.posterUrl,'https://static.tvmaze.com/show.jpg');
 assert.deepEqual(JSON.parse(JSON.stringify(art.episodeTitles)),{8:{2:'Crossing Lines'}});
 assert.equal(art.episodeReleaseDates[8][2],'2026-11-06T01:00:00Z');
 assert.equal(art.seasonImages[7],'https://static.tvmaze.com/season7.jpg');assert.equal(art.seasonImages[8],undefined);
});
test('A failed season lookup still returns episode titles and the verified show cover',async()=>{
 const art=await tracker('seasons');assert.equal(art.episodeTitles[8][2],'Crossing Lines');assert.equal(art.posterUrl,'https://static.tvmaze.com/show.jpg');
});
test('A failed episode lookup keeps both the season and show cover',async()=>{
 const art=await tracker('episodes');assert.equal(art.episodeTitles,undefined);assert.equal(art.seasonImages[7],'https://static.tvmaze.com/season7.jpg');assert.equal(art.posterUrl,'https://static.tvmaze.com/show.jpg');
});

test('Episode dates use the selected streaming platform before and after artwork metadata loads',()=>{
 const gallery=fs.readFileSync(new URL('../library-gallery.js',import.meta.url),'utf8');
 const date={dateTime:'2026-11-13T20:00:00Z'},title={textContent:''};
 const row={dataset:{galleryEpisode:'2:3'},querySelector:selector=>selector==='.gallery-episode-date'?date:selector==='.gallery-episode-title'?title:{}};
 const context={Date,Intl,paintTrackerImage(){},esc:String};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(new URL('../assets/js/regional-releases.js',import.meta.url),'utf8'),context);
 context.regionalScheduleEvent=(item,event)=>context.WatchLogRegionalReleases.resolveEvent(item,event,{country:'GB'});
 vm.runInContext(gallery.slice(gallery.indexOf('  function episodeTitle('),gallery.indexOf('  async function loadTrackerArtwork(')),context);
 vm.runInContext(gallery.slice(gallery.indexOf('  function episodeRow('),gallery.indexOf('  function seasonRow(')),context);
 const item={title:'Sheriff Country',type:'Series',platform:'Paramount+',tvmazeShowId:'76568',episodeTitles:{2:{3:'The Crossing'}},episodeReleaseDates:{2:{3:date.dateTime}}};
 assert.match(context.episodeRow(item,2,3,new Set()),/14\/11/);
 context.paintTrackerArtwork({querySelectorAll:selector=>selector==='[data-gallery-episode]'?[row]:[]},{releaseItem:item,episodeReleaseDates:item.episodeReleaseDates,episodeTitles:item.episodeTitles});
 assert.equal(date.textContent,' · 14/11');assert.equal(date.dateTime,'2026-11-14T08:00:00.000Z');
 const changed={...item,platform:'Prime Video',broadcastPlatform:'CBS'};
 assert.match(context.episodeRow(changed,2,3,new Set()),/datetime="" hidden/);
 context.paintTrackerArtwork({querySelectorAll:selector=>selector==='[data-gallery-episode]'?[row]:[]},{releaseItem:changed,episodeReleaseDates:changed.episodeReleaseDates,episodeTitles:changed.episodeTitles});
 assert.equal(date.hidden,true);assert.equal(date.textContent,'','late artwork metadata cannot restore a broadcast date as a streaming date');
});
