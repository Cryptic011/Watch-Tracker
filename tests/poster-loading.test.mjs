import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(process.env.GALLERY_SOURCE||new URL('../library-gallery.js',import.meta.url),'utf8');
function gallery({observer=true,results=[],item={id:'film',type:'Film',title:'The Batman',releaseYear:2022,imdbId:'tt1877830'},fetchImpl=()=>{throw Error('Unexpected direct lookup');}}={}){
  const observed=[],lookups=[];
  const img={hidden:true,dataset:{art:`${item.type}:${item.imdbId||item.tvmazeShowId||item.id}`} ,set src(url){this.url=url;this.onload?.();}};
  const box={querySelector:()=>img};img.parentElement=box;
  const host={classList:{add(){}},addEventListener(){},querySelectorAll:()=>[img]};
  let clock=Date.now();
  const context={window:{},URL,AbortSignal,Date:class extends Date{static now(){return clock;}},document:{querySelectorAll:()=>[img]},fetch:fetchImpl};
  if(observer)context.IntersectionObserver=class{constructor(callback){this.callback=callback;}disconnect(){}unobserve(){}observe(target){observed.push(target);if(target!==img)queueMicrotask(()=>this.callback([{isIntersecting:true,target}]));}};
  vm.runInNewContext(source,context);
  const mount=()=>context.window.WatchLogGallery.mount(host,[item],{items:()=>[item],last:()=>null,artwork:async item=>{lookups.push(item.imdbId);return typeof results==='function'?results(item):results;}});
  mount();
  return {img,box,observed,lookups,mount,advance:ms=>{clock+=ms;}};
}
const poster='https://m.media-amazon.com/images/M/batman.jpg';
test('Saved teaser artwork is replaced by the current poster for the exact IMDb identity',async()=>{
  const app=gallery({item:{id:'film',type:'Film',title:'The Batman',imdbId:'tt1877830',posterUrl:'https://m.media-amazon.com/teaser.jpg'},results:[{imdbId:'tt1877830',posterUrl:poster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,poster);assert.deepEqual(app.lookups,['tt1877830']);
});
test('A saved poster survives a provider failure or a mismatched search result',async()=>{
  const app=gallery({item:{id:'film',type:'Film',title:'The Batman',imdbId:'tt1877830',posterUrl:poster},results:[{imdbId:'tt0000000',posterUrl:'https://m.media-amazon.com/wrong.jpg'}]});
  await new Promise(setImmediate);assert.equal(app.img.url,poster);
});
test('Hidden images load when their visible poster cards enter the viewport',async()=>{
  const app=gallery({results:[{imdbId:'tt1877830',posterUrl:poster}]});
  await new Promise(setImmediate);
  assert.equal(app.observed[0],app.box);
  assert.deepEqual(app.lookups,['tt1877830']);
  assert.equal(app.img.url,poster);assert.equal(app.img.hidden,false);
  assert.equal(app.img.loading,'eager','visibility is managed on the parent, never by a hidden lazy image');
});
test('Both calendars keep watching offscreen covers through Home renders',async()=>{
  let intersect,disconnects=0;
  const watched=new Set(),requests=[],images=[12,13].map(id=>{
    const img={hidden:true,isConnected:true,dataset:{art:`Series:${id}`},set src(url){assert.equal(this.loading,'eager');this.url=url;this.onload();}};
    img.parentElement={getClientRects:()=>[{}],querySelector:()=>img};return img;
  });
  const items=[12,13].map(id=>({id:String(id),type:'Series',title:'Show '+id,tvmazeShowId:String(id)}));
  const app={window:{},URL,AbortSignal,document:{visibilityState:'visible'},
    IntersectionObserver:class{constructor(callback){intersect=callback;}observe(box){watched.add(box);}unobserve(box){watched.delete(box);}disconnect(){disconnects++;watched.clear();}},
    fetch:async url=>{requests.push(url);const id=Number(url.split('/').at(-1));return {ok:true,json:async()=>({id,image:{original:`https://static.tvmaze.com/${id}.jpg`}})};}};
  vm.runInNewContext(source,app);
  const gallery=app.window.WatchLogGallery;
  for(const img of images)gallery.observeScheduleArtwork({querySelectorAll:()=>[img]},items);
  gallery.mount({classList:{add(){}},childNodes:[]},[],{dashboardOnly:true});
  assert.equal(disconnects,0);assert.equal(watched.size,2);assert.equal(requests.length,0,'offscreen provider lookups wait until scrolling');
  intersect([{isIntersecting:true,target:images[0].parentElement}]);await new Promise(setImmediate);
  assert.equal(images[0].hidden,false);assert.equal(images[1].hidden,true);
  intersect([{isIntersecting:true,target:images[1].parentElement}]);await new Promise(setImmediate);
  assert.equal(images[1].hidden,false);assert.equal(images[1].url,'https://static.tvmaze.com/13.jpg');
  assert.equal(requests.length,2);
});
test('Posters also load when IntersectionObserver is unavailable',async()=>{
  const app=gallery({observer:false,results:[{imdbId:'tt1877830',posterUrl:poster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,poster);
});
test('A missing poster is retried after a short cooldown, rather than on every render',async()=>{
  const results=[],app=gallery({results});
  await new Promise(setImmediate);assert.equal(app.lookups.length,1);
  app.mount();await new Promise(setImmediate);assert.equal(app.lookups.length,1);
  results.push({imdbId:'tt1877830',posterUrl:poster});app.advance(5*60*1000+1);
  app.mount();await new Promise(setImmediate);assert.equal(app.lookups.length,2);assert.equal(app.img.url,poster);
});
test('Saved artwork appears while an official poster refresh is still pending',async()=>{
  let finish;
  const app=gallery({item:{id:'film',type:'Film',title:'The Batman',imdbId:'tt1877830',posterUrl:poster},results:()=>new Promise(resolve=>{finish=resolve;})});
  await new Promise(setImmediate);assert.equal(app.img.url,poster);
  const updated='https://m.media-amazon.com/updated.jpg';finish([{imdbId:'tt1877830',posterUrl:updated}]);
  await new Promise(setImmediate);assert.equal(app.img.url,updated);
});
const reboot={id:'reboot',type:'Series',title:'Prison Break',tvmazeShowId:'83211'};
const original={imdbId:'tt0455275',title:'Prison Break',format:'Series',year:'2005',posterUrl:'https://m.media-amazon.com/original.jpg'};
const response=show=>async()=>({ok:true,json:async()=>show});
test('A known TVMaze series without an IMDb identity cannot borrow same-name catalogue artwork',async()=>{
  const app=gallery({item:reboot,fetchImpl:response({id:83211,image:null,externals:{}}),results:[original]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);assert.deepEqual(app.lookups,[]);
});
test('The verified TVMaze IMDb ID selects only the reboot poster, even when the original ranks first',async()=>{
  const rebootPoster='https://m.media-amazon.com/reboot.jpg';
  const app=gallery({item:reboot,fetchImpl:response({id:83211,image:null,externals:{imdb:'tt29730749'}}),results:[original,{...original,imdbId:'tt29730749',posterUrl:rebootPoster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,rebootPoster);assert.deepEqual(app.lookups,['tt29730749']);assert.equal(reboot.imdbId,undefined);
});
test('An unavailable TVMaze lookup does not downgrade a known identity to a title search',async()=>{
  const app=gallery({item:reboot,fetchImpl:async()=>{throw Error('offline');},results:[original]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);assert.deepEqual(app.lookups,[]);
});
test('Title-only series lookup rejects ambiguous remakes from both providers',async()=>{
  const app=gallery({item:{id:'unknown',title:'Prison Break',type:'Series'},fetchImpl:response([{show:{id:541,name:'Prison Break'}},{show:{id:83211,name:'Prison Break'}}]),results:[original,{...original,imdbId:'tt29730749'}]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);
});
test('A different IMDb identity cannot supply a films poster',async()=>{
  const app=gallery({results:[{imdbId:'tt0000000',title:'The Batman',posterUrl:poster}]});
  await new Promise(setImmediate);assert.equal(app.img.url,undefined);
});
test('Server catalogue retains the official IMDb poster and rejects arbitrary hosts',()=>{
  const server=fs.readFileSync(new URL('../supabase/functions/watchlog-pin/index.ts',import.meta.url),'utf8');
  const fn=server.slice(server.indexOf('function imdbSuggestion('),server.indexOf('async function searchCatalog(')).replace('row: any','row');
  const ctx={catalogText:(v,n=200)=>String(v||'').slice(0,n)};vm.createContext(ctx);vm.runInContext(fn,ctx);
  assert.equal(ctx.imdbSuggestion({id:'tt1877830',l:'The Batman',i:{imageUrl:poster}}).posterUrl,poster);
  assert.equal(ctx.imdbSuggestion({id:'tt1877830',i:{imageUrl:'https://example.com/a.jpg'}}).posterUrl,'');
});
