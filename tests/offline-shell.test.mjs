import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const version=source.match(/const SHELL_BUILD="([^"]+)"/)[1],scope='https://app.test/Watched-Tracker/';
function worker({fail=false,offline=false,cacheFailure=''}={}){
 const listeners={},stores=new Map(),requests=[];let skipped=0;
 const key=request=>new URL(request.url||String(request),scope).href;
 const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
  if(cacheFailure==='open')throw Error('Cache unavailable');
  if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);
  return {match:async request=>{if(cacheFailure==='read')throw Error('Cache unavailable');return map.get(key(request))?.clone();},put:async(request,response)=>{if(cacheFailure==='write')throw Object.assign(Error('Storage full'),{name:'QuotaExceededError'});map.set(key(request),response.clone());},addAll:async assets=>{
   const staged=await Promise.all(assets.map(async request=>{const response=await fetcher(request);if(!response.ok)throw Error('Missing asset');return [key(request),response];}));
   for(const [url,response] of staged)map.set(url,response.clone());
  }};
 }};
 const fetcher=async request=>{
  const url=key(request);requests.push(url);if(offline)throw Error('Offline');
  if(url.endsWith('asset-manifest.json'))return Response.json({version,assets:['index.html','assets/js/app-core.js?v='+version,'assets/css/app.css?v='+version]});
  if(fail&&url.includes('app.css'))return new Response('Missing',{status:404});
  return new Response('asset '+url);
 };
 const self={registration:{scope},addEventListener:(type,fn)=>listeners[type]=fn,skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{}}};
 vm.runInNewContext(source,{self,URL,Request,Response,caches,fetch:fetcher});
 return {listeners,caches,stores,requests,skipped:()=>skipped};
}
test('Offline install stages every versioned asset before activating',async()=>{
 const app=worker();let work;app.listeners.install({waitUntil:promise=>work=promise});await work;
 assert.equal(app.skipped(),1);const cache=await app.caches.open('watchlog-shell-'+version);
 assert.ok(await cache.match(scope+'index.html'));assert.ok(await cache.match(scope+'assets/js/app-core.js?v='+version));
});
test('An incomplete offline update never activates or deletes the old complete shell',async()=>{
 const app=worker({fail:true}),old=await app.caches.open('watchlog-shell-previous');await old.put(scope+'index.html',new Response('previous'));
 let work;app.listeners.install({waitUntil:promise=>work=promise});await assert.rejects(work,/Missing asset/);
 assert.equal(app.skipped(),0);assert.equal(await (await old.match(scope+'index.html')).text(),'previous');
});
test('Static assets use the installed cache and account/API/update requests are not intercepted',async()=>{
 const app=worker(),cache=await app.caches.open('watchlog-shell-'+version),url=scope+'assets/js/app-core.js?v='+version;
 await cache.put(url,new Response('cached'));let work;
 app.listeners.fetch({request:new Request(url),respondWith:promise=>work=promise});assert.equal(await (await work).text(),'cached');assert.equal(app.requests.length,0);
 for(const request of [new Request('https://backend.test/functions/v1/watchlog-pin',{method:'POST'}),new Request(scope+'build-info.js?update=123'),new Request('https://backend.test/private.js')]){
  let claimed=false;app.listeners.fetch({request,respondWith(){claimed=true;}});assert.equal(claimed,false);
 }
});
test('Offline navigation uses HTML from the complete matching shell',async()=>{
 const app=worker({offline:true}),shell=await app.caches.open('watchlog-shell-'+version),navigation=await app.caches.open('watchlog-navigation-v4');
 await shell.put(scope+'index.html',new Response('matching shell'));await navigation.put(scope+'index.html',new Response('other build'));
 let work;app.listeners.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:promise=>work=promise});assert.equal(await (await work).text(),'matching shell');
});
test('Online scripts, styles and navigation survive runtime cache failures',async()=>{
 for(const cacheFailure of ['open','read','write']){
  const app=worker({cacheFailure});
  for(const request of [new Request(scope+'assets/js/new.js?v=next'),new Request(scope+'assets/css/new.css?v=next'),{url:scope,method:'GET',mode:'navigate'}]){
   let work;app.listeners.fetch({request,respondWith:promise=>work=promise});
   const response=await work;assert.equal(response.status,200);assert.match(await response.text(),/^asset /);
  }
  assert.equal(app.requests.length,3,'a broken runtime cache still uses the available network');
 }
});
