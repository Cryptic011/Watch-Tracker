const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const engine of process.env.BROWSER_ENGINES==='all'?[chromium,webkit]:process.env.BROWSER_ENGINES==='webkit'?[webkit]:[chromium]){
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];let phase='login';
  page.on('pageerror',error=>{const message=String(error.message||'');const expectedWebKitPinCors=engine.name()==='webkit'&&message.includes('watchlog-pin?forceFunctionRegion=eu-west-1')&&message.includes('access control checks');if(!expectedWebKitPinCors)errors.push(message);console.error(`${engine.name()} [${phase}] page error: ${error.stack||error.message}`);});
  page.on('requestfailed',request=>console.error(`${engine.name()} [${phase}] request failed: ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
  let items=[],revision=0,failSave=false,saves=0,loads=0,changelogRequests=0,reminderEnabled=false,reminderExpiredTest=false;const catalogQueries=[],reminderTests=[];
  const account={id:'browser-test',email:'browser@example.test',displayName:'Browser Test'};
  await context.route('**/*',async route=>{
   const req=route.request();
   const requestHeaders=req.headers();
   const headers={'access-control-allow-origin':requestHeaders.origin||base,'access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':requestHeaders['access-control-request-headers']||'content-type, x-watchlog-session, authorization, apikey','access-control-max-age':'600'};
   // WebKit applies CORS to fulfilled mocks, including failures and preflights.
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   const url=new URL(req.url());
   if(url.hostname==='api.github.com'){changelogRequests++;return route.fulfill({headers,json:{workflow_runs:[]}});}
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/shows/12')return route.fulfill({headers,json:{id:12,name:'Test Series',premiered:'2020-01-01',externals:{imdb:'tt1234568'},image:{original:'https://static.tvmaze.com/series-poster.jpg'},summary:'<p>An official series description &amp; a second detail.</p>',genres:['Drama','Action'],status:'Running',rating:{average:8.4},runtime:42,language:'English'}});
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/shows/12/episodes')return route.fulfill({headers,json:[
    {season:1,number:1,image:{original:'https://static.tvmaze.com/episode-one.jpg'}},
    {season:1,number:2,image:null},
    {season:1,number:3,image:{original:'https://static.tvmaze.com/series-poster.jpg'}}
   ]});
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/shows/12/seasons')return route.fulfill({headers,json:[
    {number:1,image:{original:'https://static.tvmaze.com/season-one.jpg'}},
    {number:2,image:null}
   ]});
   if(url.hostname==='static.tvmaze.com')return route.fulfill({headers,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#334b68"/><path d="M0 150L110 40L210 120L270 70L320 140V180H0Z" fill="#87a5c5"/><circle cx="245" cy="40" r="18" fill="#e5bf7e"/></svg>'});
   if(url.pathname.includes('/functions/v1/watchlog-reminders')){
    const body=req.postDataJSON();let data={ok:true,history:[],upcoming:[],suppressed:[]};
    if(body.action==='public_key')data.publicKey='AQID';
    if(body.action==='subscribe')reminderEnabled=true;
    if(body.action==='unsubscribe')reminderEnabled=false;
    if(body.action==='status')data.enabled=reminderEnabled;
    if(body.action==='test_reminder'){
     reminderTests.push(body);
     if(reminderExpiredTest){reminderExpiredTest=false;return route.fulfill({status:410,headers,json:{error:'Expired',code:'push_subscription_expired'}});}
    }
    return route.fulfill({headers,json:data});
   }
   if(req.url().includes('/functions/v1/watchlog-pin')){
    const body=req.postDataJSON();let data={ok:true};
    if(['login','load'].includes(body.action)){loads++;data={ok:true,account,items,revision,sessionToken:'test-token'};}
    if(body.action==='catalog_search'){catalogQueries.push(String(body.query||'').toLowerCase());data={ok:true,results:[
     {title:'Browser Test Film',format:'Film',source:'imdb',imdbId:'tt1234567',year:'2020',posterUrl:'https://m.media-amazon.com/test.jpg',description:'A detective uncovers a mystery in a quiet coastal town. '.repeat(8)},
     {title:'Browser Test Series',format:'Series',source:'tvmaze',tvmazeId:'12',imdbId:'tt7654321',year:'2021',description:'Investigators work together to solve difficult cases.'},
    ]};}
    if(body.action==='catalog_details'){
     const series=body.type==='Series',id=series?'tt1234568':'tt1234567',url='https://www.imdb.com/title/'+id+'/';
     data={ok:true,details:{state:'ready',synopsisVersion:3,synopsisScope:series?'series':'film',description:series?'An official series description & a second detail.':'A detective uncovers a mystery in a quiet coastal town. '.repeat(8),year:'2020',genres:['Drama','Action'],runtime:series?42:120,rating:8.4,ratingSource:series?'TVMaze':'IMDb',source:series?'TVMaze':'IMDb',sources:[{name:series?'TVMaze':'IMDb',url:series?'https://www.tvmaze.com/shows/12':url}],imdbUrl:url}};
    }
    if(body.action==='save'){
     if(failSave)return route.fulfill({status:503,headers,json:{error:'Offline'}});
     if(body.items)items=body.items;
     else for(const change of body.changes||[]){
      const index=items.findIndex(item=>String(item.id)===change.id);
      if(change.delete){if(index>=0)items.splice(index,1);continue;}
      if(change.create){items.push(change.create);continue;}
      if(index<0)throw Error('Unknown title');
      const item=items[index]={...items[index],...change.set};for(const key of change.unset||[])delete item[key];
      for(const [season,delta] of Object.entries(change.watched||{})){item.watchedEpisodes={...item.watchedEpisodes};const values=new Set(item.watchedEpisodes[season]||[]);for(const ep of delta.remove)values.delete(ep);for(const ep of delta.add)values.add(ep);if(values.size)item.watchedEpisodes[season]=[...values].sort((a,b)=>a-b);else delete item.watchedEpisodes[season];}
     }
     revision++;saves++;data={ok:true,revision};
    }
    return route.fulfill({headers,json:data});
   }
   if(req.url().startsWith(base))return route.continue();
   return route.fulfill({headers,json:{ok:true,enabled:false,results:[]}});
  });
  await page.goto(base);
  await page.locator('#auth-email').fill(account.email);await page.locator('#auth-pin').fill('1234');await page.locator('#auth-submit').click();
  await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'));
  assert.equal(changelogRequests,0,'startup does not request workflow history');
  assert.equal(await page.locator('.changelog-entry').count(),0,'startup does not construct the full hidden changelog');
  assert.equal(await page.evaluate(()=>{const node=mediaList.querySelector('.gallery-category');render();return Boolean(node)&&node===mediaList.querySelector('.gallery-category');}),true,'unchanged Library render retains category and poster nodes');
  // Exercise the actual weekly schedule DOM, not just its sorting helper.
  // Date order deliberately conflicts with local clock order (17:00 this
  // week vs 01:00 next week); an undated old show must not appear at all.
  phase='weekly schedule';
  const weeklyScreen=await page.evaluate(()=>{
   const original=mediaItems,now=new Date(),target=new Date(now);
   target.setHours(12,0,0,0);
   target.setDate(target.getDate()+((4-target.getDay()+7)%7||7));
   const day=target.getDay();
   const stamp=(weeks,hour)=>{
    const date=new Date(target);date.setDate(date.getDate()+weeks*7);date.setHours(hour,0,0,0);return date.toISOString();
   };
   const dateOnly=weeks=>{
    const date=new Date(target);date.setDate(date.getDate()+weeks*7);
    return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
   };
   const make=(id,title,weeks,hour)=>({id,title,platform:'Verified network',type:'Series',status:'Watching',
    scheduledEpisodeReleases:weeks.map((week,i)=>({season:1,number:i+1,raw:hour===null?dateOnly(week):stamp(week,hour)}))});
   const evening=make('later-clock','17:00 programme',[-2,-1,0],17);
   const overnight=make('earlier-clock','01:00 programme',[-4,-3,1],1);
   const untimed=make('date-only','Time unknown programme',[-2,-1,0],null);
   const expired=make('expired','Unannounced returning programme',[-3,-2,-1],21);
   expired.nextEpisodeNum=4;expired.nextEpisodeDate='';
   try{
    mediaItems=[evening,overnight,untimed,expired,{...evening,id:'duplicate-clock',imdbId:'tt1234999'}];
    renderRecurringWeeklySchedule();
    const area=document.querySelector('.recurring-weekday[data-recurring-day="'+day+'"]');
    return {cards:[...area.querySelectorAll('[data-recurring-open]')].map(node=>({
     title:node.querySelector('.release-show-title span')?.textContent,
     time:node.querySelector('.release-time')?.textContent
    })),count:area.querySelector('.release-day-count')?.textContent,
    unannouncedPresent:document.querySelector('#recurring-weekly-dashboard')?.textContent.includes('Unannounced returning programme'),
    noHorizontalOverflow:document.documentElement.scrollWidth<=window.innerWidth};
   }finally{mediaItems=original;renderRecurringWeeklySchedule();}
  });
  assert.deepEqual(weeklyScreen.cards.map(card=>card.title),['01:00 programme','17:00 programme','Time unknown programme'],'recurring cards are ordered by local time before the next calendar week');
  assert.ok(weeklyScreen.cards.at(-1).time.includes('TBA'),'a confirmed date without a time sorts last');
  assert.equal(weeklyScreen.unannouncedPresent,false,'past release patterns cannot assign a weekday to an unannounced return');
  assert.match(weeklyScreen.count,/^3 shows$/,'duplicate entries do not inflate the schedule');
  assert.equal(weeklyScreen.noHorizontalOverflow,true,'weekly schedule fits the mobile viewport');
  console.log(engine.name()+': recurring clock order, undated returns, duplicate cards and mobile width passed');

  // Add and edit via the real form; external catalogue responses stay mocked.
  phase='search';
  await page.locator('#add-btn').click();
  await page.locator('[data-browse-format="Film"]').click();assert.equal(await page.locator('#discovery-query').inputValue(),'');
  await page.locator('[data-discovery-filter="All"]').click();await page.locator('#discovery-query').fill('Browser Test Film');
  await page.locator('#discovery-results .discovery-title').first().waitFor();
  // iOS keeps the keyboard open until the search input actually loses focus.
  await page.locator('#discovery-query').focus();
  await page.evaluate(()=>document.querySelector('#discovery-form').requestSubmit());
  assert.equal(await page.locator('#discovery-query').evaluate(input=>input===document.activeElement),false,'submitting search ends keyboard entry');
  await page.locator('#discovery-query').focus();
  await page.evaluate(()=>renderTitleSearch());
  assert.equal(await page.locator('#discovery-query').evaluate(input=>input===document.activeElement),true,'result updates do not interrupt typing');
  await page.evaluate(()=>{
   const target=document.querySelector('#discovery-results');
   for(const [name,y] of [['touchstart',300],['touchmove',260]]){
    const event=new Event(name,{bubbles:true});Object.defineProperty(event,'touches',{value:[{clientX:100,clientY:y}]});target.dispatchEvent(event);
   }
  });
  assert.equal(await page.locator('#discovery-query').evaluate(input=>input===document.activeElement),false,'browsing results dismisses keyboard entry');
  assert.equal(await page.locator('#discovery-query').inputValue(),'Browser Test Film','dismissal preserves the search');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overscrollBehaviorY),'none','search suppresses viewport rubber banding');
  await page.locator('[data-discovery-filter="Series"]').click();assert.equal(await page.locator('#discovery-results .discovery-title').count(),1);
  await page.locator('[data-discovery-filter="Film"]').click();
  await page.locator('#discovery-results summary').first().click();assert.equal(await page.locator('#discovery-results details').first().getAttribute('open'),'');
  await page.locator('#discovery-results .discovery-title').first().click();await page.locator('#discovery-detail').waitFor({state:'visible'});
  await page.locator('[data-discovery-detail-source] a[href="https://www.imdb.com/title/tt1234567/"]').waitFor();
  assert.ok((await page.locator('.discovery-full-description').textContent()).length>100);
  await page.locator('#discovery-detail-add').click();await page.locator('#modal').waitFor({state:'visible'});
  assert.equal(await page.locator('#title').inputValue(),'Browser Test Film');assert.equal(await page.locator('#type').inputValue(),'Film');
  await page.locator('#save-btn').click();await page.waitForFunction(()=>!localSaveInFlight&&!cloudSaveInFlight&&mediaItems.length===1);
  assert.equal(items[0].title,'Browser Test Film');
  await page.locator('#discovery-library-results [data-library-result]').waitFor();
  assert.equal(await page.locator('#discovery-results [data-discovery-add]').count(),0,'saved global results move into the Library section');
  const matchingCatalogRequests=()=>catalogQueries.filter(query=>query==='browser test').length;
  const beforeLocalSearch=matchingCatalogRequests();
  await page.locator('#discovery-query').fill('Browser Test');
  await page.locator('[data-discovery-filter="All"]').click();
  await page.locator('#discovery-library-results [data-library-result]').waitFor();
  await page.waitForTimeout(600);
  assert.equal(matchingCatalogRequests(),beforeLocalSearch,'typing a saved-title match makes no global search requests');
  assert.equal(await page.locator('#discovery-search-global').isVisible(),true);
  await page.locator('#discovery-search-global').click();
  await page.locator('#discovery-results .discovery-title').waitFor();
  assert.ok(matchingCatalogRequests()>beforeLocalSearch,'global search remains available on request');
  assert.equal(await page.locator('#discovery-library-results [data-library-result]').count(),1);
  assert.equal(await page.locator('#discovery-results .discovery-title').count(),1,'the saved film is not duplicated in global results');
  const groups=await page.locator('#discovery-library,#discovery-global').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));assert.ok(groups[0]<groups[1],'Library matches stay above global results');
  await page.locator('#discovery-library-results .discovery-actions [data-library-open]').click();
  assert.equal(await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true','saved search results open the new film page');
  assert.equal(await page.locator('[data-gallery-watch-next]').count(),0,'films do not show an episode action');
  assert.equal(await page.locator('#modal').isVisible(),false,'viewing a saved search result is not editing it');
  await page.locator('[data-gallery-close]').click();
  await page.locator('[data-tab="library"]').click();await page.locator('[data-tab="search"]').click();assert.equal(await page.locator('#discovery-query').inputValue(),'Browser Test');
  await page.locator('#discovery-manual').click();await page.locator('#modal').waitFor({state:'visible'});await page.locator('#close-modal').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('[data-tab="library"]').click();
  phase='gallery';
  assert.equal(await page.getByRole('heading',{name:'Next to watch',exact:true}).count(),0);
  const categories=await page.locator('.gallery-category').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().y,height:n.getBoundingClientRect().height})));
  assert.ok(categories[1].y>=categories[0].y+categories[0].height);
  await page.evaluate(()=>{mediaItems[0].status='Watched';mediaItems[0].filmReleaseDate='2020-02-14';mediaItems[0].date='2026-09-21';render();});
  await page.locator('[data-gallery-category="Film"]').click();await page.locator('[data-filter="Watched"]').click();
  assert.match(await page.locator('.gallery-section h3').first().textContent(),/^2020/);
  assert.equal(await page.locator('[data-gallery-manage]').count(),1);
  assert.equal(await page.locator('.gallery-section [data-gallery-manage]').count(),0);
  assert.equal(await page.locator('[data-gallery-total-count]').textContent(),'1');
  await page.getByRole('button',{name:'Manage movies titles',exact:true}).click();
  assert.equal(await page.locator('#bulk-title-options label').count(),1);
  assert.match(await page.locator('#bulk-title-options').textContent(),/Browser Test Film/);
  await page.getByRole('button',{name:'Mark watched',exact:true}).click();
  assert.equal(await page.locator('#bulk-manage-status').textContent(),'Select at least one title.');
  await page.getByRole('button',{name:'Close bulk actions',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('.gallery-tile').first().click();
  assert.equal(await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Details',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-gallery-details]').textContent.includes('coastal town'));
  assert.equal(await page.locator('[data-gallery-details] a[href="https://www.imdb.com/title/tt1234567/"]').count(),1,'film details show their actual source');
  await page.locator('[data-gallery-close]').click();
  await page.locator('[data-filter="All"]').click();await page.locator('[data-gallery-back]').click();
  await page.evaluate(()=>openEdit(mediaItems[0].id));await page.locator('#platform').fill('Cinema');await page.locator('#save-btn').click();
  await page.waitForFunction(()=>mediaItems[0]?.platform==='Cinema'&&!cloudSaveInFlight&&!localSaveInFlight&&!queuedCloudSnapshot&&!queuedLocalSnapshot,null,{timeout:10000});assert.equal(items[0].platform,'Cinema');
  // Seed a verified schedule through the same persistence code used by imports.
  phase='episode tracking';
  await page.evaluate(async()=>{
   mediaItems.push({id:'show',title:'Test Series',type:'Series',status:'Planned',platform:'Netflix',tvmazeShowId:'12',imdbId:'tt1234568',episodeImages:{1:{1:'https://static.tvmaze.com/series-poster.jpg'}},episodeScheduleVerified:true,releasedEpisodes:{1:[1,2,3]},airedEpisodeCounts:{1:3},episodeCounts:{1:4},watchedEpisodes:{},metadataUpdatedAt:new Date().toISOString(),seriesReleaseDate:'2020-01-01'});
   await persistLibrary(mediaItems);render();openEpisodeTracker('show');
  });
  await page.locator('#episode-watch-next').click();await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.equal(await page.locator('#episode-tracker-grid [data-season="1"][data-episode="1"]').getAttribute('aria-pressed'),'false');
  await page.locator('#episode-tracker-grid [data-season="1"][data-episode="2"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[1,2]});
  assert.equal(await page.locator('#episode-tracker-grid [data-episode="1"]').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{});
  await page.locator('#episode-tracker-grid [data-season="1"][data-episode="2"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  await page.locator('#episode-tracker-grid [data-season="1"][data-episode="1"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[2]});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[1,2]});
  await page.locator('#episode-tracker-grid [data-season="1"][data-episode="1"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[2]});
  await page.locator('#episode-tracker-grid [data-season="1"][data-episode="2"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[2]},'Undo restores the exact previous map, including gaps');
  await page.locator('#episode-tracker-grid [data-season="1"][data-episode="3"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[1,2,3]});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[2]},'Undo keeps episodes watched before catch-up');
  assert.equal(await page.locator('#episode-tracker-grid [data-episode="4"]').count(),0);
  await page.locator('#close-episode-tracker').click();
  phase='episode artwork';
  await page.evaluate(()=>{
   const item=mediaItems.find(row=>row.id==='show');
   item.releasedEpisodes={1:Array.from({length:18},(_,index)=>index+1),2:[1,2,3]};item.airedEpisodeCounts={1:18,2:3};item.episodeCounts={1:18,2:4};
   item.episodeTitles={1:{1:'A Longer Episode Title That Wraps Without Squeezing the Artwork'}};render();
  });
  await page.locator('[data-gallery-category="Series"]').click();
  phase='category management';
  assert.equal(await page.locator('[data-gallery-manage]').count(),1);
  assert.equal(await page.locator('.gallery-section [data-gallery-manage]').count(),0);
  assert.equal(await page.locator('.bulk-toolbar').count(),0);
  assert.equal(await page.locator('[data-gallery-total-count]').textContent(),'1');
  assert.equal(await page.locator('[data-gallery-total-count]').evaluate(count=>count.nextElementSibling.matches('[data-gallery-manage]')),true);
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:844});
   await page.locator('[data-gallery-manage]').scrollIntoViewIfNeeded();
   const layout=await page.locator('[data-gallery-manage]').evaluate(button=>{
    const bounds=button.getBoundingClientRect(),add=document.querySelector('#add-btn')?.getBoundingClientRect();
    return {position:getComputedStyle(button).position,width:bounds.width,height:bounds.height,right:bounds.right,overflow:document.documentElement.scrollWidth>innerWidth,overlap:add&&bounds.left<add.right&&bounds.right>add.left&&bounds.top<add.bottom&&bounds.bottom>add.top};
   });
   assert.ok(!['fixed','sticky'].includes(layout.position));
   assert.ok(layout.width>=44&&layout.height>=44&&layout.right<=width);
   assert.equal(layout.overflow,false);assert.ok(!layout.overlap);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-filter="Watched"]').click();
  assert.equal(await page.locator('.gallery-tile').count(),0);
  assert.equal(await page.locator('[data-gallery-total-count]').textContent(),'1','total includes tracked titles outside the active filter');
  await page.getByRole('button',{name:'Manage series titles',exact:true}).click();
  assert.equal(await page.locator('#bulk-title-options label').count(),1);
  assert.equal(await page.locator('#bulk-title-options input').inputValue(),'show');
  assert.doesNotMatch(await page.locator('#bulk-title-options').textContent(),/Browser Test Film/);
  await page.getByRole('button',{name:'Close bulk actions',exact:true}).click();
  await page.locator('[data-filter="All"]').click();
  phase='episode artwork';
  await page.locator('[data-gallery-item="show"]').first().click();
  assert.equal(await page.getByRole('tab',{name:'Episodes',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('.gallery-series-detail').count(),1,'series retain the updated season cards');
  assert.equal(await page.locator('.gallery-detail-body>.gallery-art').count(),1,'series retain their main cover above the episode list');
  await page.locator('.gallery-detail-body>.gallery-art img').waitFor({state:'visible'});
  assert.equal(await page.locator('.gallery-detail-body>.gallery-art img').getAttribute('src'),'https://static.tvmaze.com/series-poster.jpg','the main cover uses the show artwork');
  assert.equal(await page.locator('.gallery-season-label small').first().isVisible(),false,'collapsed season cards keep progress copy out of the way');
  assert.match(await page.locator('.gallery-episodes-progress').getAttribute('aria-label'),/\d+ of \d+ released episodes watched/,'overall progress remains accessible');
  assert.equal(await page.locator('[data-gallery-notes-preview]').isVisible(),false);
  assert.equal(await page.locator('[data-gallery-watch-summary]').evaluate(summary=>summary.previousElementSibling.classList.contains('gallery-season-list')),true,'watch summary is below seasons');
  assert.equal(await page.locator('[data-gallery-watch-next]').textContent(),'Watch next · S1 E1');
  await page.locator('[data-gallery-watch-next]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(row=>row.id==='show').watchedEpisodes,{'1':[1,2]});
  assert.equal(await page.locator('.gallery-season[open]').count(),0,'Watch next needs no expanded season');
  assert.equal(await page.locator('[data-gallery-watch-next]').textContent(),'Watch next · S1 E3','Watch next advances past already-watched episodes');
  await page.getByRole('tab',{name:'Details',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-gallery-details]').textContent.includes('official series description'));
  assert.match(await page.locator('[data-gallery-details]').textContent(),/Drama · Action/);
  assert.match(await page.locator('[data-gallery-details]').textContent(),/8\.4\/10/);
  assert.equal(await page.locator('[data-gallery-details] a[href="https://www.tvmaze.com/shows/12"]').count(),1,'series details link to their TVMaze source');
  assert.equal(await page.locator('[data-gallery-details] a[href="https://www.imdb.com/title/tt1234568/"]').count(),1,'series details retain the optional IMDb link');
  assert.match(await page.locator('[data-gallery-details]').textContent(),/TVMaze rating/);
  if(process.env.BROWSER_SCREENSHOT_DIR){
   fs.mkdirSync(process.env.BROWSER_SCREENSHOT_DIR,{recursive:true});
   await page.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-details.png')});
  }
  assert.equal(await page.locator('.gallery-season-list').isVisible(),false);
  await page.getByRole('tab',{name:'Episodes',exact:true}).click();
  await page.locator('.gallery-season summary').first().click();
  assert.equal(await page.locator('.gallery-season-label small').first().isVisible(),true,'opening a season reveals its exact progress');
  await page.locator('[data-gallery-toggle-episode="1:1"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  await page.locator('[data-gallery-episode="1:1"] img').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-gallery-episode="1:1"] img').getAttribute('src'),'https://static.tvmaze.com/episode-one.jpg');
  await page.locator('[data-gallery-season-art="1"] img').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-gallery-season-art="1"] img').getAttribute('src'),'https://static.tvmaze.com/season-one.jpg');
  assert.equal(await page.locator('[data-gallery-season-art="2"] img').count(),0);
  const firstSeason=page.locator('.gallery-season[data-season="1"]');
  await firstSeason.locator('summary').press('Enter');
  await page.locator('.gallery-season[data-season="1"]:not([open])').waitFor({state:'attached'});
  await firstSeason.locator('summary').press('Enter');
  await page.locator('[data-gallery-toggle-episode="1:1"]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-gallery-toggle-episode="1:1"]').getAttribute('aria-pressed'),'false','animated keyboard expansion preserves episode progress');
  await page.emulateMedia({reducedMotion:'reduce'});
  await firstSeason.locator('summary').press('Enter');
  assert.equal(await firstSeason.getAttribute('open'),null,'reduced motion collapses a season immediately');
  await firstSeason.locator('summary').press('Enter');
  assert.equal(await firstSeason.getAttribute('open'),'','reduced motion still opens the episode list');
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const episode of [2,3]){
   assert.equal(await page.locator('[data-gallery-episode="1:'+episode+'"] img').count(),0);
   assert.equal(await page.locator('[data-gallery-episode="1:'+episode+'"] .gallery-artwork-placeholder').isVisible(),true);
  }
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:844});
   const layout=await page.locator('[data-gallery-episode="1:1"]').evaluate(row=>{
    const bounds=node=>{const rect=node.getBoundingClientRect();return {width:rect.width,height:rect.height,right:rect.right};};
    const dialog=row.closest('dialog');
    return {display:getComputedStyle(row).display,art:bounds(row.querySelector('.gallery-episode-art')),text:bounds(row.querySelector('.gallery-episode-copy')),button:bounds(row.querySelector('button')),overflow:dialog.scrollWidth>dialog.clientWidth};
   });
   assert.equal(layout.display,'grid');assert.equal(layout.overflow,false);
   assert.ok(layout.button.width>=44&&layout.button.height>=44);
   assert.ok(layout.button.right<=width-24,'watch control leaves a right-hand scroll gutter');
   assert.ok(layout.text.width>=80,'episode title retains readable space');
   assert.ok(Math.abs(layout.art.width/layout.art.height-16/9)<.04,'episode artwork keeps its natural landscape ratio');
  }
  await page.setViewportSize({width:390,height:844});
  const pinnedSeason=await firstSeason.evaluate(node=>{
   const dialog=node.closest('dialog'),header=dialog.querySelector('.gallery-detail-header'),summary=node.querySelector('summary');
   dialog.scrollTop+=summary.getBoundingClientRect().top-header.getBoundingClientRect().bottom+30;
   return {gap:summary.getBoundingClientRect().top-header.getBoundingClientRect().bottom,overflow:dialog.scrollWidth>dialog.clientWidth};
  });
  assert.ok(Math.abs(pinnedSeason.gap)<=2,'expanded season heading remains below the series header while scrolling');
  assert.equal(pinnedSeason.overflow,false,'pinned headers do not introduce sideways scrolling');
  await page.locator('[data-gallery-episode="1:1"] .gallery-episode-art').click();
  assert.equal(await page.locator('[data-gallery-toggle-episode="1:1"]').getAttribute('aria-pressed'),'false','tapping the row does not accidentally mark progress');
  const gutterRow=await page.locator('[data-gallery-episode="1:1"]').boundingBox();
  await page.touchscreen.tap(382,gutterRow.y+gutterRow.height/2);
  assert.equal(await page.locator('[data-gallery-toggle-episode="1:1"]').getAttribute('aria-pressed'),'false');
  if(process.env.BROWSER_SCREENSHOT_DIR){
   fs.mkdirSync(process.env.BROWSER_SCREENSHOT_DIR,{recursive:true});
   await page.locator('.gallery-detail').evaluate(dialog=>{dialog.scrollTop+=dialog.querySelector('.gallery-season-list').getBoundingClientRect().top-dialog.querySelector('header').getBoundingClientRect().bottom-12;});
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');
   await page.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-tracker-dark.png')});
   await page.evaluate(()=>document.documentElement.dataset.theme='light');
   await page.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-tracker-light.png')});
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  }
  await page.locator('[data-gallery-watch-next]').click();
  await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[1,2]});
  assert.equal(await page.locator('.gallery-season[data-season="1"]').getAttribute('open'),'','Watch next preserves expanded seasons');
  await page.locator('[data-gallery-season="2"]').scrollIntoViewIfNeeded();
  const trackerScroll=await page.locator('.gallery-detail').evaluate(dialog=>dialog.scrollTop);
  await page.locator('[data-gallery-season="2"]').click();
  await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[1,2],'2':[1,2,3]});
  assert.equal(await page.locator('.gallery-season[data-season="2"]').getAttribute('open'),null);
  assert.ok(Math.abs(await page.locator('.gallery-detail').evaluate(dialog=>dialog.scrollTop)-trackerScroll)<=2,'saving season progress preserves the scroll position');
  await page.locator('[data-gallery-season="2"]').click();
  await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[1,2]});
  await page.locator('.gallery-season[data-season="2"] summary').click();
  await page.locator('[data-gallery-toggle-episode="2:3"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(x=>x.id==='show').watchedEpisodes,{'1':[1,2],'2':[1,2,3]},'gallery catch-up affects only the selected season');
  assert.equal(await page.locator('[data-gallery-toggle-episode="2:1"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-gallery-season="2"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  await page.locator('.gallery-season[data-season="2"] summary').click();
  phase='title notes';
  assert.match(await page.locator('[data-gallery-watch-summary]').textContent(),/Watched to - S1 E2/);
  assert.match(await page.locator('[data-gallery-watch-summary]').textContent(),/Watched on: Netflix/);
  const notesUpdatedBefore=await page.evaluate(()=>mediaItems.find(row=>row.id==='show').updatedAt);
  const savedTitleNotes='A note about this series.\nWatch again with family.';
  await page.locator('[data-gallery-menu]').click();
  await page.locator('[data-gallery-notes]').click();
  assert.equal(await page.locator('[data-gallery-notes-field]').evaluate(field=>document.activeElement===field),true);
  const notesPosition=await page.locator('[data-gallery-notes-field]').boundingBox();
  assert.ok(notesPosition.y>=0&&notesPosition.y+notesPosition.height<=844,'Notes opens in the visible viewport');
  await page.locator('[data-gallery-notes-field]').fill(savedTitleNotes);
  await page.locator('[data-gallery-save-notes]').click();
  await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&document.querySelector('[data-gallery-notes-editor]').classList.contains('hidden'));
  assert.equal(items.find(row=>row.id==='show').notes,savedTitleNotes);
  assert.notEqual(items.find(row=>row.id==='show').updatedAt,notesUpdatedBefore);
  assert.equal(await page.locator('[data-gallery-notes-preview] p').textContent(),savedTitleNotes);
  if(process.env.BROWSER_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-notes.png')});
  assert.equal(await page.locator('[data-gallery-notes-preview]').evaluate(preview=>Boolean(preview.compareDocumentPosition(document.querySelector('.gallery-detail-tabs'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  await page.locator('[data-gallery-close]').click();
  await page.locator('[data-gallery-item="show"]').first().click();
  assert.equal(await page.locator('[data-gallery-notes-preview] p').textContent(),savedTitleNotes);
  assert.equal(await page.getByRole('tab',{name:'Episodes',exact:true}).getAttribute('aria-selected'),'true');
  await page.locator('[data-gallery-menu]').click();await page.locator('[data-gallery-notes]').click();
  await page.locator('[data-gallery-notes-field]').fill('Unsaved change');
  await page.locator('[data-gallery-cancel-notes]').click();
  assert.equal(await page.locator('[data-gallery-notes-preview] p').textContent(),savedTitleNotes);
  await page.locator('[data-gallery-menu]').click();await page.locator('[data-gallery-notes]').click();
  await page.locator('[data-gallery-notes-field]').fill('');
  await page.locator('[data-gallery-save-notes]').click();
  await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&document.querySelector('[data-gallery-notes-editor]').classList.contains('hidden'));
  assert.equal(await page.locator('[data-gallery-notes-preview]').isVisible(),false);
  assert.equal(items.find(row=>row.id==='show').notes,'');
  await page.locator('[data-gallery-close]').click();
  await page.locator('[data-gallery-back]').click();
  // Delete/Undo restores just the removed title, preserving other progress.
  await page.evaluate(()=>openEdit(mediaItems[0].id));await page.locator('#delete-btn').click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&mediaItems.length===2);
  assert.equal(items.length,2);
  // Exercise the Settings menu and each drill-in panel in a mobile browser.
  phase='settings visibility';
  const assertSettingsOnly=async()=>{
   for(const selector of ['.top-nav h1','.top-nav .search-box','.stats-row','#library-view','#discovery-view','#add-btn']){
    assert.equal(await page.locator(selector).isVisible(),false,selector+' must not be visible in Settings');
   }
  };
  await page.locator('[data-tab="settings"]').click();
  await page.waitForFunction(()=>!document.querySelector('#settings-view').classList.contains('hidden')&&document.querySelector('#library-view').classList.contains('hidden'));
  assert.equal(await page.locator('#settings-category-menu').isVisible(),true,'Settings category menu is visible');
  assert.equal(await page.getByRole('heading',{name:'Settings',exact:true}).isVisible(),true,'Settings has its own page title');
  assert.equal(await page.locator('.settings-quick-actions').isVisible(),true,'Track Sync shortcut is visible');
  await assertSettingsOnly();
  await page.locator('#whats-new-button').click();
  await page.waitForFunction(()=>!pushStatusesInFlight&&document.querySelector('.changelog-entry'));
  assert.equal(changelogRequests,1,'workflow history loads only when Changelog opens');
  await page.locator('.changelog-entry summary').first().click();
  await page.evaluate(()=>loadPushStatuses());
  assert.equal(await page.locator('.changelog-entry').first().getAttribute('open'),'','status refresh preserves the expanded release');
  await page.locator('#close-changelog').click();
  for(const theme of ['dark','light']){
   await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
   const colours=await page.evaluate(()=>{
    const reference=getComputedStyle(document.querySelector('.whats-new-button')).backgroundColor;
    return {reference,panels:[...document.querySelectorAll('.settings-category-menu,.settings-quick-actions,.settings-detail-panel>.profile-card')].map(panel=>getComputedStyle(panel).backgroundColor)};
   });
   assert.ok(colours.panels.length>=5);
   assert.ok(colours.panels.every(colour=>colour===colours.reference),'all Settings panels match Changelog in '+theme+' mode');
  }
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.locator('[data-settings-open="general"]').click();
  assert.equal(await page.locator('#appearance-mode').isVisible(),true,'General opens appearance controls');
  await assertSettingsOnly();
  await page.locator('[data-settings-panel="general"] [data-settings-back]').click();
  await page.locator('[data-settings-open="reminders"]').click();
  assert.equal(await page.locator('#background-reminder-status').isVisible(),true,'Release Reminders opens reminder controls');
  await assertSettingsOnly();
  phase='reminder recovery';
  await page.evaluate(async()=>{
   window._reminderOriginals={notification:Object.getOwnPropertyDescriptor(window,'Notification'),push:Object.getOwnPropertyDescriptor(window,'PushManager'),worker:Object.getOwnPropertyDescriptor(navigator,'serviceWorker')};
   let serial=0;window._reminderSubscription=null;
   const worker={active:{},pushManager:{getSubscription:async()=>window._reminderSubscription,subscribe:async()=>window._reminderSubscription={endpoint:'https://web.push.apple.com/browser-test-'+(++serial),toJSON(){return{endpoint:this.endpoint,keys:{auth:'auth',p256dh:'key'}};},unsubscribe:async()=>{window._reminderSubscription=null;return true;}}}};
   Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'granted'}});
   Object.defineProperty(window,'PushManager',{configurable:true,value:{}});
   Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:async()=>worker,ready:Promise.resolve(worker)}});
   await refreshBackgroundReminderStatus();
  });
  assert.equal(await page.locator('#enable-background-reminders').textContent(),'Reconnect Reminders');
  assert.equal(await page.locator('#disable-background-reminders').isVisible(),false);
  assert.equal(await page.locator('#test-background-reminder').isDisabled(),true);
  await page.locator('#enable-background-reminders').click();
  await page.waitForFunction(()=>document.querySelector('#quick-reminder-status span').textContent==='Reminders on');
  assert.equal(await page.locator('#disable-background-reminders').isVisible(),true);
  await page.evaluate(()=>window._reminderSubscription=null);
  await page.locator('#test-background-reminder').click();
  await page.waitForFunction(()=>document.querySelector('#background-reminder-status').textContent.includes('accepted'));
  reminderExpiredTest=true;
  await page.locator('#test-background-reminder').click();
  await page.waitForFunction(()=>!document.querySelector('#test-background-reminder').disabled);
  assert.equal(reminderTests.length,3,'an expired endpoint is renewed and tested once more');
  assert.equal(reminderTests[1].requestId,reminderTests[2].requestId);
  assert.notEqual(reminderTests[1].endpoint,reminderTests[2].endpoint);
  await page.locator('#disable-background-reminders').click();
  await page.waitForFunction(()=>document.querySelector('#quick-reminder-status span').textContent==='Reminders off');
  assert.equal(reminderEnabled,false);
  assert.equal(await page.locator('#test-background-reminder').isDisabled(),true);
  await page.evaluate(async()=>{
   const original=window._reminderOriginals;
   for(const [object,key,descriptor] of [[window,'Notification',original.notification],[window,'PushManager',original.push],[navigator,'serviceWorker',original.worker]]){if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key];}
   delete window._reminderOriginals;delete window._reminderSubscription;
   await refreshBackgroundReminderStatus();
  });
  console.log(engine.name()+': reminder reconnect, missing subscription, expired endpoint and device turn-off passed');
  await page.locator('[data-settings-panel="reminders"] [data-settings-back]').click();
  await page.locator('[data-settings-open="account"]').click();
  await assertSettingsOnly();
  for(const selector of ['[data-settings-panel="account"] .profile-card','#sync-now','#logout-btn']){
    assert.ok(await page.locator(selector).count()>=1,selector+' exists in the document');
    assert.equal(await page.locator(selector).first().isVisible(),true,selector+' visible in Account & Sync');
  }
  await page.locator('[data-settings-panel="account"] [data-settings-back]').click();
  await page.waitForFunction(()=>!cloudSyncInFlight&&!cloudSaveInFlight&&!localSaveInFlight);
  const loadsBeforeTrackSync=loads;
  await page.locator('#settings-sync-shortcut').click();
  for(let attempt=0;attempt<100&&loads===loadsBeforeTrackSync;attempt++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(loads>loadsBeforeTrackSync,'Track Sync performs a cloud library load');
  await page.waitForFunction(()=>!document.querySelector('#sync-now').disabled&&document.querySelector('#sync-status').textContent.includes('Synced.'),null,{timeout:10000});
  await assertSettingsOnly();
  await page.locator('[data-tab="search"]').click();
  assert.equal(await page.locator('#discovery-view').isVisible(),true,'Search opens after leaving Settings');
  assert.equal(await page.locator('.top-nav h1').isVisible(),false,'Search has its own heading without the app title');
  assert.equal(await page.locator('.top-nav .search-box').isVisible(),false);
  assert.equal(await page.locator('.stats-row').isVisible(),false);
  await page.locator('[data-tab="settings"]').click();
  await assertSettingsOnly();
  await page.locator('[data-tab="library"]').click();
  await page.waitForFunction(()=>document.querySelector('#settings-view').classList.contains('hidden')&&!document.querySelector('#library-view').classList.contains('hidden'));
  assert.equal(await page.locator('.top-nav .search-box').isVisible(),true,'Library search returns on Library');
  assert.equal(await page.locator('.stats-row').isVisible(),true,'Tracking totals return on Library');
  assert.equal(await page.locator('.top-nav h1').isVisible(),true,'App title returns on Library home');
  for(const selector of ['.profile-card','#sync-now','#logout-btn','#appearance-mode','#background-reminder-status','#enable-background-reminders']){
    assert.equal(await page.locator(selector).first().isVisible(),false,selector+' must not be visible in Library');
  }
  // Force a pending memory change: refresh must save it before navigation.
  phase='recurring weekly schedule';
  await page.evaluate(async()=>{
   const item=mediaItems.find(row=>row.id==='show'),air=Date.now()-3600000;
   const episodes=[-7,0,7].map((days,index)=>({season:2,number:index+1,raw:new Date(air+days*86400000).toISOString()}));
   item.recurringWeeklySchedule=weeklyReleasePattern(episodes);item.scheduledEpisodeReleases=episodes.slice(1);
   await persistLibrary(mediaItems);render();
  });
  const recurring=page.locator('#recurring-weekly-dashboard');
  assert.equal(await recurring.isVisible(),true);
  assert.equal(await recurring.evaluate(root=>root.parentElement.id==='library-view'&&!root.previousElementSibling),true,'dropdown is first on Library home');
  assert.equal(await recurring.locator('details').getAttribute('open'),null,'schedule starts collapsed');
  assert.equal(await recurring.locator('[data-recurring-open="show"]').isVisible(),false);
  await recurring.locator('summary').focus();await page.keyboard.press('Enter');
  assert.equal(await recurring.locator('[data-recurring-open="show"]').isVisible(),true,'schedule supports keyboard expansion');
  assert.deepEqual(await recurring.locator('[data-recurring-day]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.recurringDay))),[1,2,3,4,5,6,0]);
  assert.equal(await recurring.locator('[data-recurring-open="show"]').count(),1);
  assert.match(await recurring.textContent(),/S2 E2/);
  const recurringMarker=()=>recurring.locator('[data-recurring-open="show"] .release-progress-dot');
  assert.equal(await recurringMarker().getAttribute('data-behind-level'),'red');
  const savedMarkerProgress=await page.evaluate(()=>structuredClone(mediaItems.find(item=>item.id==='show').watchedEpisodes));
  for(const behind of [0,1,2,3]){
   await page.evaluate(behind=>{
    const item=mediaItems.find(item=>item.id==='show'),releases=releasedEpisodeMap(item);
    const episodes=Object.entries(releases).flatMap(([season,numbers])=>numbers.map(episode=>[season,episode]));
    item.watchedEpisodes={};
    for(const [season,episode] of episodes.slice(behind))(item.watchedEpisodes[season]||=[]).push(episode);
    render();
   },behind);
   if(!behind){
    assert.equal(await recurringMarker().getAttribute('data-behind-level'),'green','caught-up shows are neon green');
    assert.equal(await recurringMarker().evaluate(dot=>getComputedStyle(dot).backgroundColor),'rgb(57, 255, 20)');
   }
   else{
    assert.equal(await recurringMarker().getAttribute('data-behind-level'),behind>2?'red':'amber');
    assert.equal(await recurringMarker().textContent(),'','only the coloured marker is visible, not a count');
    assert.equal(await recurringMarker().getAttribute('role'),'img');
   }
  }
  const savedGraceSchedule=await page.evaluate(()=>{const item=mediaItems.find(item=>item.id==='show');return {recurring:structuredClone(item.recurringWeeklySchedule),scheduled:structuredClone(item.scheduledEpisodeReleases)};});
  await page.evaluate(()=>{
   const item=mediaItems.find(item=>item.id==='show'),releases=releasedEpisodeMap(item);
   item.watchedEpisodes=Object.fromEntries(Object.entries(releases).map(([season,episodes])=>[season,[...episodes]]));
   item.watchedEpisodes[2]=item.watchedEpisodes[2].filter(episode=>episode!==2);
   const raw=new Date(Date.now()-86400000+3000).toISOString();
   for(const rows of [item.recurringWeeklySchedule.episodes,item.scheduledEpisodeReleases])for(const episode of rows)if(episode.season===2&&episode.number===2)episode.raw=raw;
   render();
  });
  assert.equal(await recurringMarker().getAttribute('data-behind-level'),'green','new episodes stay green during their grace period');
  await page.waitForFunction(()=>document.querySelector('#recurring-weekly-dashboard [data-recurring-open="show"] .release-progress-dot')?.dataset.behindLevel==='amber');
  assert.equal(await recurringMarker().textContent(),'','automatic expiry still shows colour only');
  await page.evaluate(({progress,schedule})=>{
   const item=mediaItems.find(item=>item.id==='show');item.watchedEpisodes=progress;
   item.recurringWeeklySchedule=schedule.recurring;item.scheduledEpisodeReleases=schedule.scheduled;render();
  },{progress:savedMarkerProgress,schedule:savedGraceSchedule});
  const scheduleText=await recurring.textContent();
  const calendarDropdown=page.locator('#library-dashboard>details');
  assert.equal(await calendarDropdown.getAttribute('open'),null,'Your schedule starts collapsed');
  assert.equal(await page.locator('#library-view').evaluate(home=>{
   const recurring=home.querySelector('#recurring-weekly-dashboard'),categories=home.querySelector('#media-list'),calendar=home.querySelector('#library-dashboard');
   return Boolean(recurring.compareDocumentPosition(categories)&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(categories.compareDocumentPosition(calendar)&Node.DOCUMENT_POSITION_FOLLOWING);
  }),true,'home orders recurring shows, Movies/Series, then Your schedule');
  await calendarDropdown.locator(':scope>summary').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-calendar-range="today"]').isVisible(),true);
  await page.locator('[data-calendar-range="today"]').click();
  assert.equal(await calendarDropdown.getAttribute('open'),'','range changes keep Your schedule expanded');
  assert.equal(await recurring.textContent(),scheduleText,'calendar range cannot change the recurring schedule');
  await page.locator('[data-gallery-category="Series"]').click();
  assert.equal(await page.locator('.top-nav h1').isVisible(),false,'Series shows its category heading without the app title');
  await page.locator('[data-filter="Watched"]').click();
  await page.locator('#sort-mode').selectOption('platform');
  await page.locator('#search-input').fill('No matching title at all');
  await page.waitForFunction(()=>searchQuery==='No matching title at all'&&document.querySelector('.gallery-empty'));
  assert.equal(await recurring.isVisible(),false,'dropdown is only shown on Library home');
  assert.equal(await recurring.textContent(),scheduleText,'Library status, search and sorting cannot remove recurring shows');
  await page.locator('#search-input').fill('');
  await page.waitForFunction(()=>searchQuery==='');
  await page.locator('[data-filter="All"]').click();await page.locator('#sort-mode').selectOption('current');
  await page.locator('[data-gallery-back]').click();
  assert.equal(await calendarDropdown.getAttribute('open'),'','returning home preserves Your schedule expansion');
  assert.equal(await recurring.isVisible(),true);
  assert.equal(await recurring.locator('[data-recurring-open="show"]').isVisible(),true,'returning home preserves the expanded dropdown');
  await page.evaluate(()=>{const item=mediaItems.find(row=>row.id==='show');item.platform+=' test';render();item.platform=item.platform.slice(0,-5);render();});
  assert.equal(await recurring.locator('[data-recurring-open="show"]').isVisible(),true,'schedule updates preserve expansion');
  await recurring.locator('summary').click();
  assert.equal(await recurring.locator('[data-recurring-open="show"]').isVisible(),false);
  await recurring.locator('summary').click();
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   assert.equal(await recurring.evaluate(root=>root.scrollWidth<=root.clientWidth),true,'recurring schedule fits the viewport');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:390,height:844});
  if(process.env.BROWSER_SCREENSHOT_DIR)await recurring.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-recurring.png')});
  await recurring.locator('[data-recurring-open="show"]').click();
  assert.equal(await page.getByRole('tab',{name:'Episodes',exact:true}).getAttribute('aria-selected'),'true','recurring shows open the new Episodes page');
  assert.equal(await page.locator('#episode-tracker-modal').isVisible(),false,'old tracker stays closed');
  await page.getByRole('tab',{name:'Details',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-gallery-details]').textContent.includes('official series description'));
  await page.locator('[data-gallery-close]').click();
  await page.waitForFunction(()=>document.activeElement?.matches('#recurring-weekly-dashboard [data-recurring-open="show"]'));
  await page.locator('[data-calendar-range="upcoming"]').click();
  assert.equal(await page.locator('#library-dashboard [data-dashboard-open="show"] .release-progress-dot').first().getAttribute('data-behind-level'),'red','release calendar uses the same marker rules');
  await page.locator('#library-dashboard [data-dashboard-open="show"]').first().click();
  assert.equal(await page.getByRole('tab',{name:'Episodes',exact:true}).getAttribute('aria-selected'),'true','upcoming releases open the new Episodes page');
  assert.equal(await page.locator('#episode-tracker-modal').isVisible(),false);
  await page.locator('[data-gallery-watch-next]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  assert.deepEqual(items.find(row=>row.id==='show').watchedEpisodes,{'1':[1,2,3]});
  for(const season of [1,2]){
   await page.locator('[data-gallery-season="'+season+'"]').click();await page.waitForFunction(()=>!episodeLogBusy.size&&!cloudSaveInFlight);
  }
  assert.equal(await page.locator('[data-gallery-watch-next]').count(),0,'unreleased episodes are never offered by Watch next');
  assert.equal(await page.locator('.gallery-caught-up').textContent(),'All released episodes watched');
  await page.locator('[data-gallery-close]').click();
  assert.equal(await recurringMarker().getAttribute('data-behind-level'),'green','watching released episodes makes the recurring marker green');
  assert.equal(await page.locator('#library-dashboard [data-dashboard-open="show"] .release-progress-dot').first().getAttribute('data-behind-level'),'green','watching released episodes makes the release-calendar marker green');
  phase='duplicate prevention';
  await page.locator('[data-tab="search"]').click();await page.locator('[data-discovery-filter="Series"]').click();
  await page.locator('#discovery-query').fill('Browser Test Series');
  await page.locator('#discovery-library-results [data-library-result="show"]').waitFor();
  assert.equal(await page.locator('#discovery-results [data-discovery-add]').count(),0,'a shared TVMaze ID is saved even when the catalogue IMDb ID differs');
  await page.locator('[data-tab="library"]').click();
  const beforeDuplicate=await page.evaluate(()=>mediaItems.length),beforeDuplicateSaves=saves;
  await page.evaluate(()=>{openAdd();titleInput.value='Test Series';typeSelect.value='Series';$('tvmaze-id').value='12';$('imdb-id').value='tt7654321';$('release-year').value='2021';});
  await page.locator('#save-btn').click();await page.locator('#duplicate-warning').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>mediaItems.length),beforeDuplicate);assert.equal(saves,beforeDuplicateSaves,'duplicate form submissions do not write to the cloud');
  await page.locator('#open-duplicate').click();await page.locator('.gallery-detail[open]').waitFor();
  await page.locator('[data-gallery-close]').click();
  phase='refresh';
  const refreshItemId=await page.evaluate(()=>{mediaItems[0].platform='Saved before refresh';return mediaItems[0].id;});
  const before=loads;const reload=page.waitForEvent('load');await page.locator('#refresh-app').click();await reload;
  // The same browser context retains the PIN session across a document reload.
  // Wait for session restoration to finish before inspecting or interacting with
  // the login form; it is briefly visible while restorePinSession is still running.
  await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'),{timeout:10000});
  await page.waitForFunction(id=>mediaItems.find(item=>item.id===id)?.platform==='Saved before refresh',refreshItemId,{timeout:10000});
  assert.equal(items.find(item=>item.id===refreshItemId)?.platform,'Saved before refresh');
  assert.equal(await page.locator('#recurring-weekly-dashboard [data-recurring-open="show"]').count(),1,'recurring membership survives reload');
  assert.equal(await page.locator('#recurring-weekly-dashboard details').getAttribute('open'),null,'reload starts with a compact dropdown');
  assert.equal(await page.locator('#library-dashboard>details').getAttribute('open'),null,'Your schedule also starts collapsed after reload');
  assert.ok(loads>before);
  // A failed cloud save must leave the current page and edit intact.
  phase='failed save';
  failSave=true;const failedLoads=loads;
  await page.evaluate(id=>{mediaItems.find(item=>item.id===id).platform='Keep this change';},refreshItemId);await page.locator('#refresh-app').click();
  await page.waitForFunction(()=>document.querySelector('#app-toast').textContent.includes('Refresh paused'));
  assert.equal(loads,failedLoads);assert.equal(await page.evaluate(id=>mediaItems.find(item=>item.id===id)?.platform,refreshItemId),'Keep this change');
  assert.ok(saves>=4);assert.deepEqual(errors,[]);
  console.log(`${engine.name()}: visual search, filters, descriptions, duplicate badges, add/edit, episode mark/undo, unreleased guard and refresh persistence passed`);
 }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
