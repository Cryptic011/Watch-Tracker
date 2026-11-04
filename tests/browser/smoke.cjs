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
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',timezoneId:'Europe/London',locale:'en-GB'});
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
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/schedule/web'){
    const rows=await page.evaluate(()=>mediaItems.filter(item=>item.tvmazeShowId).flatMap(item=>(item.scheduledEpisodeReleases||[]).map(ep=>({season:ep.season,number:ep.number,airdate:String(ep.raw||'').slice(0,10),airtime:/^\d{4}-\d{2}-\d{2}$/.test(ep.raw)?'':'08:00',airstamp:ep.raw,_embedded:{show:{id:Number(item.tvmazeShowId),externals:{imdb:item.imdbId||''},webChannel:{name:item.platform||'Test streaming',country:{code:'GB'}}}}}))));
    return route.fulfill({headers,json:rows});
   }
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/shows/91405')return route.fulfill({headers,json:{id:91405,name:'NCIS: New York',premiered:'2026-10-06',status:'Running',externals:{imdb:'tt41814911'},summary:'<p>A team investigates crimes affecting a major city and port.</p>'}});
   if(url.hostname==='api.tvmaze.com'&&/^\/shows\/91405\/(?:episodes|seasons)$/.test(url.pathname))return route.fulfill({headers,json:[]});
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/shows/12')return route.fulfill({headers,json:{id:12,name:'Test Series',premiered:'2020-01-01',externals:{imdb:'tt1234568'},image:{original:'https://static.tvmaze.com/series-poster.jpg'},summary:'<p>An official series description &amp; a second detail.</p>',genres:['Drama','Action'],status:'Running',rating:{average:8.4},runtime:42,language:'English'}});
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/shows/13')return route.fulfill({headers,json:{id:13,name:'Later poster',image:{original:'https://static.tvmaze.com/later-poster.jpg'}}});
   if(url.hostname==='api.tvmaze.com'&&url.pathname==='/shows/12/episodes')return route.fulfill({headers,json:[
    {season:1,number:1,summary:'<p>The team investigates a difficult case.</p>',image:{original:'https://static.tvmaze.com/episode-one.jpg'}},
    {season:1,number:2,name:'Crossing Lines',image:null},
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
     if(body.tvmazeShowId==='91405')return route.fulfill({headers,json:{ok:true,details:{state:'unavailable',sources:[]}}});
    const series=body.type==='Series',id=series?'tt1234568':'tt1234567',url='https://www.imdb.com/title/'+id+'/';
     data={ok:true,details:{state:'ready',synopsisVersion:7,synopsisScope:series?'series':'film',description:series?'An official series description & a second detail.':'A detective uncovers a mystery in a quiet coastal town. '.repeat(8),year:'2020',genres:['Drama','Action'],runtime:series?42:120,rating:8.4,ratingSource:series?'TVMaze':'IMDb',source:series?'TVMaze':'IMDb',sources:[{name:series?'TVMaze':'IMDb',url:series?'https://www.tvmaze.com/shows/12':url}],imdbUrl:url}};
    }
    if(body.action==='save'){
     if(failSave)return route.fulfill({status:503,headers,json:{error:'Offline'}});
     if(body.expectedRevision!==revision)return route.fulfill({status:409,headers,json:{error:'Library changed',code:'revision_conflict',items,revision}});
     const deleted=new Set((body.changes||[]).filter(change=>change.delete&&!body.confirmedDeletes?.includes(change.id)).map(change=>change.id));
     const removed=items.filter(item=>deleted.has(String(item.id))).length;
     if((removed>=5&&removed*2>=items.length)||(items.length>1&&removed===items.length))return route.fulfill({status:409,headers,json:{error:'Unexpected library removal blocked',code:'library_safety_block',items,revision}});
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
  phase='Home, dedicated Shows and Films, and Calendar';
  const category=type=>page.locator('[data-gallery-category="'+type+'"]');
  const openCategory=async type=>{await page.locator('[data-tab="collection"]').click();await category(type).click();};
  const openSavedShows=async()=>{await openCategory('Series');await page.locator('[data-saved-shows]').click();};
  assert.deepEqual(await page.locator('.bottom-tabs .tab-btn span').allTextContents(),['Home','Library','Calendar','Settings']);
  assert.equal(await page.getByRole('heading',{name:'Home',exact:true}).isVisible(),true);
  assert.equal(await page.locator('#home-view').isVisible(),true);
  assert.equal(await page.locator('#library-dashboard').isVisible(),false);
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await page.locator('.gallery-grid').count(),0,'Library has no duplicate title grid');
  assert.equal(await page.locator('#list-toolbar').isVisible(),false,'Filters belong to the dedicated pages');
  assert.equal(await page.locator('[data-home-section="recurring"]').isVisible(),true);
  assert.equal(await page.locator('#library-shows').isVisible(),false,'Library landing has no Shows dashboard');
  assert.equal(await page.locator('.library-page-links').isVisible(),true);
  const dock=await page.locator('#library-entry').boundingBox(),mainDock=await page.locator('.bottom-tabs').boundingBox();
  assert.ok(dock.height<=60&&dock.y+dock.height<mainDock.y,'The Shows and Films dock sits above the main dock');
  assert.equal(await page.locator('#library-entry img').count(),0);
  await category('Film').click();
  assert.match(new URL(page.url()).hash,/^#\/collection\/movies/);
  assert.equal(await page.getByRole('heading',{name:'Films',exact:true}).isVisible(),true);
  assert.equal(await page.locator('[data-filter="Recent"]').evaluate(node=>node.classList.contains('active')),true);
  assert.equal(await page.locator('#library-entry').isVisible(),true,'The type dock stays available within Library');
  assert.equal(await page.locator('#library-shows').isVisible(),false,'Films has its own page');
  assert.equal(await page.locator('[data-home-section="recurring"]').isVisible(),false);
  await page.locator('[data-library-back]').click();
  assert.equal(await category('Film').evaluate(node=>document.activeElement===node),true);
  await page.locator('[data-tab="library"]').click();
  await page.locator('[data-tab="calendar"]').click();
  assert.equal(await page.locator('#library-dashboard').isVisible(),true);
  assert.equal(await page.locator('[data-home-section="recurring"]').isVisible(),false);
  for(const selector of ['#add-btn','.top-nav .search-box'])assert.equal(await page.locator(selector).isVisible(),false,'Calendar has no Search controls');
  await openCategory('Series');
  assert.match(new URL(page.url()).hash,/^#\/collection\/series/);
  assert.equal(await page.getByRole('heading',{name:'Shows',exact:true}).isVisible(),true);
  assert.equal(await page.locator('.gallery-grid').count(),0,'Shows overview has no second poster grid');
  await page.locator('[data-saved-shows]').click();
  assert.match(new URL(page.url()).hash,/series\/saved/);
  assert.equal(await page.locator('.gallery-grid').count(),1);
  assert.equal(await page.locator('.gallery-empty').isVisible(),true,'Saved shows displays its empty state');
  assert.equal(await page.locator('#library-shows').isVisible(),false);
  await page.getByRole('button',{name:'Back to Shows',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Show status'}).inputValue(),'All');
  assert.equal(await page.locator('.shows-controls').getByRole('button').count(),1,'Shows has only its filter button in the toolbar');
  for(const section of ['Watchlist','Episode Queue','Upcoming Episodes','Upcoming Seasons'])assert.equal(await page.locator('[data-shows-section="'+section+'"]').count(),1);
  const showsBefore=await page.evaluate(()=>{
   const original=mediaItems,now=Date.now();
   mediaItems=[{id:'shows-layout',title:'Test Series',type:'Series',status:'Watching',tvmazeShowId:'12',imdbId:'tt1234568',releaseYear:'2020',episodeScheduleVerified:true,metadataUpdatedAt:new Date(now).toISOString(),releasedEpisodes:{1:[1]},watchedEpisodes:{},episodeCounts:{1:2},airingSeason:1,nextEpisodeNum:2,nextEpisodeDate:new Date(now+2*86400000).toISOString(),nextSeasonNum:2,nextSeasonDate:new Date(now+70*86400000).toISOString(),scheduledEpisodeReleases:[{season:1,number:2,raw:new Date(now+2*86400000).toISOString(),title:'Upcoming test'}]}];render();return original;
  });
  try{
   for(const section of ['Watchlist','Episode Queue','Upcoming Episodes','Upcoming Seasons'])assert.equal(await page.locator('[data-shows-section="'+section+'"] [data-shows-item="shows-layout"]').count(),1);
   assert.ok((await page.locator('[data-shows-section="Episode Queue"] .shows-poster-card').boundingBox()).width<128,'Shows posters are compact at 390px');
   await page.locator('[data-shows-section="Episode Queue"] [data-shows-item]').click();await page.locator('.gallery-detail[open]').waitFor();await page.locator('[data-gallery-close]').click();
   await page.locator('[data-shows-status]').selectOption('Planned');assert.equal(await page.locator('.shows-poster-card').count(),0);
   await page.locator('[data-shows-status]').selectOption('All');
   for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Shows fits '+width+'px');}
   await page.setViewportSize({width:390,height:844});
  }finally{await page.evaluate(items=>{mediaItems=items;render();},showsBefore);}
  const gmt=await page.evaluate(()=>{
   const item={id:'marshals-gmt',title:'Marshals',type:'Series',imdbId:'tt36849871',tvmazeShowId:'84526',platform:'Paramount+',airingSeason:2,nextEpisodeNum:5,nextEpisodeDate:'2026-11-02T01:30:00Z',scheduledEpisodeReleases:[{season:2,number:5,raw:'2026-11-02T01:30:00Z'}]};
   const result=calendarEvents([item],new Date('2026-11-02T00:00:00Z'),1).events[0];
   return {summer:formatLocalDateTime('2026-06-01T08:00:00Z'),clock:DASHBOARD_TIME_FORMATTER.format(result.date),date:result.date.toISOString(),card:upcomingSortInfo(item,Date.parse('2026-11-01T00:00:00Z')).time,zone:DEVICE_TIME_ZONE};
  });
  assert.equal(gmt.summer,'01/06/2026, 08:00','British Summer Time does not shift the GMT clock');
  assert.equal(gmt.clock,'01:30');assert.equal(gmt.date,'2026-11-02T01:30:00.000Z');
  assert.equal(gmt.card,Date.parse(gmt.date),'title cards and the calendar retain the supplied Marshals airtime');
  assert.equal(gmt.zone,'UTC');
  await page.locator('.bottom-tabs [data-tab="settings"]').click();
  await page.locator('[data-settings-open="general"]').click();
  assert.equal(await page.locator('#release-viewing-region').count(),0,'General has no region or timezone selector');
  if(process.env.BROWSER_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-gmt-settings.png')});
  await page.locator('.bottom-tabs [data-tab="collection"]').click();
  assert.equal(changelogRequests,0,'startup does not request workflow history');
  await page.locator('[data-tab="calendar"]').click();
  const agendaProof=await page.evaluate(()=>{
   const saved=mediaItems,range=selectedCalendarRange,now=new Date(),today=new Date(now);today.setUTCHours(0,0,0,0);
   const day=offset=>new Date(today.getTime()+offset*86400000).toISOString().slice(0,10);
   const monday=new Date(today);monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
   try{
    selectedCalendarRange='upcoming';
    mediaItems=[{id:'agenda-near',title:'Poster release',type:'Film',filmReleaseDate:day(2),posterUrl:'https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg'},
      {id:'agenda-last',title:'Last included date',type:'Film',filmReleaseDate:day(13)},
      {id:'agenda-outside',title:'Outside fourteen days',type:'Film',filmReleaseDate:day(14)},
      {id:'agenda-old',title:'Last week',type:'Film',filmReleaseDate:new Date(monday.getTime()-86400000).toISOString()},
      {id:'agenda-prior',title:'Released earlier today',type:'Film',filmReleaseDate:today.toISOString()}];
    mediaItems=mediaItems.map(item=>({...item,filmReleaseDate:item.filmReleaseDate.length===10?item.filmReleaseDate+'T18:00:00Z':item.filmReleaseDate,filmReleaseSource:'Official test listing',platform:'Test streaming'}));
    renderDashboard();
    const root=document.querySelector('#library-dashboard'),card=root.querySelector('.release-card').getBoundingClientRect(),poster=root.querySelector('.calendar-poster').getBoundingClientRect();
    return {posterAligned:Math.abs(card.left-poster.left)<1&&Math.abs(card.top-poster.top)<1&&Math.abs(poster.height/poster.width-1.5)<.02,posterWidth:poster.width,period:root.querySelector('.calendar-period').textContent,controls:root.querySelectorAll('[data-calendar-range],.calendar-range').length,
      days:root.querySelectorAll('.release-day').length,posters:root.querySelectorAll('.calendar-poster img').length,
      future:[...root.querySelectorAll('.release-week-list [data-dashboard-open]')].map(node=>node.dataset.dashboardOpen),
      prior:[...root.querySelectorAll('.prior-releases [data-dashboard-open]')].map(node=>node.dataset.dashboardOpen),
      priorLast:root.querySelector('.prior-releases').nextElementSibling===null,
      fits:root.scrollWidth<=root.clientWidth};
   }finally{mediaItems=saved;selectedCalendarRange=range;renderDashboard();}
  });
  assert.deepEqual(agendaProof,{posterAligned:true,posterWidth:62,period:'Next 14 days · GMT',controls:0,days:3,posters:3,future:['agenda-prior','agenda-near','agenda-last'],prior:[],priorLast:true,fits:true},'calendar retains today’s elapsed releases alongside the next fourteen days and keeps Prior Releases separate');
  phase='corrected episode calendar';
  const correctedCalendar=await page.evaluate(()=>{
   const saved=mediaItems;
   try{
    const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10),raw=day+'T02:00:00Z',old=day+'T02:01:00Z';
    mediaItems=[{id:'corrected-cia',title:'CIA',type:'Series',platform:'CBS',airingSeason:2,nextEpisodeNum:6,nextEpisodeDate:old,nextEpisodeTitle:'Legacy',scheduledEpisodeReleases:[{season:2,number:6,raw,title:'Legacy'}],recurringWeeklySchedule:{episodes:[{season:2,number:6,raw:old}]}}];
    renderDashboard();
    return ['#library-dashboard','#recurring-weekly-dashboard'].map(id=>{switchTab(id.includes('recurring')?'collection':'calendar');renderDashboard();return {count:document.querySelector(id).querySelectorAll('.release-card').length,copy:document.querySelector(id).querySelector('.release-card-copy').textContent};});
   }finally{mediaItems=saved;switchTab('calendar');renderDashboard();}
  });
  for(const calendar of correctedCalendar){assert.equal(calendar.count,1,'a revised episode time replaces its stale recurring snapshot');assert.match(calendar.copy,/S2 E6 · Legacy/);assert.match(calendar.copy,/02:00/);assert.doesNotMatch(calendar.copy,/02:01/);}
  phase='calendar poster loading';
  const beforePosterCheck=await page.evaluate(()=>{
   const original=mediaItems;
   mediaItems=Array.from({length:8},(_,index)=>({id:'poster-proof-'+index,type:'Series',title:index===0?'Test Series':index===7?'Later poster':'Saved poster '+index,
    ...(index===0?{tvmazeShowId:'12',imdbId:'tt1234568'}:index===7?{tvmazeShowId:'13'}:{posterUrl:'https://static.tvmaze.com/saved-poster-'+index+'.jpg'}),
    platform:'Poster test network',scheduledEpisodeReleases:[{season:1,number:1,raw:new Date(Date.now()+(index+1)*86400000).toISOString()}]}));
   WatchLogGallery.clearArtwork();render();return original;
  });
  try{
   for(const root of ['#library-dashboard','#recurring-weekly-dashboard']){
    await page.locator('[data-tab="'+(root.includes('recurring')?'collection':'calendar')+'"]').click();
    if(root.includes('recurring'))await page.evaluate(()=>{document.querySelector('[data-home-section="recurring"]').open=true;});
    for(const id of ['poster-proof-0','poster-proof-3','poster-proof-7']){
     const poster=page.locator(`${root} .release-card[data-${root.includes('recurring')?'recurring':'dashboard'}-open="${id}"] .calendar-poster img`);
     await poster.locator('..').scrollIntoViewIfNeeded();
     await poster.evaluate(img=>new Promise((resolve,reject)=>{
      const start=Date.now();const check=()=>{if(!img.hidden&&img.complete&&img.naturalWidth>0)return resolve();if(Date.now()-start>8000)return reject(Error('Calendar poster never became visible: '+img.dataset.art));setTimeout(check,25);};check();
     }));
     assert.equal(await poster.isVisible(),true,'calendar and recurring posters load, including cards reached by scrolling');
    }
   }
   assert.equal(await page.locator('#library-dashboard [data-dashboard-open="poster-proof-0"] img').getAttribute('src'),'https://static.tvmaze.com/series-poster.jpg','provider identity supplies a show cover without a saved poster');
   const panel=page.locator('[data-home-section="recurring"]');
   await panel.locator('summary').first().click();await panel.locator('summary').first().click();
   await page.locator('#recurring-weekly-dashboard [data-recurring-open="poster-proof-7"] .calendar-poster').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('#recurring-weekly-dashboard [data-recurring-open="poster-proof-7"] img').isVisible(),true,'posters survive collapsing and reopening their calendar');
  }finally{await page.evaluate(original=>{mediaItems=original;switchTab('calendar');render();window.scrollTo(0,0);},beforePosterCheck);}
  const pendingSchedule=await page.evaluate(()=>{
   const saved=mediaItems,view=selectedScheduleView,range=selectedCalendarRange;
   try{
    mediaItems=[{id:'regional-pending',title:'Chicago Fire pending streaming',type:'Series',tvmazeShowId:'999999',platform:'Saved service',scheduledEpisodeReleases:[{season:15,number:3,raw:new Date(Date.now()+2*86400000).toISOString().slice(0,10)}]}];
    mediaItems.push({id:'four-hour',title:'Timed episode',type:'Series',platform:'Saved service',scheduledEpisodeReleases:[{season:1,number:2,raw:new Date(Date.now()+2*86400000).toISOString()}]});
    selectedScheduleView='recurring';switchTab('collection');renderDashboard();
    const recurring=document.querySelector('#recurring-weekly-dashboard'),name=recurring.querySelector('.release-pending')?.textContent,
     timedRelease=recurring.querySelector('[data-recurring-open="four-hour"]')?.textContent,
     recurringText=recurring.textContent,
     emptyHeights=[...recurring.querySelectorAll('.recurring-weekday:has(.release-empty)')].map(node=>node.getBoundingClientRect().height);
    selectedScheduleView='calendar';selectedCalendarRange='upcoming';switchTab('calendar');renderDashboard();
    const calendar=document.querySelector('#library-dashboard');
    return {name,timedRelease,recurringText,calendarText:calendar.textContent,emptyHeights,calendar:calendar.querySelector('.release-pending')?.textContent,undated:calendar.querySelectorAll('[data-dashboard-section="unknown"]').length};
   }finally{mediaItems=saved;selectedScheduleView=view;selectedCalendarRange=range;renderDashboard();}
  });
  assert.match(pendingSchedule.timedRelease,/Timed episode/,'timed releases remain listed');
  assert.doesNotMatch(pendingSchedule.recurringText,/estimated|airtime/i,'recurring view omits the removed wording');
  assert.doesNotMatch(pendingSchedule.calendarText,/estimated|airtime/i,'calendar omits the removed wording');
  assert.equal(pendingSchedule.name,undefined,'unconfirmed streaming does not add extra calendar panels');
  assert.equal(pendingSchedule.calendar,undefined,'the calendar contains only confirmed release cards');
  assert.equal(pendingSchedule.undated,0);assert.ok(pendingSchedule.emptyHeights.every(height=>height<65),'empty weekdays stay compact');
  assert.equal(await page.locator('.changelog-entry').count(),0,'startup does not construct the full hidden changelog');
  assert.equal(await page.locator('#library-entry').isVisible(),false,'Calendar hides Library navigation');
  await openCategory('Film');
  assert.equal(await page.evaluate(()=>{const node=mediaList.querySelector('.gallery-grid');render();return Boolean(node)&&node===mediaList.querySelector('.gallery-grid');}),true,'unchanged Films render retains its title grid');
  assert.equal(await page.locator('#media-list>.gallery-empty').count(),1,'empty Films shows one message');
  assert.equal(await page.locator('#empty-state').isVisible(),false,'no duplicate empty state below the grid');
  await page.locator('[data-tab="collection"]').click();
  // Exercise the actual weekly schedule DOM, not just its sorting helper.
  // Date order deliberately conflicts with local clock order (17:00 this
  // week vs 01:00 next week); an undated old show must not appear at all.
  phase='weekly schedule';
  const weeklyScreen=await page.evaluate(async()=>{
   const original=mediaItems,previousSchedule=selectedScheduleView,now=new Date(),target=new Date(now);
   target.setHours(12,0,0,0);
   target.setDate(target.getDate()+1);
   const day=target.getDay();
   const stamp=(weeks,hour)=>{
    const date=new Date(target);date.setDate(date.getDate()+weeks*7);date.setHours(hour,0,0,0);return date.toISOString();
   };
   const dateOnly=weeks=>{
    const date=new Date(target);date.setDate(date.getDate()+weeks*7);
    return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
   };
   let showSerial=90000;
   const make=(id,title,weeks,hour)=>({id,title,tvmazeShowId:String(++showSerial),platform:'Verified network',type:'Series',status:'Watching',
    scheduledEpisodeReleases:weeks.map((week,i)=>({season:1,number:i+1,raw:hour===null?dateOnly(week):stamp(week,hour)}))});
   const evening=make('later-clock','17:00 programme',[-2,-1,0],17);
   const overnight=make('earlier-clock','01:00 programme',[-4,-3,1],1);
   const untimed=make('date-only','Time unknown programme',[-2,-1,0],null);
   // On Thursday, target is next Thursday and target-1 week is still today.
   // Keep this fixture genuinely expired on every weekday, beyond the 24h grace.
   const expired=make('expired','Unannounced returning programme',[-4,-3,-2],21);
   expired.nextEpisodeNum=4;expired.nextEpisodeDate='';
   const distant=make('distant-return','The Rookie',[8,9],20);
   const cachedReturn={...make('cached-return','The Rookie North',[8,9],21)};
   cachedReturn.recurringWeeklySchedule=weeklyReleasePattern(cachedReturn.scheduledEpisodeReleases);
   cachedReturn.scheduledEpisodeReleases=[];
   try{
    selectedScheduleView="recurring";mediaItems=[evening,overnight,untimed,expired,distant,cachedReturn,{...evening,id:'duplicate-clock',imdbId:'tt1234999'}];
    await WatchLogRegionalReleases.refresh(mediaItems,{country:releaseViewingCountry()},async()=>({ok:true,json:async()=>mediaItems.flatMap(item=>(item.scheduledEpisodeReleases?.length?item.scheduledEpisodeReleases:item.recurringWeeklySchedule?.episodes||[]).map(ep=>({season:ep.season,number:ep.number,airdate:String(ep.raw).slice(0,10),airtime:/^\d{4}-\d{2}-\d{2}$/.test(ep.raw)?'':'08:00',airstamp:ep.raw,_embedded:{show:{id:Number(item.tvmazeShowId),webChannel:{name:item.platform,country:{code:releaseViewingCountry()}}}}})))}));
    renderRecurringWeeklySchedule();
    const area=document.querySelector('#recurring-weekly-dashboard .release-week-list');
    return {cards:[...area.querySelectorAll('[data-recurring-open]')].map(node=>({
     title:node.querySelector('.release-show-title span')?.textContent,
     time:node.querySelector('.release-time')?.textContent,date:node.dataset.releaseAt
    })),posters:area.querySelectorAll('.calendar-poster img').length,legacyDays:document.querySelectorAll('#recurring-weekly-dashboard [data-recurring-day]').length,
    unannouncedPresent:document.querySelector('#recurring-weekly-dashboard')?.textContent.includes('Unannounced returning programme'),
    distantReturns:document.querySelectorAll('#recurring-weekly-dashboard [data-recurring-open="distant-return"],#recurring-weekly-dashboard [data-recurring-open="cached-return"]').length,
    counters:document.querySelectorAll('#recurring-weekly-dashboard .weekly-total').length,
    noHorizontalOverflow:document.documentElement.scrollWidth<=window.innerWidth};
   }finally{mediaItems=original;selectedScheduleView=previousSchedule;renderRecurringWeeklySchedule();}
  });
  assert.deepEqual(weeklyScreen.cards.map(card=>card.title),['17:00 programme','01:00 programme'],'recurring cards follow actual release dates across both weeks');
  assert.ok(weeklyScreen.cards.every(card=>!card.time.includes('TBA')),'dated cards require confirmed times');
  assert.ok(Date.parse(weeklyScreen.cards[0].date)<Date.parse(weeklyScreen.cards[1].date),'a later clock time this week comes before next week');
  assert.equal(weeklyScreen.posters,2,'every recurring release has a cover');
  assert.equal(weeklyScreen.legacyDays,0,'the old Monday–Sunday buckets are replaced');
  assert.equal(weeklyScreen.unannouncedPresent,false,'past release patterns cannot assign a weekday to an unannounced return');
  assert.equal(weeklyScreen.distantReturns,0,'confirmed and cached returns beyond two weeks do not appear in the weekly calendar');
  assert.equal(weeklyScreen.counters,0,'the clean calendar has no dashboard totals');
  assert.equal(weeklyScreen.cards.length,2,'duplicate entries do not inflate the schedule');
  assert.equal(weeklyScreen.noHorizontalOverflow,true,'weekly schedule fits the mobile viewport');
  console.log(engine.name()+': recurring clock order, undated returns, duplicate cards and mobile width passed');

  // Add and edit via the real form; external catalogue responses stay mocked.
  phase='search';
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await page.locator('.bottom-tabs [data-tab="search"]').isVisible(),false,'Search stays out of the island on Library');
  const fixedDock=await page.evaluate(async()=>{
    const spacer=document.createElement('div');spacer.style.height='2400px';document.querySelector('main').append(spacer);
    const bounds=()=>['.bottom-tabs','#add-btn'].map(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return {x:box.x,y:box.y};});
    // A preceding route restoration also scrolls on the next animation frame.
    // Wait for the requested position rather than sampling that race after two frames.
    const before=bounds();
    for(let frame=0;frame<20&&window.scrollY<=800;frame++){
      window.scrollTo({top:900,behavior:'instant'});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    const after=bounds(),scroll=window.scrollY;spacer.remove();window.scrollTo(0,0);return {before,after,scroll};
  });
  assert.ok(fixedDock.scroll>800,'the Library actually scrolled during the fixed-control test');
  assert.deepEqual(fixedDock.after,fixedDock.before,'the island and Search button stay fixed while Library scrolls');
  await page.locator('#search-input').click();
  assert.equal(await page.locator('#discovery-view').isVisible(),true,'Library search opens the Search page');
  assert.equal(await page.locator('.bottom-tabs [data-tab="search"]').count(),0,'Search keeps the same navigation tabs');
  assert.equal(await page.locator('.bottom-tabs').getAttribute('data-active-tab'),'collection');
  await page.locator('#discovery-query').fill('B');
  assert.equal(await page.locator('#discovery-query').inputValue(),'B');
  await page.locator('.bottom-tabs [data-tab="calendar"]').click();
  assert.equal(await page.locator('.bottom-tabs [data-tab="search"]').isVisible(),false,'leaving Search removes its temporary tab');
  await page.locator('[data-tab="collection"]').click();
  const libraryScrollBeforeSearch=await page.evaluate(async()=>{window.scrollTo(0,160);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return window.scrollY;});
  await page.locator('#add-btn').click();
  assert.equal(await page.locator('.bottom-tabs [data-tab="search"]').count(),0,'Search never expands the navigation capsule');
  assert.equal(await page.locator('#discovery-view').getAttribute('role'),'region');
  const fullSearch=await page.locator('#discovery-view').boundingBox();
  assert.ok(fullSearch.x<=1&&fullSearch.y<=1&&fullSearch.width>=389&&fullSearch.height>=843,'Search covers the whole page');
  assert.equal(await page.locator('#library-view').evaluate(node=>getComputedStyle(node).visibility),'hidden','Library artwork cannot show through Search');
  await page.waitForFunction(()=>{
    const cursor=document.querySelector('.tab-indicator').getBoundingClientRect(),active=document.querySelector('.bottom-tabs .tab-btn.active').getBoundingClientRect();
    return Math.abs(cursor.left-active.left)<1;
  });
  if(process.env.BROWSER_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-search.png')});
  await page.locator('#close-title-search').click();
  assert.equal(await page.locator('#discovery-view').isVisible(),false,'closing search returns to Library');
  await page.waitForFunction(expected=>Math.abs(window.scrollY-expected)<=2,libraryScrollBeforeSearch,{timeout:5000});
  assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-libraryScrollBeforeSearch)<=2,'closing search restores the original Library scroll');
  await page.locator('#add-btn').click();
  assert.equal(await page.evaluate(()=>document.body.style.position),'fixed','the Library stays pinned behind search');
  await page.evaluate(()=>{
    window._searchOriginalViewport=Object.getOwnPropertyDescriptor(window,'visualViewport');
    window._searchKeyboardViewport={height:380,offsetTop:40};
    Object.defineProperty(window,'visualViewport',{configurable:true,value:window._searchKeyboardViewport});
    window.dispatchEvent(new Event('resize'));
  });
  assert.equal(await page.locator('.bottom-tabs').isVisible(),false,'navigation is hidden above the keyboard');
  const keyboardInput=await page.locator('#discovery-query').boundingBox();
  await page.evaluate(()=>{
    document.querySelector('#discovery-global').classList.remove('hidden');
    document.querySelector('#discovery-results').innerHTML='<div style="height:1800px">Long search results</div>';
    document.querySelector('#search-sheet-results').scrollTop=600;
  });
  const scrolledInput=await page.locator('#discovery-query').boundingBox();
  assert.ok(Math.abs(scrolledInput.y-keyboardInput.y)<=1,'results cannot scroll the search field out of view');
  const keyboardSheet=await page.locator('.search-sheet').boundingBox();
  assert.ok(keyboardSheet.y>=40&&keyboardSheet.y+keyboardSheet.height<=421,'the sheet stays above the simulated iPhone keyboard');
  assert.ok(await page.locator('#search-sheet-results').evaluate(node=>node.scrollTop)>0,'results have their own scroll area');
  await page.evaluate(()=>{
    window._searchKeyboardViewport.height=window.innerHeight;window._searchKeyboardViewport.offsetTop=40;
    window.dispatchEvent(new Event('resize'));
  });
  assert.equal(await page.locator('.bottom-tabs').isVisible(),true,'navigation returns after keyboard dismissal');
  assert.equal(await page.locator('#discovery-view').evaluate(node=>node.style.getPropertyValue('--search-viewport-top')),'0px','stale iOS keyboard offsets are cleared');
  await page.evaluate(()=>{
    if(window._searchOriginalViewport)Object.defineProperty(window,'visualViewport',window._searchOriginalViewport);else delete window.visualViewport;
    delete window._searchOriginalViewport;delete window._searchKeyboardViewport;
    document.querySelector('#discovery-results').innerHTML='';document.querySelector('#discovery-results')._discoveryMarkup=null;
    document.querySelector('#discovery-global').classList.add('hidden');
    window.dispatchEvent(new Event('resize'));
  });
  await page.locator('#discovery-query').focus();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#discovery-view').isVisible(),false,'Escape closes the sheet');
  assert.equal(await page.locator('#discovery-query').evaluate(input=>input===document.activeElement),false,'closing search dismisses keyboard input');
  assert.notEqual(await page.evaluate(()=>document.body.style.position),'fixed','closing releases the background scroll lock');
  await page.locator('#add-btn').click();
  assert.equal(await page.locator('[data-browse-format]').count(),0,'Search has no Movies/Series selection cards');
  assert.equal(await page.locator('#discovery-query').inputValue(),'');
  assert.equal(await page.locator('#discovery-format-filters').isVisible(),false,'the empty search page starts with just search');
  await page.locator('#discovery-query').fill('Browser Test Film');
  assert.equal(await page.locator('#discovery-format-filters').isVisible(),true,'format filters are optional once searching');
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
  await page.locator('#discovery-detail-add').click();
  await page.waitForFunction(()=>!localSaveInFlight&&!cloudSaveInFlight&&mediaItems.length===1);
  assert.equal(await page.locator('#modal').isVisible(),false,'catalogue Add saves directly without a form');
  assert.equal(items[0].status,'Planned');
  assert.ok(items[0].createdAt,'quick adds preserve their original addition date');
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
  await page.waitForFunction(()=>!window.location.hash.startsWith('#/title/'));
  if(await page.locator('#discovery-view').isVisible())await page.locator('#close-title-search').click();
  await page.locator('[data-tab="collection"]').click();await page.locator('#add-btn').click();assert.equal(await page.locator('#discovery-query').inputValue(),'','Search control returns to Search home');
  await page.locator('#discovery-manual').click();await page.locator('#modal').waitFor({state:'visible'});await page.locator('#close-modal').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('#close-title-search').click();
  await page.locator('[data-tab="collection"]').click();
  phase='gallery';
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await page.getByRole('heading',{name:'Next to watch',exact:true}).count(),0);
  assert.equal(await page.locator('[data-gallery-category]').count(),2,'Library offers separate Shows and Films pages');
  assert.equal(await page.locator('.gallery-grid').count(),0);
  await page.evaluate(()=>{mediaItems[0].status='Watched';mediaItems[0].filmReleaseDate='2020-02-14';mediaItems[0].date='2026-09-21';render();});
  await openCategory('Film');await page.locator('[data-filter="Watched"]').click();
  assert.equal(await page.locator('.library-filter-panel #library-collection-select').isVisible(),true,'status and collection controls share one filter panel');
  const beforeCollectionTest=await page.evaluate(()=>{const prior=structuredClone(mediaItems[0]);mediaItems[0]={...prior,favorite:true,lists:['Weekend & films']};render();return prior;});
  await page.locator('#library-collection-select').selectOption('favourites');
  assert.equal(await page.locator('.gallery-tile').count(),1,'Favourites combines with the Watched status');
  await page.locator('#library-collection-select').selectOption('list:Weekend & films');
  assert.equal(await page.locator('.gallery-tile').count(),1,'user-created collection names filter the library');
  await page.locator('#library-collection-select').selectOption('');
  await page.evaluate(prior=>{mediaItems[0]=prior;render();},beforeCollectionTest);
  assert.equal(await page.locator('.gallery-grid').count(),1,'one Films grid');
  assert.match(await page.locator('.gallery-tile small').first().textContent(),/2020/);
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
  assert.equal(await page.locator('[data-gallery-details] a').count(),0,'the compact facts panel omits source rows');
  await page.locator('[data-gallery-close]').click();
  await page.locator('[data-filter="All"]').click();await page.locator('[data-library-back]').click();
  await page.evaluate(()=>openEdit(mediaItems[0].id));await page.locator('#platform').fill('Cinema');await page.locator('#film-release-time').fill('08:30');await page.locator('#save-btn').click();
  await page.waitForFunction(()=>mediaItems[0]?.platform==='Cinema'&&!cloudSaveInFlight&&!localSaveInFlight&&!queuedCloudSnapshot&&!queuedLocalSnapshot,null,{timeout:10000});assert.equal(items[0].platform,'Cinema');
  assert.equal(items[0].filmReleaseDate,'2020-02-14T08:30:00.000Z','the real film form saves the confirmed GMT instant');
  await page.evaluate(()=>openEdit(mediaItems[0].id));assert.equal(await page.locator('#film-release-date').inputValue(),'2020-02-14');assert.equal(await page.locator('#film-release-time').inputValue(),'08:30');await page.locator('#close-modal').click();
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
  await openSavedShows();
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
  assert.deepEqual(await page.locator('[data-gallery-details] dt').allTextContents(),['Release date','Released seasons','Status']);
  assert.equal(await page.locator('[data-gallery-details] a').count(),0,'extra source rows are removed');
  assert.doesNotMatch(await page.locator('[data-gallery-details]').textContent(),/Genres|rating|Runtime|Language/);
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
  await page.locator('[data-gallery-season-art="1"] img').evaluate(image=>image.dispatchEvent(new Event('error')));
  assert.equal(await page.locator('[data-gallery-season-art="1"] img').getAttribute('src'),'https://static.tvmaze.com/series-poster.jpg','broken season artwork falls back to the matching show cover');
  await page.locator('[data-gallery-season-art="2"] img').waitFor({state:'attached'});
  assert.equal(await page.locator('[data-gallery-season-art="2"] img').getAttribute('src'),'https://static.tvmaze.com/series-poster.jpg','missing season artwork uses this show cover');
  assert.equal(await page.locator('[data-gallery-episode="1:2"] .gallery-episode-copy strong').textContent(),'Episode 2');
  await page.locator('[data-episode-description="1:1"]').click();
  await page.getByRole('dialog',{name:/Episode 1/}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.episode-description p').textContent.includes('difficult case'));
  await page.getByRole('button',{name:'Close episode description',exact:true}).click();

  assert.equal(await page.locator('[data-gallery-episode="1:2"] .gallery-episode-title').textContent(),'Crossing Lines','episode titles load even when absent from the saved item');
  assert.equal(await page.locator('[data-gallery-episode="1:2"] .gallery-episode-title').isVisible(),true);
  assert.doesNotMatch(await page.locator('.gallery-season-episodes').allTextContents().then(rows=>rows.join(' ')),/\d+\. Episode \d+/);
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
    return {display:getComputedStyle(row).display,art:bounds(row.querySelector('.gallery-episode-art')),text:bounds(row.querySelector('.gallery-episode-copy')),button:bounds(row.querySelector('.gallery-episode-toggle')),overflow:dialog.scrollWidth>dialog.clientWidth};
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
  await page.locator('[data-tab="collection"]').click();
  // Delete/Undo restores just the removed title, preserving other progress.
  await page.evaluate(()=>openEdit(mediaItems[0].id));await page.locator('#delete-btn').click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>!cloudSaveInFlight&&!localSaveInFlight&&mediaItems.length===2);
  assert.equal(items.length,2);
  // Exercise the Settings menu and each drill-in panel in a mobile browser.
  phase='tinted sliding navigation';
  await page.locator('.bottom-tabs [data-tab="calendar"]').click();
  await page.waitForFunction(()=>Math.abs(document.querySelector('.tab-indicator').getBoundingClientRect().x-document.querySelector('.bottom-tabs [data-tab="calendar"]').getBoundingClientRect().x)<1);
  await page.locator('.bottom-tabs [data-tab="collection"]').click();
  await page.waitForFunction(()=>{
   const x=document.querySelector('.tab-indicator').getBoundingClientRect().x;
   const target=document.querySelector('.bottom-tabs [data-tab="collection"]').getBoundingClientRect().x;
   const calendar=document.querySelector('.bottom-tabs [data-tab="calendar"]').getBoundingClientRect().x;
   return x>target+1&&x<calendar-1;
  });
  await page.waitForFunction(()=>Math.abs(document.querySelector('.tab-indicator').getBoundingClientRect().x-document.querySelector('.bottom-tabs [data-tab="collection"]').getBoundingClientRect().x)<1);
  const dragStart=await page.locator('.bottom-tabs [data-tab="collection"]').boundingBox();
  const dragEnd=await page.locator('.bottom-tabs [data-tab="settings"]').boundingBox();
  await page.mouse.move(dragStart.x+dragStart.width/2,dragStart.y+dragStart.height/2);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x+dragEnd.width/2,dragEnd.y+dragEnd.height/2,{steps:8});
  assert.equal(await page.locator('.bottom-tabs').getAttribute('data-active-tab'),'collection','drag previews without opening a page');
  assert.equal(await page.locator('.bottom-tabs').evaluate(node=>node.classList.contains('is-dragging')),true,'horizontal dragging controls the pill');
  await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('.bottom-tabs').dataset.activeTab==='settings');
  assert.equal(await page.locator('#settings-view').isVisible(),true,'releasing the pill opens Settings');
  if(engine.name()==='chromium'){
    phase='touch navigation capture transfer';
    const touch=await context.newCDPSession(page);
    for(const [from,to] of [['calendar','collection'],['collection','settings'],['settings','collection'],['collection','calendar']]){
      await page.locator('.bottom-tabs [data-tab="'+from+'"]').click();
      await page.waitForFunction(tab=>Math.abs(document.querySelector('.tab-indicator').getBoundingClientRect().x-document.querySelector('.bottom-tabs [data-tab="'+tab+'"]').getBoundingClientRect().x)<1,from);
      const a=await page.locator('.bottom-tabs [data-tab="'+from+'"]').boundingBox(),b=await page.locator('.bottom-tabs [data-tab="'+to+'"]').boundingBox();
      const x=a.x+a.width/2,y=a.y+a.height/2,end=b.x+b.width/2;
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for(let step=1;step<=8;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(end-x)*step/8,y,id:1}]});
      assert.equal(await page.locator('.bottom-tabs').evaluate(node=>node.classList.contains('is-dragging')),true,'implicit button capture must not cancel the touch drag');
      assert.equal(await page.locator('.bottom-tabs').getAttribute('data-active-tab'),from,'touch previews until release');
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForFunction(tab=>document.querySelector('.bottom-tabs').dataset.activeTab===tab,to);
      assert.equal(await page.locator('.bottom-tabs [data-tab="'+to+'"]').getAttribute('aria-current'),'page','touch release selects '+to);
    }
    await touch.detach();
    await page.locator('.bottom-tabs [data-tab="settings"]').click();
  }
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
  phase='centred navigation';
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   for(const tab of ['settings','collection']){
    await page.locator('[data-tab="'+tab+'"]').click();
    const geometry=await page.evaluate(()=>{
     const bar=document.querySelector('.bottom-tabs').getBoundingClientRect(),search=document.querySelector('#add-btn').getBoundingClientRect();
     return {centre:bar.x+bar.width/2,viewport:innerWidth,barRight:bar.right,searchLeft:search.left,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(Math.abs(geometry.centre-(width/2-30))<1,'navigation is centred on '+tab+' at '+width+'px');
    assert.equal(geometry.overflow,false,'navigation motion creates no horizontal page overflow');
    assert.equal(await page.locator('.bottom-tabs').getAttribute('data-active-tab'),tab);
    assert.equal(await page.locator('[data-tab="'+tab+'"]').getAttribute('aria-current'),'page');
    if(tab==='collection')assert.ok(geometry.searchLeft-geometry.barRight>=7,'search stays clear of the centred capsule');
    else await assertSettingsOnly();
   }
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>{goToTabHome('settings');return settingsView.getAnimations().some(animation=>animation.playState==='running');}),true,'switching pages animates the incoming view');
  const rapid=await page.evaluate(()=>{
   goToTabHome('library');goToTabHome('settings');goToTabHome('library');
   return {tab:currentTab,settingsHidden:settingsView.classList.contains('hidden'),oldAnimations:settingsView.getAnimations().length};
  });
  assert.deepEqual(rapid,{tab:'library',settingsHidden:true,oldAnimations:0},'rapid switches take effect immediately and cancel old motion');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>{goToTabHome('settings');return settingsView.getAnimations().length;}),0,'reduced motion skips page animations');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await assertSettingsOnly();
  phase='settings visibility';
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
  await page.locator('[data-tab="settings"]').click();
  assert.equal(await page.locator('#settings-category-menu').isVisible(),true,'pressing Settings returns to Settings home');
  await page.locator('[data-settings-open="general"]').click();
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
  await page.locator('[data-tab="collection"]').click();
  await page.locator('#add-btn').click();
  assert.equal(await page.locator('#discovery-view').isVisible(),true,'Search opens after leaving Settings');
  assert.equal(await page.evaluate(()=>document.body.style.position),'fixed','the Library remains anchored behind the modal search backdrop');
  await page.locator('#close-title-search').click();
  await page.locator('[data-tab="settings"]').click();
  await assertSettingsOnly();
  await page.locator('[data-tab="collection"]').click();
  await page.waitForFunction(()=>document.querySelector('#settings-view').classList.contains('hidden')&&!document.querySelector('#library-view').classList.contains('hidden'));
  assert.equal(await page.locator('.shows-controls').isVisible(),false,'Library landing has no Shows controls');
  assert.equal(await page.locator('.stats-row').isVisible(),false,'Home omits Library totals');
  assert.equal(await category('Series').isVisible(),true,'Library links to the dedicated Shows page');
  for(const selector of ['.profile-card','#sync-now','#logout-btn','#appearance-mode','#background-reminder-status','#enable-background-reminders']){
    assert.equal(await page.locator(selector).first().isVisible(),false,selector+' must not be visible in Library');
  }
  // Force a pending memory change: refresh must save it before navigation.
  phase='recurring weekly schedule';
  await page.evaluate(async()=>{
   const item=mediaItems.find(row=>row.id==='show'),air=Date.now()-3600000;
   const episodes=[-7,0,7].map((days,index)=>({season:2,number:index+1,raw:new Date(air+days*86400000).toISOString()}));
   item.recurringWeeklySchedule=weeklyReleasePattern(episodes);item.scheduledEpisodeReleases=episodes.slice(1);
   await persistLibrary(mediaItems);
   await WatchLogRegionalReleases.refresh([item],{country:releaseViewingCountry()},async()=>({ok:true,json:async()=>episodes.map(ep=>({season:ep.season,number:ep.number,airdate:ep.raw.slice(0,10),airtime:'20:00',airstamp:ep.raw,_embedded:{show:{id:Number(item.tvmazeShowId),externals:{imdb:item.imdbId},webChannel:{name:item.platform,country:{code:releaseViewingCountry()}}}}}))}),Date.now()+6*3600000);
   render();
  });
  const recurring=page.locator('#recurring-weekly-dashboard');
  const calendarView=page.locator('#library-dashboard');
  assert.equal(await page.locator('[data-shows-section="Watchlist"]').isVisible(),false);
  assert.equal(await page.locator('[data-home-section="recurring"]').isVisible(),true,'Recurring shows are part of Library');
  assert.equal(await calendarView.isVisible(),false);
  await page.locator('[data-tab="calendar"]').click();
  assert.equal(await calendarView.isVisible(),true);assert.equal(await recurring.isVisible(),false);
  assert.equal(new URL(page.url()).hash,'#/calendar');
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await page.locator('#list-toolbar').isVisible(),false,'Library does not repeat the title filters');
  assert.equal(await calendarView.isVisible(),false);
  const recurringSummary=page.locator('[data-home-section="recurring"]>summary');
  await page.evaluate(()=>{document.querySelector('[data-home-section="recurring"]').open=true;});
  assert.equal(await recurring.isVisible(),true);
  await recurringSummary.focus();await page.keyboard.press('Enter');
  assert.equal(await recurring.isVisible(),false,'Library recurring shows collapse with the keyboard');
  await page.evaluate(()=>render());assert.equal(await recurring.isVisible(),false,'render retains the collapsed section');
  await recurringSummary.click();
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-tab="calendar"]').click();await page.goBack();await page.waitForFunction(()=>libraryOnlyPage&&currentTab==='library');
  assert.equal(await recurring.isVisible(),true);assert.equal(await calendarView.isVisible(),false);
  assert.equal(await recurring.locator('.release-week-list [data-recurring-open="show"]').first().isVisible(),true);
  assert.equal(await recurring.locator('[data-recurring-day]').count(),0,'the whole calendar uses real dates rather than weekday buckets');
  const recurringDates=await recurring.locator('[data-release-day]').evaluateAll(nodes=>nodes.map(node=>node.dataset.releaseDay));
  assert.deepEqual(recurringDates,[...recurringDates].sort(),'the calendar date groups are chronological');
  const releaseKeys=await recurring.locator('.release-week-list [data-recurring-open="show"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.releaseAt));
  assert.ok(releaseKeys.length>0);assert.equal(new Set(releaseKeys).size,releaseKeys.length,'each actual release occurs once');
  assert.match(await recurring.textContent(),/S2 E2/);
  const recurringMarker=()=>recurring.locator('[data-recurring-open="show"] .release-progress-dot').first();
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
  await page.evaluate(async()=>{
   const item=mediaItems.find(item=>item.id==='show'),releases=releasedEpisodeMap(item);
   item.watchedEpisodes=Object.fromEntries(Object.entries(releases).map(([season,episodes])=>[season,[...episodes]]));
   item.watchedEpisodes[2]=item.watchedEpisodes[2].filter(episode=>episode!==2);
   const raw=new Date(Date.now()-86400000+3000).toISOString();
   for(const rows of [item.recurringWeeklySchedule.episodes,item.scheduledEpisodeReleases])for(const episode of rows)if(episode.season===2&&episode.number===2)episode.raw=raw;
   await WatchLogRegionalReleases.refresh([item],{country:releaseViewingCountry()},async()=>({ok:true,json:async()=>item.scheduledEpisodeReleases.map(ep=>({season:ep.season,number:ep.number,airdate:ep.raw.slice(0,10),airtime:'20:00',airstamp:ep.raw,_embedded:{show:{id:Number(item.tvmazeShowId),webChannel:{name:item.platform,country:{code:releaseViewingCountry()}}}}}))}),Date.now()+12*3600000);
   render();
  });
  assert.equal(await recurringMarker().getAttribute('data-behind-level'),'green','new episodes stay green during their grace period');
  await page.waitForFunction(()=>document.querySelector('#recurring-weekly-dashboard [data-recurring-open="show"] .release-progress-dot')?.dataset.behindLevel==='amber');
  assert.equal(await recurringMarker().textContent(),'','automatic expiry still shows colour only');
  await page.evaluate(async({progress,schedule})=>{
   const item=mediaItems.find(item=>item.id==='show');item.watchedEpisodes=progress;
   item.recurringWeeklySchedule=schedule.recurring;item.scheduledEpisodeReleases=schedule.scheduled;
   await WatchLogRegionalReleases.refresh([item],{country:releaseViewingCountry()},async()=>({ok:true,json:async()=>item.scheduledEpisodeReleases.map(ep=>({season:ep.season,number:ep.number,airdate:ep.raw.slice(0,10),airtime:'20:00',airstamp:ep.raw,_embedded:{show:{id:Number(item.tvmazeShowId),webChannel:{name:item.platform,country:{code:releaseViewingCountry()}}}}}))}),Date.now()+18*3600000);render();
  },{progress:savedMarkerProgress,schedule:savedGraceSchedule});
  const scheduleText=await recurring.textContent();
  await page.locator('[data-tab="calendar"]').click();
  assert.equal(await calendarView.isVisible(),true);assert.equal(await recurring.isVisible(),false);
  assert.equal(await page.locator('[data-calendar-range],.calendar-range').count(),0);
  assert.equal(new URL(page.url()).hash,'#/calendar');
  await openCategory('Series');
  assert.equal(await page.locator('[data-shows-section="Episode Queue"]').count(),1);
  assert.equal(await page.locator('.top-nav h1').isVisible(),false,'Series shows its category heading without the app title');
  await page.locator('[data-saved-shows]').click();
  await page.locator('[data-filter="Watched"]').click();
  await page.locator('#sort-mode').selectOption('platform');
  await page.locator('#search-input').click();
  await page.locator('#discovery-query').fill('No matching title at all');
  await page.waitForFunction(()=>discoveryQuery==='No matching title at all');
  assert.equal(await page.locator('#discovery-library').isVisible(),false,'searching from a category uses the full Search page');
  assert.equal(await recurring.isVisible(),false,'The search sheet hides the Library behind it');
  assert.equal(await recurring.textContent(),scheduleText,'Library status, search and sorting cannot remove recurring shows');
  await page.locator('#close-title-search').click();
  await page.waitForFunction(()=>currentTab==='library'&&searchQuery==='');
  await page.locator('[data-filter="All"]').click();await page.locator('#sort-mode').selectOption('current');
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await recurring.isVisible(),true,'Recurring shows belong to Library');
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await recurring.locator('.release-week-list [data-recurring-open="show"]').first().isVisible(),true);
  await page.evaluate(()=>{const item=mediaItems.find(row=>row.id==='show');item.platform+=' test';render();item.platform=item.platform.slice(0,-5);render();});
  assert.equal(await recurring.locator('.release-week-list [data-recurring-open="show"]').first().isVisible(),true,'metadata updates retain the dedicated view');
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   assert.equal(await recurring.evaluate(root=>root.scrollWidth<=root.clientWidth),true,'recurring schedule fits the viewport');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:390,height:844});
  if(process.env.BROWSER_SCREENSHOT_DIR)await recurring.screenshot({path:path.join(process.env.BROWSER_SCREENSHOT_DIR,engine.name()+'-recurring.png')});
  await recurring.locator('.release-week-list [data-recurring-open="show"]').first().click();
  assert.equal(await page.getByRole('tab',{name:'Episodes',exact:true}).getAttribute('aria-selected'),'true','recurring shows open the new Episodes page');
  assert.equal(await page.locator('#episode-tracker-modal').isVisible(),false,'old tracker stays closed');
  await page.getByRole('tab',{name:'Details',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-gallery-details]').textContent.includes('official series description'));
  await page.locator('[data-gallery-close]').click();
  await page.waitForFunction(()=>document.activeElement?.matches('#recurring-weekly-dashboard [data-recurring-open="show"]'));
  await page.waitForFunction(()=>location.hash.startsWith('#/collection'));
  await page.locator('[data-tab="calendar"]').click();
  assert.equal(await page.locator('#library-dashboard [data-dashboard-open="show"] .release-progress-dot').first().getAttribute('data-behind-level'),'red','release calendar uses the same marker rules');
  await page.locator('[data-tab="calendar"]').click();
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
  await page.waitForFunction(()=>!document.querySelector('.gallery-detail[open]'));
  assert.equal(await page.locator('[data-calendar-range]').count(),0,'closing details keeps the clean filter-free calendar');
  assert.equal(await page.locator('#library-dashboard [data-dashboard-open="show"] .release-progress-dot').first().getAttribute('data-behind-level'),'green','watching released episodes makes the release-calendar marker green');
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await recurringMarker().getAttribute('data-behind-level'),'green','opening the recurring page shows the saved progress immediately');
  await page.locator('[data-tab="collection"]').click();
  phase='duplicate prevention';
  await page.locator('#add-btn').click();await page.locator('#discovery-query').fill('Browser Test Series');
  await page.locator('[data-discovery-filter="Series"]').click();
  await page.locator('#discovery-library-results [data-library-result="show"]').waitFor();
  assert.equal(await page.locator('#discovery-results [data-discovery-add]').count(),0,'a shared TVMaze ID is saved even when the catalogue IMDb ID differs');
  await page.locator('#close-title-search').click();
  await page.locator('[data-tab="collection"]').click();
  const beforeDuplicate=await page.evaluate(()=>mediaItems.length),beforeDuplicateSaves=saves;
  await page.evaluate(()=>{openAdd();titleInput.value='Test Series';typeSelect.value='Series';$('tvmaze-id').value='12';$('imdb-id').value='tt7654321';$('release-year').value='2021';});
  await page.locator('#save-btn').click();await page.locator('#duplicate-warning').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>mediaItems.length),beforeDuplicate);assert.equal(saves,beforeDuplicateSaves,'duplicate form submissions do not write to the cloud');
  await page.locator('#open-duplicate').click();await page.locator('.gallery-detail[open]').waitFor();
  await page.locator('[data-gallery-close]').click();
  phase='refresh';
  const refreshItemId=await page.evaluate(()=>{const item=mediaItems.find(item=>item.id==='show');item.platform='Saved before refresh';return item.id;});
  const before=loads;const reload=page.waitForEvent('load');await page.locator('#refresh-app').click();await reload;
  // The same browser context retains the PIN session across a document reload.
  // Wait for session restoration to finish before inspecting or interacting with
  // the login form; it is briefly visible while restorePinSession is still running.
  await page.waitForFunction(()=>document.querySelector('#auth-screen').classList.contains('hidden'),{timeout:10000});
  await page.waitForFunction(id=>mediaItems.find(item=>item.id===id)?.platform==='Saved before refresh',refreshItemId,{timeout:10000});
  assert.equal(items.find(item=>item.id===refreshItemId)?.platform,'Saved before refresh');
  assert.equal(await page.locator('[data-gallery-category]').count(),2,'Library restores both page shortcuts');
  await page.locator('[data-tab="collection"]').click();
  await page.evaluate(()=>{document.querySelector('[data-home-section="recurring"]').open=true;});
  await page.waitForFunction(()=>document.querySelectorAll('#recurring-weekly-dashboard .release-week-list [data-recurring-open="show"]').length>0);
  assert.ok(await page.locator('#recurring-weekly-dashboard .release-week-list [data-recurring-open="show"]').count()>0,'confirmed releases survive reload');
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await page.locator('[data-home-section]').count(),2,'reload restores both collapsible schedules');
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await recurring.isVisible(),true);assert.equal(await calendarView.isVisible(),false);
  assert.ok(loads>before);
  phase='quick add and Recent';
  const quickAdded=await page.evaluate(async()=>{
    await addDiscoveryTitle({title:'New Planned Series',format:'Series',tvmazeId:'9988',imdbId:'tt9999888',year:'2026'});
    await addDiscoveryTitle({title:'New Planned Series',format:'Series',tvmazeId:'9988',imdbId:'tt9999888',year:'2026'});
    const item=mediaItems.find(row=>row.tvmazeShowId==='9988');
    return {id:item.id,status:item.status,createdAt:item.createdAt,count:mediaItems.filter(row=>row.tvmazeShowId==='9988').length};
  });
  if(await page.locator('.gallery-detail[open]').count()){await page.locator('[data-gallery-close]').click();await page.waitForFunction(()=>!window.location.hash.startsWith('#/title/'));}
  assert.equal(quickAdded.status,'Planned');assert.equal(quickAdded.count,1);
  await openSavedShows();
  assert.equal(await page.locator('.gallery-tile').first().getAttribute('data-gallery-item'),quickAdded.id);
  assert.equal(await page.locator('#sort-mode').isDisabled(),true,'Recent always orders by addition date');
  await page.locator('[data-gallery-item="'+quickAdded.id+'"]').click();
  await page.locator('[data-gallery-menu]').click();await page.locator('[data-gallery-edit-menu]').click();
  await page.locator('#status').selectOption('Watching');await page.locator('#save-btn').click();
  await page.waitForFunction(id=>mediaItems.find(row=>row.id===id)?.status==='Watching'&&!localSaveInFlight&&!cloudSaveInFlight,quickAdded.id);
  assert.equal(await page.evaluate(id=>mediaItems.find(row=>row.id===id).createdAt,quickAdded.id),quickAdded.createdAt);
  assert.equal(await page.locator('.gallery-tile').first().getAttribute('data-gallery-item'),quickAdded.id,'adjusting status keeps the title in Recent');
  assert.match(new URL(page.url()).hash,/filter=Recent/);
  await page.locator('[data-filter="All"]').click();assert.equal(await page.locator('#sort-mode').isEnabled(),true);
  await page.locator('[data-tab="collection"]').click();
  // A failed cloud save must leave the current page and edit intact.
  phase='failed save';
  // Reload starts background metadata persistence. Finish that successful
  // save before injecting the failure intended for the explicit refresh.
  await page.waitForFunction(()=>!appRefreshInFlight&&!localSaveInFlight&&!cloudSaveInFlight&&!queuedLocalSnapshot&&!queuedCloudSnapshot);
  failSave=true;const failedLoads=loads;
  await page.evaluate(id=>{const item=mediaItems.find(item=>item.id===id);if(!item)throw Error('Refresh fixture missing: '+JSON.stringify({id,ids:mediaItems.map(row=>row.id),user:currentUser?.id,revision:cloudRevision,visible:document.visibilityState}));item.platform='Keep this change';},refreshItemId);await page.locator('#refresh-app').click();
  await page.waitForFunction(()=>document.querySelector('#app-toast').textContent.includes('Refresh paused')).catch(async error=>{console.error('Failed refresh state',await page.evaluate(()=>({toast:document.querySelector('#app-toast').textContent,refresh:!!appRefreshInFlight,local:!!localSaveInFlight,cloud:!!cloudSaveInFlight,modal:!modal.classList.contains('hidden'),saveDisabled:saveBtn.disabled})));throw error;});
  assert.equal(loads,failedLoads);assert.equal(await page.evaluate(id=>mediaItems.find(item=>item.id===id)?.platform,refreshItemId),'Keep this change');
  phase='consistent release clock';
  const releaseClock=await page.evaluate(()=>{
    const broadcast=new Date(Date.now()+86400000);broadcast.setUTCMinutes(0,0,0);
    const raw=broadcast.toISOString(),fixture={type:'Series',title:'Release clock regression',airingSeason:2,nextEpisodeNum:3,nextEpisodeDate:raw,scheduledEpisodeReleases:[{season:2,number:3,raw}]};
    const event=regionalScheduleEvent(fixture,{raw,kind:'episode',season:2,number:3});
    const popup=document.createElement('div');popup.innerHTML=reminderMarkup(fixture,false);
    const input=document.createElement('input');input.type='datetime-local';
    setReleaseInput(input,fixture,raw,{kind:'episode',season:2,number:3});
    return {expected:Date.parse(event.raw),upcoming:upcomingSortInfo(fixture).time,current:currentSortInfo(fixture).time,
      popup:popup.querySelector('small').textContent,formatted:formatLocalDateTime(new Date(event.raw)),
      input:input.value,expectedInput:toLocalInput(event.raw),saved:storedReleaseInput(input),raw};
  });
  assert.equal(releaseClock.upcoming,releaseClock.expected);
  assert.equal(releaseClock.current,releaseClock.expected);
  assert.equal(releaseClock.popup,releaseClock.formatted);
  assert.equal(releaseClock.input,releaseClock.expectedInput);
  assert.equal(releaseClock.saved,releaseClock.raw);
  const recoveredDetails=await page.evaluate(()=>fetchOfficialTitleDetails({title:'NCIS: New York',type:'Series',tvmazeShowId:'91405',imdbId:'tt41814550',releaseYear:'2026'}));
  assert.equal(recoveredDetails.state,'ready');
  assert.equal(recoveredDetails.status,'Running');
  assert.match(recoveredDetails.description,/major city and port/);
  await page.locator('[data-tab="collection"]').click();
  assert.match(new URL(page.url()).hash,/^#\/collection/);
  assert.equal(await page.locator('[data-gallery-category]').count(),2);
  assert.equal(await page.getByRole('heading',{name:'Library',exact:true}).filter({visible:true}).count(),1,'Library has one heading above its page links');
  assert.equal(await page.locator('#list-toolbar').evaluate(node=>getComputedStyle(node).borderBottomWidth),'0px','filters flow directly into the category grid');
  assert.equal(await page.locator('[data-home-section]').first().isVisible(),false);
  assert.equal(await page.locator('#sort-mode').isVisible(),false);
  await openSavedShows();
  assert.equal(await page.locator('#sort-mode').isVisible(),true);
  assert.equal(await page.locator('#sort-mode').isDisabled(),true,'Recent keeps newest additions first');
  await page.locator('[data-filter="Watching"]').click();
  await page.locator('#sort-mode').selectOption('title');
  assert.match(new URL(page.url()).hash,/collection\/series/);
  assert.equal(await page.locator('#continue-watching').isVisible(),false);
  await page.locator('[data-tab="collection"]').click();
  assert.equal(await page.locator('[data-home-section]').first().isVisible(),false);
  assert.equal(await page.locator('[data-shows-section="Watchlist"]').isVisible(),false);
  assert.equal(await page.locator('[data-gallery-category]').count(),2);
  assert.ok(saves>=4);assert.deepEqual(errors,[]);
  console.log(`${engine.name()}: visual search, filters, descriptions, duplicate badges, add/edit, episode mark/undo, unreleased guard and refresh persistence passed`);
 }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
