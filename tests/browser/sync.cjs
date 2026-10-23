const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),account={id:'two-device-account',email:'devices@example.test',displayName:'Two devices'};
let revision=0,serial=0,conflicts=0,barrierRemaining=0,barrier=[],dropToken='',failures=new Map(),offlineA=false;
const tokens=new Set(),errors=[],calls=new Map(),receipts=new Map();
let items=[{id:'show',title:'Two Device Show',type:'Series',status:'Watching',platform:'Original service',episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,3,4,5,6,7,8,9,10]},watchedEpisodes:{1:[1]},episodeCounts:{1:10},verifiedCompletedSeasons:1,totalSeasons:1,curSeason:1,curEp:1,watchedSeasons:0,seriesReleaseDate:'2020-01-01'}, {id:'film',title:'Deletion test',type:'Film',status:'Planned',filmReleaseDate:'2020-01-01',filmReleaseSource:'Manual'}];
function patch(changes){
 const map=new Map(items.map(item=>[String(item.id),structuredClone(item)]));
 for(const change of changes){
  if(change.delete){map.delete(change.id);continue;}
  if(change.create){map.set(change.id,structuredClone(change.create));continue;}
  const item=Object.assign(map.get(change.id),change.set);for(const key of change.unset||[])delete item[key];
  for(const [season,delta] of Object.entries(change.watched||{})){
   item.watchedEpisodes={...item.watchedEpisodes};const values=new Set(item.watchedEpisodes[season]||[]);
   for(const ep of delta.remove)values.delete(ep);for(const ep of delta.add)values.add(ep);
   if(values.size)item.watchedEpisodes[season]=[...values].sort((a,b)=>a-b);else delete item.watchedEpisodes[season];
  }
 }
 items=[...map.values()];revision++;
}
const server=http.createServer(async(req,res)=>{
 try{
  // Block this device at the actual origin too: worker-owned requests can
  // bypass the automation network-offline flag while another device stays online.
  if(offlineA&&String(req.headers.cookie||'').split(';').some(value=>value.trim()==='watchlog-test-device=A')){res.destroy();return;}
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname.startsWith('/functions/v1/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}'),token=req.headers['x-watchlog-session'];
   const reply=(json,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(json));};
   if(!pathname.endsWith('/watchlog-pin'))return reply({ok:true,enabled:false});
   if(body.action==='app_status')return reply({ok:true,maintenance:false});
   if(body.action==='login'){const sessionToken='device-'+(++serial);tokens.add(sessionToken);return reply({ok:true,account,items,revision,sessionToken});}
   calls.set(token,(calls.get(token)||0)+1);
   if(!tokens.has(token))return reply({error:'Session expired.',code:'session_expired'},401);
   if(body.action==='load')return reply(body.knownRevision===revision?{ok:true,account,unchanged:true,revision}:{ok:true,account,items,revision});
   if(body.action==='catalog_search')return reply({ok:true,results:[]});
   if(body.action==='save'){
    if(failures.get(token)>0){failures.set(token,failures.get(token)-1);return reply({error:'Temporary outage'},503);}
    if(barrierRemaining>0){barrierRemaining--;await new Promise(resolve=>{barrier.push(resolve);if(barrierRemaining===0){barrier.splice(0).forEach(release=>release());}});}
    const requestKey=JSON.stringify({expectedRevision:body.expectedRevision,changes:body.changes});
    if(receipts.has(requestKey))return reply({ok:true,revision:receipts.get(requestKey),replayed:true});
    if(body.expectedRevision!==revision){conflicts++;return reply({code:'revision_conflict',error:'Conflict',items,revision},409);}
    assert.ok(!('items' in body)&&Array.isArray(body.changes));patch(body.changes);receipts.set(requestKey,revision);
    if(dropToken===token){dropToken='';res.destroy();return;}
    return reply({ok:true,revision});
   }
   return reply({ok:true});
  }
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  let content=fs.readFileSync(file);if(pathname==='/assets/js/app-core.js')content=content.toString().replaceAll('https://okkwteywtgfsnlrjdyhv.supabase.co/functions/v1/',`http://${req.headers.host}/functions/v1/`);
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');res.end(content);
 }catch(error){errors.push(error.message);res.writeHead(500).end();}
});
const show=()=>items.find(item=>item.id==='show');
const settled=page=>page.waitForFunction(()=>!localSaveInFlight&&!cloudSaveInFlight&&!queuedCloudSnapshot);
const progress=(page,episodes)=>page.waitForFunction(episodes=>episodes.every(ep=>mediaItems.find(item=>item.id==='show')?.watchedEpisodes?.[1]?.includes(ep)),episodes,{timeout:25000});
const mark=(page,episode)=>page.evaluate(ep=>toggleEpisodeWatched('show',1,ep),episode);
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const browsers=await Promise.all([chromium.launch({headless:true}),webkit.launch({headless:true})]);
 try{
  const contexts=await Promise.all(browsers.map(browser=>browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'})));
  await Promise.all(contexts.map((context,i)=>context.addCookies([{name:'watchlog-test-device',value:i===0?'A':'B',url:base}])));
  for(const context of contexts){await context.addInitScript(()=>window.WebSocket=undefined);await context.route('https://**/*',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:[]}));}
  const observe=page=>page.on('pageerror',error=>errors.push(error.message));let a=await contexts[0].newPage(),b=await contexts[1].newPage();observe(a);observe(b);
  for(const page of [a,b]){await page.goto(base);await page.locator('#auth-email').fill(account.email);await page.locator('#auth-pin').fill('1234');await page.locator('#auth-submit').click();await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));await page.waitForFunction(()=>navigator.serviceWorker.controller);}
  const tokenA=await a.evaluate(()=>cloudSessionToken);
  await b.evaluate(()=>openMediaRow('show'));await b.locator('.gallery-season>summary').click();
  await a.locator('[data-continue-mark="show"]').click();await settled(a);await progress(b,[2]);
  assert.equal(await b.locator('[data-gallery-toggle-episode="1:2"]').getAttribute('aria-pressed'),'true','an open tracker receives the other device tick');
  assert.equal(await b.locator('.gallery-season').getAttribute('open'),'');
  console.log('cross-device: foreground polling updates an open tracker without Sync Now');

  await b.evaluate(()=>document.querySelector('.gallery-detail').close());await b.waitForFunction(()=>!document.querySelector('.gallery-detail[open]'));
  barrierRemaining=2;await Promise.all([mark(a,3),mark(b,4)]);await Promise.all([settled(a),settled(b)]);
  await Promise.all([progress(a,[3,4]),progress(b,[3,4])]);assert.ok(conflicts>0);
  for(const episode of [3,4])assert.equal(show().episodeHistory.filter(event=>event.episode===episode&&event.kind==='mark').length,1);
  console.log('cross-device: concurrent episode writes rebase after a real revision conflict');

  offlineA=true;await contexts[0].setOffline(true);await mark(a,5);await a.waitForFunction(()=>!localSaveInFlight&&!cloudSaveInFlight);
  await b.evaluate(async()=>{await saveTitleNotes('show','Notes from the other device');await saveTitleOrganisation('show',{favorite:true});mediaItems=mediaItems.filter(item=>item.id!=='film');await persistLibrary(mediaItems,{background:true,precleaned:true});});await mark(b,6);await settled(b);
  await a.close();a=await contexts[0].newPage();observe(a);await a.goto(base+'/#/title/show');await progress(a,[5]);
  assert.equal(show().episodeHistory.some(event=>event.episode===5),false,'the offline watch event has not reached the server');
  assert.equal(await a.evaluate(()=>mediaItems.find(item=>item.id==='show').curEp),5,'reopening reads this device cache while the other device is at episode 6');
  offlineA=false;await contexts[0].setOffline(false);await a.evaluate(()=>window.dispatchEvent(new Event('online')));
  await Promise.all([progress(a,[5,6]),progress(b,[5,6])]);await Promise.all([settled(a),settled(b)]);
  for(const episode of [5,6])assert.equal(show().episodeHistory.filter(event=>event.episode===episode&&event.kind==='mark').length,1);
  for(const page of [a,b])assert.equal(await page.evaluate(()=>{const item=mediaItems.find(item=>item.id==='show');return item.notes==='Notes from the other device'&&item.favorite===true&&!mediaItems.some(item=>item.id==='film');}),true);
  console.log('cross-device: offline close/reopen/reconnect retains ticks, remote notes, favourites and deletion');

  failures.set(tokenA,2);await mark(a,7);await progress(b,[7]);await settled(a);assert.equal(failures.get(tokenA),0);assert.equal(await a.evaluate(()=>navigator.onLine),true);
  dropToken=tokenA;await mark(a,8);await progress(b,[8]);await settled(a);
  const events=show().episodeHistory.filter(event=>event.episode===8&&event.kind==='mark');assert.equal(events.length,1,'a dropped acknowledgement must not duplicate the watch event');
  console.log('cross-device: transient failures and dropped acknowledgements recover automatically');

  await a.locator('[data-gallery-menu]').click();await a.locator('[data-gallery-notes]').click();await a.locator('[data-gallery-notes-field]').fill('Resume this draft');
  tokens.delete(tokenA);await mark(a,9);await a.locator('#auth-screen').waitFor({state:'visible'});assert.equal(show().watchedEpisodes[1].includes(9),false);
  const before=calls.get(tokenA);await a.waitForTimeout(1700);assert.equal(calls.get(tokenA),before,'revoked sessions stop retrying');
  await a.locator('#auth-pin').fill('1234');await a.locator('#auth-submit').click();await a.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));await progress(b,[9]);await settled(a);
  await a.locator('.gallery-detail[open]').waitFor();assert.equal(await a.locator('[data-gallery-notes-field]').inputValue(),'Resume this draft');await a.locator('[data-gallery-cancel-notes]').click();
  console.log('cross-device: expired-session sign-in replays the retained edit');

  await b.evaluate(()=>openMediaRow('show'));await b.locator('[data-gallery-menu]').click();await b.locator('[data-gallery-notes]').click();await b.locator('[data-gallery-notes-field]').fill('Unsaved draft');
  await a.evaluate(()=>saveTitleNotes('show','New remote note'));await settled(a);
  await b.waitForFunction(()=>mediaItems.find(item=>item.id==='show').notes==='New remote note',{timeout:25000});
  assert.equal(await b.locator('[data-gallery-notes-field]').inputValue(),'Unsaved draft');await b.locator('[data-gallery-cancel-notes]').click();assert.equal(await b.locator('[data-gallery-notes-preview] p').textContent(),'New remote note');
  await a.evaluate(()=>{document.querySelector('.gallery-detail[open]')?.close();return openEdit('show');});await mark(b,10);await progress(a,[10]);await a.locator('#platform').fill('New service');await a.locator('#save-btn').click();await settled(a);
  assert.ok(show().watchedEpisodes[1].includes(10));assert.equal(show().platform,'New service');
  await b.waitForFunction(()=>mediaItems.find(item=>item.id==='show').platform==='New service',null,{timeout:25000});
  console.log('cross-device: incoming updates retain notes drafts and older forms preserve newer episode progress');

  await b.waitForFunction(()=>!cloudSyncInFlight);
  await b.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await a.evaluate(()=>saveTitleOrganisation('show',{favorite:false}));await settled(a);
  assert.equal(await b.evaluate(()=>mediaItems.find(item=>item.id==='show').favorite),true);
  await b.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await b.waitForFunction(()=>mediaItems.find(item=>item.id==='show').favorite===false,null,{timeout:5000});
  console.log('cross-device: returning to a suspended device checks changes immediately');

  for(const page of [a,b]){await settled(page);assert.equal(await page.evaluate(async()=>(await loadCacheRecord()).dirty),false);}
  assert.deepEqual(errors,[]);console.log('Chromium ↔ WebKit: independent-device sync suite passed');
 }finally{await Promise.all(browsers.map(browser=>browser.close()));}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
