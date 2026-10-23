const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
let handleApi;
const server=http.createServer(async(req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(pathname.startsWith('/functions/v1/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const result=await handleApi(pathname,JSON.parse(Buffer.concat(chunks).toString()||'{}'),req.headers['x-watchlog-session']);
  res.writeHead(result.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(result.json));return;
 }
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 let content=fs.readFileSync(file);
 // Controlled WebKit pages bypass Playwright request routing. Use an actual
 // local API so the worker and offline network failures are exercised in both engines.
 if(pathname==='/assets/js/app-core.js')content=content.toString().replaceAll('https://okkwteywtgfsnlrjdyhv.supabase.co/functions/v1/',`http://${req.headers.host}/functions/v1/`);
 const extension=path.extname(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'})[extension]||'application/octet-stream');res.end(content);
});
function patch(items,changes){
 const map=new Map(items.map(item=>[String(item.id),structuredClone(item)]));
 for(const change of changes){
  if(change.delete){map.delete(change.id);continue;}
  if(change.create){map.set(change.id,change.create);continue;}
  const item=Object.assign(map.get(change.id),change.set);for(const key of change.unset||[])delete item[key];
  for(const [season,delta] of Object.entries(change.watched||{})){
   item.watchedEpisodes={...item.watchedEpisodes};const episodes=new Set(item.watchedEpisodes[season]||[]);
   for(const number of delta.remove)episodes.delete(number);for(const number of delta.add)episodes.add(number);
   if(episodes.size)item.watchedEpisodes[season]=[...episodes].sort((a,b)=>a-b);else delete item.watchedEpisodes[season];
  }
 }
 return [...map.values()];
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,base=`http://127.0.0.1:${port}`;
 for(const engine of process.env.BROWSER_ENGINES==='all'?[chromium,webkit]:[chromium]){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
   let offline=false,revision=0,pin='1234',serial=0,code='ABCD-1234-5678-9012-ABCD-1234-5678-9012';
   const account={id:'upgrade-browser',email:'upgrade@example.test',displayName:'Browser test'},tokens=new Set(['initial']),saves=[],errors=[];
   let items=[{id:'show',title:'Offline Show',type:'Series',status:'Watching',episodeScheduleVerified:true,releasedEpisodes:{1:Array.from({length:300},(_,i)=>i+1),2:[1,2,3]},watchedEpisodes:{1:[1]},episodeCounts:{1:300,2:3},verifiedCompletedSeasons:2,seriesReleaseDate:'2020-01-01'}, {id:'film',title:'Unchanged Film',type:'Film',filmReleaseDate:'2020-01-01',status:'Planned'}];
   await context.addInitScript(({account})=>{if(!localStorage.getItem('watchlog_pin_session_v1'))localStorage.setItem('watchlog_pin_session_v1',JSON.stringify({token:'initial',account,revision:0}));window.WebSocket=undefined;},{account});
   handleApi=async(pathname,body,token)=>{
    if(offline)return {status:503,json:{error:'Offline'}};
    if(!pathname.endsWith('/watchlog-pin'))return {json:{ok:true,enabled:false,results:[]}};
    let data={ok:true};
    if(body.action==='app_status')return {json:{ok:true,maintenance:false}};
    if(body.action==='login'){
     if(body.pin!==pin)return {status:401,json:{error:'Email or PIN is incorrect.'}};
     const newToken='session-'+(++serial);tokens.add(newToken);return {json:{ok:true,account,items,revision,sessionToken:newToken}};
    }
    if(body.action==='recover'){
     if(body.code!==code)return {status:401,json:{error:'Email or recovery code is incorrect.'}};
     pin=body.pin;tokens.clear();code='REPLACEMENT-CODE-SHOWN-ONCE';return {json:{ok:true,recoveryCode:code}};
    }
    if(!tokens.has(token))return {status:401,json:{code:'session_expired',error:'Session expired.'}};
    if(body.action==='load')data={ok:true,account,items,revision};
    if(body.action==='catalog_search')data={ok:true,results:[]};
    if(body.action==='save'){
     saves.push(body);
     if(body.expectedRevision!==revision)return {status:409,json:{code:'revision_conflict',items,revision,error:'Conflict'}};
     items=patch(items,body.changes);revision++;data={ok:true,revision};
    }
    if(body.action==='recovery_generate'){
     if(body.pin!==pin)return {status:401,json:{error:'PIN is incorrect.'}};
     data={ok:true,recoveryCode:code};
    }
    if(body.action==='logout')tokens.delete(token);
    return {json:data};
   };
   await context.route('https://**/*',route=>offline?route.abort('internetdisconnected'):route.fulfill({headers:{'access-control-allow-origin':'*'},json:{ok:true,enabled:false,results:[]}}));
   function observePage(page){
    page.on('pageerror',error=>{errors.push(error.message);console.error(engine.name(),error.message);});
    page.on('console',message=>{if(!offline&&['warning','error'].includes(message.type()))console.error(engine.name(),message.text());});
    page.on('requestfailed',request=>{if(!offline)console.error(engine.name(),request.method(),request.url(),request.failure()?.errorText);});
   }
   let page=await context.newPage();observePage(page);
   await page.goto(base);await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));
   await page.waitForFunction(()=>navigator.serviceWorker.controller,{timeout:20000});
   await page.waitForFunction(()=>document.querySelector('#offline-status').textContent.includes('Ready for offline'));
   assert.equal(await page.locator('[data-continue-mark="show"]').count(),1);
   await page.locator('[data-continue-mark="show"]').click();
   await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&!queuedCloudSnapshot).catch(async error=>{console.error(engine.name(),'first-save state',await page.evaluate(()=>({cloud:!!cloudSaveInFlight,local:!!localSaveInFlight,queued:!!queuedCloudSnapshot,revision:cloudRevision,status:document.querySelector('#sync-status')?.textContent})),{saves:saves.length});throw error;});
   assert.deepEqual(items[0].watchedEpisodes[1],[1,2]);
   await page.locator('[data-gallery-category="Series"]').click();await page.locator('[data-gallery-item="show"]').click();
   await page.waitForFunction(()=>location.hash.startsWith('#/title/show'));
   assert.equal(await page.locator('.gallery-episode-row').count(),0,'closed seasons do not build episode rows');
   await page.locator('.gallery-season[data-season="1"]>summary').click();
   await page.locator('[data-gallery-toggle-episode="1:3"]').waitFor();
   assert.equal(await page.locator('.gallery-episode-row').count(),300,'only the opened season is rendered');
   await page.locator('[data-gallery-toggle-episode="1:3"]').click();
   await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&!queuedCloudSnapshot);
   await page.locator('[data-gallery-menu]').click();await page.locator('[data-gallery-favourite]').click();
   await page.locator('[data-gallery-lists]').click();await page.locator('#title-new-list').fill('My picks');await page.locator('#save-title-lists').click();
   await page.locator('#title-lists-dialog').waitFor({state:'hidden'});
   const directUrl=page.url();await page.locator('[data-gallery-close]').click();
   await page.waitForFunction(()=>location.hash.startsWith('#/library/series'));
   await page.goBack();await page.waitForFunction(()=>location.hash==='#/library');
   await page.goForward();await page.waitForFunction(()=>location.hash.startsWith('#/library/series'));
   await page.goto(directUrl);await page.locator('.gallery-detail[open]').waitFor();
   assert.equal(await page.locator('.gallery-episode-row').count(),0,'deep links retain lazy season loading');
   await page.locator('[data-gallery-close]').click();await page.waitForFunction(()=>location.hash.startsWith('#/library'));
   await page.locator('#library-collection-select').selectOption('favourites');
   assert.equal(await page.locator('.gallery-category[data-gallery-category="Series"] small').textContent(),'1 title');
   await page.locator('#library-collection-select').selectOption('list:My picks');
   await page.locator('[data-gallery-category="Series"]').click();await page.locator('[data-gallery-item="show"]').click();
   await page.locator('[data-gallery-menu]').click();await page.locator('[data-gallery-archive]').click();
   await page.waitForFunction(()=>mediaItems.find(item=>item.id==='show').archived===true);
   await page.locator('[data-gallery-close]').click();await page.waitForFunction(()=>!document.querySelector('.gallery-detail[open]'));
   await page.locator('#library-collection-select').selectOption('archived');await page.locator('[data-gallery-item="show"]').click();
   await page.locator('[data-gallery-menu]').click();await page.locator('[data-gallery-archive]').click();
   await page.waitForFunction(()=>mediaItems.find(item=>item.id==='show').archived===false);
   await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&!queuedCloudSnapshot);
   offline=true;
   // WebKit offline emulation rejects even literal worker responses:
   // https://github.com/microsoft/playwright/issues/42775
   // Stop the origin itself, and retain Chromium's offline emulation as well.
   const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeAllConnections();await stopped;
   if(engine===chromium)await context.setOffline(true);
   const uncached=await browser.newContext({serviceWorkers:'block'}),probe=await uncached.newPage();
   await assert.rejects(probe.goto(base,{timeout:5000}),'an uncached page must fail with the origin stopped');await uncached.close();
   await page.goto(base+'/#/title/show');
   await page.locator('.gallery-detail[open]').waitFor({timeout:20000});
   await page.locator('.gallery-season[data-season="1"]>summary').click();await page.locator('[data-gallery-toggle-episode="1:4"]').click();
   await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&mediaItems.find(item=>item.id==='show').watchedEpisodes[1].includes(4));
   // Close and reopen the page: the edit must survive beyond the old document.
   await page.close();page=await context.newPage();observePage(page);
   await page.goto(base+'/#/title/show');await page.locator('.gallery-detail[open]').waitFor({timeout:20000});
   assert.equal(await page.evaluate(()=>mediaItems.find(item=>item.id==='show').watchedEpisodes[1].includes(4)),true,'offline progress survives reopening');
   assert.equal(items.find(item=>item.id==='show').watchedEpisodes[1].includes(4),false,'offline edit has not reached the server');
   await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));offline=false;
   if(engine===chromium)await context.setOffline(false);
   await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&!queuedCloudSnapshot);
   for(let i=0;i<100&&!items.find(item=>item.id==='show').watchedEpisodes[1].includes(4);i++)await new Promise(resolve=>setTimeout(resolve,50));
   assert.equal(items.find(item=>item.id==='show').watchedEpisodes[1].includes(4),true,'reconnection uploads the saved offline change');
   assert.ok(saves.length>0&&saves.every(body=>!('items' in body)&&Array.isArray(body.changes)));
   await page.locator('[data-gallery-close]').click();await page.waitForFunction(()=>!document.querySelector('.gallery-detail[open]'));
   await page.locator('[data-tab="settings"]').click();await page.locator('[data-settings-open="account"]').click();
   await page.locator('#recovery-current-pin').fill('1234');await page.locator('#generate-recovery-code').click();
   await page.locator('#recovery-code-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#recovery-code-output').textContent(),code);
   assert.equal(await page.locator('#close-recovery-code').isDisabled(),true);
   assert.equal(await page.evaluate(value=>JSON.stringify(localStorage).includes(value),code),false,'recovery code is not persisted in browser storage');
   await page.locator('#recovery-code-saved').check();await page.locator('#close-recovery-code').click();
   assert.equal(await page.locator('#recovery-code-output').textContent(),'');
   await page.locator('#logout-btn').click();await page.locator('#auth-screen').waitFor({state:'visible'});
   await page.locator('#forgot-pin').click();await page.locator('#recover-email').fill(account.email);await page.locator('#recover-code').fill(code);await page.locator('#recover-pin').fill('4321');await page.locator('#recover-submit').click();
   await page.locator('#recovery-code-dialog').waitFor({state:'visible'});await page.locator('#recovery-code-saved').check();await page.locator('#close-recovery-code').click();
   await page.locator('#auth-pin').fill('4321');await page.locator('#auth-submit').click();await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));
   assert.equal(await page.evaluate(()=>mediaItems.find(item=>item.id==='show').watchedEpisodes[1].includes(4)),true);
   assert.deepEqual(errors,[]);console.log(`${engine.name()}: granular sync, offline reopen/edit/reopen/reconnect, recovery, routing, lazy seasons, favourites, archive and lists passed`);
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(server.listening)server.close();});
