import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const version=source.match(/const SHELL_BUILD="([^"]+)"/)[1],scope='https://app.test/Watched-Tracker/';
function worker({fail=false,offline=false,navigationFailure=false,stalled=false}={}){
 const listeners={},stores=new Map(),requests=[];let skipped=0;
 const key=request=>new URL(request.url||String(request),scope).href;
 const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);
  return {keys:async()=>[...map.keys()].map(url=>new Request(url)),delete:async request=>map.delete(key(request)),match:async request=>map.get(key(request))?.clone(),put:async(request,response)=>map.set(key(request),response.clone()),addAll:async assets=>{
   const staged=await Promise.all(assets.map(async request=>{const response=await fetcher(request);if(!response.ok)throw Error('Missing asset');return [key(request),response];}));
   for(const [url,response] of staged)map.set(url,response.clone());
  }};
 }};
 const fetcher=async request=>{
  const url=key(request);requests.push(url);if(offline)throw Error('Offline');
  if(url.endsWith('asset-manifest.json'))return Response.json({version,assets:['index.html','assets/js/app-core.js?v='+version,'assets/css/app.css?v='+version]});
  if(fail&&url.includes('app.css'))return new Response('Missing',{status:404});
  if(stalled&&url===scope)return new Promise(()=>{});
  if(navigationFailure&&url===scope)return new Response('Unavailable',{status:503});
  return new Response('asset '+url);
 };
 const self={registration:{scope},addEventListener:(type,fn)=>listeners[type]=fn,skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{}}};
 vm.runInNewContext(source,{self,URL,Request,Response,caches,fetch:fetcher,AbortController,setTimeout,clearTimeout});
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


test('A temporary server failure opens the complete installed shell',async()=>{
 const app=worker({navigationFailure:true}),shell=await app.caches.open('watchlog-shell-'+version);
 await shell.put(scope+'index.html',new Response('installed shell'));
 let work;app.listeners.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:promise=>work=promise});
 assert.equal(await (await work).text(),'installed shell');assert.equal(app.requests.length,1);
});

test('Viewed public artwork remains available offline and its cache is bounded',async()=>{
 const app=worker();
 const imageRequest=i=>({url:'https://static.tvmaze.com/uploads/images/'+i+'.jpg',method:'GET',destination:'image'});
 const request=async i=>{let work;app.listeners.fetch({request:imageRequest(i),respondWith:promise=>work=promise});return work;};
 for(let i=0;i<152;i++)await request(i);
 const cache=await app.caches.open('watchlog-artwork-v1');
 assert.equal((await cache.keys()).length,150);assert.equal(await cache.match(imageRequest(0)),undefined);
 const count=app.requests.length;await request(151);assert.equal(app.requests.length,count);
 for(const request of [{url:'https://backend.test/private.jpg',method:'GET',destination:'image'}, {...imageRequest(999),destination:''}]){
  let claimed=false;app.listeners.fetch({request,respondWith(){claimed=true;}});assert.equal(claimed,false);
 }
});


test('A stalled navigation falls back within the offline startup deadline',async()=>{
 const app=worker({stalled:true}),cache=await app.caches.open('watchlog-shell-'+version);
 await cache.put(scope+'index.html',new Response('saved shell'));
 let work;app.listeners.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:promise=>work=promise});
 assert.equal(await (await work).text(),'saved shell');
});
