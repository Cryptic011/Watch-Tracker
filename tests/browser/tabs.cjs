const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),account={id:'shared-browser-account',email:'tabs@example.test',displayName:'Tabs'};
let revision=0,failSaves=false,items=[];
function apply(changes){
 const rows=new Map(items.map(item=>[String(item.id),structuredClone(item)]));
 for(const change of changes){
  if(change.delete){rows.delete(change.id);continue;}
  if(change.create){rows.set(change.id,structuredClone(change.create));continue;}
  const item=Object.assign(rows.get(change.id),change.set);for(const key of change.unset||[])delete item[key];
 }
 items=[...rows.values()];revision++;
}
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://local').pathname;
 if(pathname.startsWith('/functions/v1/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
  const reply=(json,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(json));};
  if(!pathname.endsWith('/watchlog-pin'))return reply({ok:true,enabled:false});
  if(body.action==='app_status')return reply({ok:true,maintenance:false});
  if(['login','load'].includes(body.action))return reply(body.action==='load'&&body.knownRevision===revision?{ok:true,account,unchanged:true,revision}:{ok:true,account,items,revision,sessionToken:'same-browser-token'});
  if(body.action==='save'){
   if(failSaves)return reply({error:'Controlled test outage'},503);
   if(body.expectedRevision!==revision)return reply({error:'Conflict',code:'revision_conflict',items,revision},409);
   apply(body.changes);return reply({ok:true,revision});
  }
  return reply({ok:true,results:[]});
 }
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 let content=fs.readFileSync(file);if(pathname==='/assets/js/app-core.js')content=content.toString().replaceAll('https://okkwteywtgfsnlrjdyhv.supabase.co/functions/v1/',`http://${req.headers.host}/functions/v1/`);
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');res.end(content);
});
const settled=page=>page.waitForFunction(()=>!localSaveInFlight&&!cloudSaveInFlight);
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 for(const engine of process.env.BROWSER_ENGINES==='all'?[chromium,webkit]:[chromium]){
  revision=0;failSaves=false;items=[{id:'film',title:'Shared tab film',type:'Film',status:'Watched',notes:'original',favorite:false,platform:'original service',filmReleaseDate:'2020-01-01',filmReleaseSource:'Manual',metadataUpdatedAt:new Date().toISOString()}];
  const browser=await engine.launch({headless:true});
  try{
   // Both pages deliberately share the same origin, storage, and IndexedDB.
   const context=await browser.newContext({serviceWorkers:'block'}),errors=[];
   await context.addInitScript(()=>window.WebSocket=undefined);
   await context.route('https://**/*',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:[]}));
   const a=await context.newPage();a.on('pageerror',error=>errors.push(error.message));
   await a.goto(base);await a.locator('#auth-email').fill(account.email);await a.locator('#auth-pin').fill('1234');await a.locator('#auth-submit').click();
   await a.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));
   await a.evaluate(()=>{clearTimeout(cloudSyncTimer);scheduleCloudSync=()=>{};});
   const b=await context.newPage();b.on('pageerror',error=>errors.push(error.message));await b.goto(base);
   await b.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));
   await b.evaluate(()=>{clearTimeout(cloudSyncTimer);scheduleCloudSync=()=>{};});
   for(let index=0;index<12;index++)await b.evaluate(async index=>{mediaItems[0]={...mediaItems[0],platform:'service '+index};await persistLibrary(mediaItems);},index);
   assert.ok(await b.evaluate(()=>localSaveSequence)>await a.evaluate(()=>localSaveSequence));
   failSaves=true;
   await a.evaluate(()=>saveTitleNotes('film','saved by the earlier tab'));await settled(a);
   const before=await a.evaluate(()=>loadCacheRecord());assert.equal(before.items[0].notes,'saved by the earlier tab');assert.equal(before.items[0].platform,'service 11');assert.equal(before.dirty,true);
   failSaves=false;await b.evaluate(()=>retryPendingCloudSave());await settled(b);
   assert.equal(items[0].notes,'saved by the earlier tab');assert.equal(items[0].platform,'service 11');
   assert.equal((await b.evaluate(()=>loadCacheRecord())).dirty,false);

   failSaves=true;
   await Promise.all([a.evaluate(()=>saveTitleNotes('film','concurrent note')),b.evaluate(()=>saveTitleOrganisation('film',{favorite:true}))]);
   await Promise.all([settled(a),settled(b)]);
   let cached=await a.evaluate(()=>loadCacheRecord());assert.equal(cached.items[0].notes,'concurrent note');assert.equal(cached.items[0].favorite,true);
   await b.evaluate(()=>saveTitleOrganisation('film',{favorite:false}));await settled(b);
   await a.evaluate(()=>saveTitleOrganisation('film',{platform:'another service'}));await settled(a);
   cached=await a.evaluate(()=>loadCacheRecord());assert.equal(cached.items[0].favorite,false);assert.equal(cached.items[0].notes,'concurrent note');assert.equal(cached.items[0].platform,'another service');
   failSaves=false;await b.evaluate(()=>retryPendingCloudSave());await settled(b);await a.evaluate(()=>retryPendingCloudSave());await settled(a);
   assert.equal(items[0].favorite,false);assert.equal(items[0].notes,'concurrent note');assert.equal(items[0].platform,'another service');
   assert.equal((await a.evaluate(()=>loadCacheRecord())).dirty,false);assert.deepEqual(errors,[]);
   console.log(engine.name()+': two tabs preserve shared durable edits, concurrent fields and unmarks across failed cloud writes');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
