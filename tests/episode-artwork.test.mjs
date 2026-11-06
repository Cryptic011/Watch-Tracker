import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {getEpisodeArtwork,parsePublisherEpisodeArtwork,publisherImageURL} from '../supabase/functions/watchlog-pin/episode-artwork.mjs';

const poster='https://wwwimage-us.pplusstatic.com/episode-poster.jpg';
const still='https://static.tvmaze.com/episode-still.jpg';
const show={id:12,name:'Example',premiered:'2020-01-01',externals:{imdb:'tt1234567'},officialSite:'https://www.cbs.com/shows/example/'};
const episodes=[{season:1,number:1,name:'Pilot',image:{original:still}},{season:1,number:2,name:'Next',image:null}];
const selected={tvmazeShowId:'12',imdbId:'tt1234567',title:'Example'};
const policy='publisher-labelled-posters-v2';
const verified=episodeImages=>({state:'ready',artworkPolicy:policy,episodeImages});
const posterImage=url=>({'@type':'ImageObject',contentUrl:url,caption:'Official episode poster'});
const episode={'@type':'TVEpisode',name:'Pilot',episodeNumber:1,partOfSeason:{seasonNumber:1},partOfSeries:{name:'Example',datePublished:'2020-01-01'},image:posterImage(poster)};
const markup=nodes=>'<script type="application/ld+json">'+JSON.stringify(nodes)+'</script>';
const parse=nodes=>parsePublisherEpisodeArtwork(markup(nodes),show,episodes);
const json=value=>new Response(JSON.stringify(value));

test('Publisher artwork is tied to the exact series, season, episode and episode title',()=>{
  assert.deepEqual(parse(episode),{1:{1:poster}});
  for(const wrong of [{name:'Wrong'},{episodeNumber:3},{partOfSeason:{seasonNumber:2}},{partOfSeries:{name:'Another show'}},{partOfSeries:{name:'Example',datePublished:'1990'}}]){
    assert.deepEqual(parse({...episode,...wrong}),{});
  }
});
test('JSON-LD graph references work and conflicting episode images are rejected',()=>{
  assert.deepEqual(parse({'@graph':[
    {'@id':'series','@type':'TVSeries',name:'Example'},
    {'@id':'season','@type':'TVSeason',seasonNumber:1,partOfSeries:{'@id':'series'}},
    {...episode,partOfSeries:undefined,partOfSeason:{'@id':'season'},image:posterImage(poster)}
  ]}),{1:{1:poster}});
  assert.deepEqual(parse([episode,{...episode,image:posterImage(poster+'?alternative')}]),{});
});
test('Page covers, season covers, video thumbnails and unsafe image URLs cannot become episode artwork',()=>{
  for(const node of [{...episode,'@type':'TVSeries'},{...episode,image:undefined,thumbnailUrl:poster},{...episode,partOfSeries:{name:'Example',image:poster}},{...episode,partOfSeason:{seasonNumber:1,image:poster}}])assert.deepEqual(parse(node),{});
  for(const url of ['http://www.nbc.com/image.jpg','https://www.nbc.com.evil.test/image.jpg','https://user@www.nbc.com/image.jpg','https://www.nbc.com:444/image.jpg','https://127.0.0.1/image.jpg','javascript:evil()','https://static.tvmaze.com/still.jpg']){
    assert.equal(publisherImageURL(url),'');assert.deepEqual(parse({...episode,image:posterImage(url)}),{});
  }
});
test('Malformed and oversized structured metadata leave artwork empty',()=>{
  assert.deepEqual(parsePublisherEpisodeArtwork('<script type="application/ld+json">broken</script>',show,episodes),{});
  assert.deepEqual(parsePublisherEpisodeArtwork(' '.repeat(2000001),show,episodes),{});
});
test('Only the verified show official site is fetched, with redirects disabled',async()=>{
  const calls=[];
  const result=await getEpisodeArtwork({...selected,officialUrl:'https://evil.test'},async(url,init)=>{
    calls.push(url);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    return url.endsWith('/episodes')?json(episodes):url===show.officialSite?new Response(markup(episode)):json(show);
  },{useCache:false});
  assert.equal(result.state,'ready');assert.deepEqual(result.episodeImages,{1:{1:poster}});
  assert.equal(result.source,'CBS');assert.equal(result.sourceUrl,show.officialSite);
  assert.equal(calls.length,3);assert.ok(!calls.some(url=>url.includes('evil.test')));
});
test('Wrong show IDs or IMDb IDs stop before loading any publisher page',async()=>{
  for(const wrong of [{...show,id:99},{...show,externals:{imdb:'tt9999999'}},{...show,name:'Other'}]){
    let calls=0;const result=await getEpisodeArtwork(selected,async()=>{calls++;return json(wrong);},{useCache:false});
    assert.equal(result.state,'unmatched');assert.equal(calls,1);
  }
});
test('Unofficial sites and episode URLs are not fetched as show pages',async()=>{
  for(const site of ['https://evil.test/show','https://www.cbs.com.evil.test/show','https://www.cbs.com/shows/example/episodes/1']){
    let calls=0;const result=await getEpisodeArtwork(selected,async()=>{calls++;return json({...show,officialSite:site});},{useCache:false});
    assert.deepEqual(result.episodeImages,{});assert.equal(calls,1);
  }
});
test('Outages and stalled requests are bounded, aborted and remain retryable',async()=>{
  let signal;
  const stalled=await getEpisodeArtwork(selected,async(_url,init)=>{signal=init.signal;return new Promise(()=>{});},{useCache:false,timeoutMs:10});
  assert.equal(stalled.state,'unavailable');assert.equal(signal.aborted,true);
  const failed=await getEpisodeArtwork(selected,async()=>new Response('',{status:503}));
  assert.equal(failed.state,'unavailable');
  const recovered=await getEpisodeArtwork(selected,async url=>url.endsWith('/episodes')?json(episodes):url===show.officialSite?new Response(markup(episode)):json(show));
  assert.equal(recovered.episodeImages[1][1],poster);
});

