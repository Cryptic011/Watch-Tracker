const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://local').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/json');
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 for(const engine of process.env.BROWSER_ENGINES==='all'?[chromium,webkit]:[chromium]){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
   const errors=[],account={id:'catalogue-integrity',email:'catalogue@example.test',displayName:'Catalogue test'};
   let revision=0;
   const timestamp=new Date().toISOString();
   let items=[
    {id:'film',title:'Example',type:'Film',status:'Watched',platform:'Netflix',notes:'Film notes stay separate',filmReleaseDate:'2020-01-01',filmReleaseSource:'Manual',metadataUpdatedAt:timestamp,updatedAt:timestamp},
    {id:'show',title:'Example',type:'Series',status:'Watching',imdbId:'tt1234567',platform:'Test service',episodeScheduleVerified:true,releasedEpisodes:{1:[1]},airedEpisodeCounts:{1:1},episodeCounts:{1:1},verifiedCompletedSeasons:1,watchedEpisodes:{1:[1]},curSeason:1,curEp:1,watchedSeasons:1,lastWatchedSeason:1,lastWatchedEpisode:1,lastEpisodeWatchedAt:timestamp,episodeHistory:[{id:'old-mark',kind:'mark',season:1,episode:1,watchedAt:timestamp}],metadataUpdatedAt:timestamp,updatedAt:timestamp}
   ];
   await context.route('**/*',async route=>{
    const req=route.request(),headers={'access-control-allow-origin':req.headers().origin||base,'access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':req.headers()['access-control-request-headers']||'content-type, apikey, authorization, x-watchlog-session'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    if(req.url().includes('/functions/v1/watchlog-pin')){
     const body=req.postDataJSON();let result={ok:true};
     if(['login','load'].includes(body.action))result={ok:true,account,items,revision,sessionToken:'catalogue-token'};
     if(body.action==='uk_availability')result={ok:true,state:'available',source:'JustWatch',providers:[{name:'Netflix',type:'flatrate'}]};
     if(body.action==='catalog_details')result={ok:true,details:{state:'ready',synopsisVersion:3,synopsisScope:body.type==='Series'?'series':'film',source:'IMDb',descriptionSource:'IMDb',description:'An official whole-title synopsis of Example.',sources:[{name:'IMDb',url:'https://www.imdb.com/title/tt1234567/'}]}};
     if(body.action==='save'){
      for(const change of body.changes||[]){
       const index=items.findIndex(item=>item.id===change.id);
       if(change.delete){if(index>=0)items.splice(index,1);continue;}
       if(change.create){items.push(structuredClone(change.create));continue;}
       assert.ok(index>=0,'only existing test titles may be edited');
       const item=items[index]={...items[index],...change.set};
       for(const key of change.unset||[])delete item[key];
       for(const [season,delta] of Object.entries(change.watched||{})){
        item.watchedEpisodes={...item.watchedEpisodes};const episodes=new Set(item.watchedEpisodes[season]||[]);
        for(const ep of delta.remove)episodes.delete(ep);for(const ep of delta.add)episodes.add(ep);
        if(episodes.size)item.watchedEpisodes[season]=[...episodes].sort((a,b)=>a-b);else delete item.watchedEpisodes[season];
       }
      }
      result={ok:true,revision:++revision};
     }
     if(body.action==='catalog_search')result={ok:true,results:[]};
     return route.fulfill({headers,json:result});
    }
    if(req.url().startsWith(base))return route.continue();
    return route.fulfill({headers,json:{ok:true,enabled:false,results:[]}});
   });
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base);await page.locator('#auth-email').fill(account.email);await page.locator('#auth-pin').fill('1234');await page.locator('#auth-submit').click();
   await page.waitForFunction(()=>document.getElementById('auth-screen').classList.contains('hidden'));
   await page.evaluate(()=>openEdit('film'));await page.waitForFunction(()=>selectedUKPlatform==='Netflix');
   await page.locator('#platform').fill('BBC iPlayer');await page.locator('#save-btn').click();
   await page.waitForFunction(()=>document.getElementById('modal').classList.contains('hidden'));
   assert.equal(await page.evaluate(()=>mediaItems.find(item=>item.id==='film').platform),'BBC iPlayer');
   await page.evaluate(()=>openEdit('film'));await page.locator('#platform').fill('');await page.locator('#save-btn').click();
   await page.waitForFunction(()=>document.getElementById('modal').classList.contains('hidden'));
   assert.equal(await page.evaluate(()=>mediaItems.find(item=>item.id==='film').platform),'');
   const clean=await page.evaluate(()=>{
    const manual={id:'manual-film',title:'Example',type:'Film',status:'Watched',notes:'Keep this manually logged film'};
    mediaItems=mediaItems.filter(item=>item.id!=='film');mediaItems.push(manual);mediaItems=cleanLibraryRecords(mediaItems).items;render();
    return mediaItems.find(item=>item.id==='manual-film');
   });
   assert.equal(clean.notes,'Keep this manually logged film');
   await page.evaluate(()=>openMediaRow('show'));
   await page.evaluate(async()=>{await toggleEpisodeWatched('show',1,1);window.WatchLogGallery.refreshCurrent();});
   assert.equal(await page.evaluate(()=>lastLoggedEpisode(mediaItems.find(item=>item.id==='show'))),null);
   assert.deepEqual(await page.evaluate(()=>mediaItems.find(item=>item.id==='show').watchedEpisodes),{});
   assert.doesNotMatch(await page.locator('.gallery-detail').textContent(),/Watched to\s*-\s*S1 E1/);
   assert.deepEqual(errors,[]);
   console.log(engine.name()+': manual platform edits/clearing, separate same-name film retention, and final episode unmark summary passed');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