const catalogue=fs.readFileSync(new URL('../assets/js/catalogue.js',import.meta.url),'utf8');
function tracker(publisher,storage=new Map(),offline=false,onPartial){
  const context={AbortSignal,navigator:{onLine:!offline},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},cachedMetadataRequest:(_cache,_key,task)=>task(),
    pinApi:async(action,payload)=>{assert.equal(action,'episode_artwork');assert.equal(payload.tvmazeShowId,'12');return publisher;},
    fetchJSONWithTimeout:async url=>{assert.equal(offline,false,'offline must not request metadata');return url.endsWith('/episodes')?episodes:url.endsWith('/seasons')?[]:show;}};
  vm.runInNewContext(catalogue.slice(catalogue.indexOf('  function officialEpisodeImageMap('),catalogue.indexOf('  function completeTitleSynopsis(')),context);
  return context.fetchOfficialTrackerArtwork(selected,onPartial);
}
test('Only classified episode posters are cached for offline use',async()=>{
  const storage=new Map(),publisher=verified({1:{1:poster,2:poster+'?next',99:poster}});
  const art=await tracker(publisher,storage);
  assert.equal(art.episodeImages[1][1],poster);assert.equal(art.episodeImageFallbacks,undefined);
  assert.equal(art.episodeImages[1][2],poster+'?next');assert.equal(art.episodeImages[1][99],undefined);
  const offline=await tracker(null,storage,true);
  assert.equal(offline.episodeImages[1][1],poster);assert.deepEqual(JSON.parse(JSON.stringify(offline.episodeImageFallbacks)),{});
});
test('Missing, failed, unclassified and unsafe artwork never falls back to a TVMaze still',async()=>{
  for(const publisher of [null,{state:'unavailable'},{state:'ready',episodeImages:{}},verified({1:{1:'https://www.nbc.com.evil.test/wrong.jpg'}}),{state:'ready',episodeImages:{1:{1:poster}}}]){
    const art=await tracker(publisher);assert.deepEqual(JSON.parse(JSON.stringify(art.episodeImages)),{});
  }
});
test('A publisher outage preserves classified posters and saves metadata without introducing stills',async()=>{
  const storage=new Map();
  await tracker(verified({1:{1:poster}}),storage);
  const refreshed=await tracker(null,storage);
  assert.equal(refreshed.episodeImages[1][1],poster);
  assert.equal(refreshed.episodeImageFallbacks,undefined);
  const emptyStorage=new Map();await tracker(null,emptyStorage);
  const offline=await tracker(null,emptyStorage,true);
  assert.deepEqual(JSON.parse(JSON.stringify(offline.episodeImages)),{});
});

test('A broken episode poster uses a placeholder without loading a still',()=>{
  const gallery=fs.readFileSync(new URL('../library-gallery.js',import.meta.url),'utf8');
  const context={esc:value=>String(value)};
  vm.runInNewContext(gallery.slice(gallery.indexOf('  function paintTrackerImage('),gallery.indexOf('  function episodeTitle(')),context);
  let image;
  const container={set innerHTML(value){this.html=value;image=value.startsWith('<img')?{}:null;},querySelector:()=>image};
  context.paintTrackerImage(container,poster,'E1');
  assert.ok(container.html.includes(poster));image.onerror();
  assert.match(container.html,/No artwork available/);assert.match(container.html,/>E1</);
  assert.doesNotMatch(container.html,/<img/);
});


test('Slow poster lookup shows metadata immediately without displaying a still',async()=>{
  let finishPublisher,metadata;
  const publisher=new Promise(resolve=>{finishPublisher=resolve;});
  let received;
  const early=new Promise(resolve=>{received=resolve;});
  const complete=tracker(publisher,new Map(),false,artwork=>{metadata=artwork;received();});
  try{
    await early;
    assert.deepEqual(JSON.parse(JSON.stringify(metadata.episodeImages)),{});
    assert.equal(metadata.details.source,'TVMaze');
    assert.ok(metadata.episodeTitles[1]);
  }finally{finishPublisher(verified({1:{1:poster}}));}
  const result=await complete;
  assert.equal(result.episodeImages[1][1],poster);
  assert.equal(result.episodeImageFallbacks,undefined);
});

test('A late image error cannot replace the current image',()=>{
  const gallery=fs.readFileSync(new URL('../library-gallery.js',import.meta.url),'utf8');
  const context={esc:value=>String(value)};
  vm.runInNewContext(gallery.slice(gallery.indexOf('  function paintTrackerImage('),gallery.indexOf('  function episodeTitle(')),context);
  let image;
  const container={set innerHTML(value){this.html=value;image=value.startsWith('<img')?{}:null;},querySelector:()=>image};
  context.paintTrackerImage(container,still,'E1');
  const oldImage=image;
  context.paintTrackerImage(container,poster,'E1',still);
  oldImage.onerror();
  assert.ok(container.html.includes(poster));
  image.onerror();
  assert.ok(container.html.includes(still));
});


test('Official-host stills and generic episode images are not classified as posters',()=>{
  for(const image of [poster,{contentUrl:poster},posterImage(poster),{contentUrl:poster,caption:'Screenshot'},{contentUrl:poster,caption:'Official episode poster',description:'Still frame from the episode'}]){
    const result=parse({...episode,image});
    if(image?.caption==='Official episode poster'&&!image.description)assert.deepEqual(result,{1:{1:poster}});
    else assert.deepEqual(result,{});
  }
});

test('The same poster cannot be reused for multiple episodes',()=>{
  const rows=[...episodes,{season:1,number:3,name:'Third'}];
  const other={...episode,name:'Third',episodeNumber:3};
  assert.deepEqual(parsePublisherEpisodeArtwork(markup([episode,other]),show,rows),{});
});

test('Old cached stills and unclassified publisher images are discarded, including offline',async()=>{
  const key=JSON.stringify(['12','tt1234567','Example','']);
  for(const image of [still,poster]){
    const storage=new Map([
      ['watchlog_tracker_details_v1',JSON.stringify([{key,artwork:{episodeImages:{1:{1:image}},episodeImageFallbacks:{1:{1:still}}}}])],
      ['watchlog_tracker_posters_v2',JSON.stringify([{key,artwork:{episodeImages:{1:{1:image}},episodeImageFallbacks:{1:{1:still}}}}])]
    ]);
    const result=await tracker(null,storage,true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.episodeImages)),{});
    assert.deepEqual(JSON.parse(JSON.stringify(result.episodeImageFallbacks)),{});
  }
});


test('Concurrent poster lookups retain the same classification policy',async()=>{
  const unique={...selected,tvmazeShowId:'13'},uniqueShow={...show,id:13};
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const request=async url=>{await gate;return url.endsWith('/episodes')?json(episodes):url===show.officialSite?new Response(markup(episode)):json(uniqueShow);};
  const first=getEpisodeArtwork(unique,request),second=getEpisodeArtwork(unique,request);
  release();
  for(const result of await Promise.all([first,second])){
    assert.equal(result.artworkPolicy,policy);
    assert.equal(result.episodeImages[1][1],poster);
  }
});
