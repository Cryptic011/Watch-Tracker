const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..'),web=path.join(root,'www');
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(web,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(web+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/json');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const engine of process.env.BROWSER_ENGINES==='all'?[chromium,webkit]:[chromium]){
    const browser=await engine.launch({headless:true});
    try{
      const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
      await context.addInitScript(()=>{
        window.CapacitorCustomPlatform={name:'ios'};
        window._native={permission:'prompt',requests:[],calls:[],backups:[]};
        window.Capacitor={
          PluginHeaders:[{name:'WatchLogNative',methods:['status','requestPermission','replaceReminders','cancelReminders','testReminder','shareBackup','takeNotification','updateControls'].map(name=>({name,rtype:'promise'}))}],
          nativePromise:async(plugin,method,args)=>{
            const state=window._native;state.calls.push(method);
            if(method==='requestPermission')state.permission='granted';
            if(method==='status'||method==='requestPermission')return {permission:state.permission};
            if(method==='replaceReminders')state.requests=args.requests;
            if(method==='cancelReminders')state.requests=[];
            if(method==='shareBackup')state.backups.push(JSON.parse(args.text));
            if(method==='updateControls'){state.controls=args;return {ready:true};}
            return {};
          }
        };
      });
      const page=await context.newPage(),errors=[],downloads=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('download',download=>downloads.push(download));
      const account={id:'ios-fixture',email:'ios@example.test',displayName:'iOS Test'};
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        const headers={'access-control-allow-origin':request.headers().origin||base,'access-control-allow-methods':'POST, GET, OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']||'content-type, x-watchlog-session'};
        if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
        if(url.pathname.includes('/functions/v1/watchlog-pin')){
          const body=request.postDataJSON();let data={ok:true,enabled:false};
          if(['login','load'].includes(body.action))data={ok:true,account,sessionToken:'mock-only-token',items:[],revision:0};
          return route.fulfill({headers,json:data});
        }
        if(url.origin===base)return route.continue();
        // Every external service is mocked. No production writes or notifications.
        return route.fulfill({headers,json:{ok:true,enabled:false,results:[],workflow_runs:[]}});
      });
      await page.goto(base);await page.locator('#auth-email').fill(account.email);await page.locator('#auth-pin').fill('1234');await page.locator('#auth-submit').click();
      await page.waitForFunction(()=>document.getElementById('auth-screen').classList.contains('hidden'));
      await page.waitForFunction(()=>_native.controls?.visible===true&&document.documentElement.classList.contains('watchlog-native-controls'));
      assert.equal(await page.locator('.bottom-tabs').evaluate(element=>getComputedStyle(element).visibility),'hidden','native dock replaces web controls');
      await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='native-dialog-check';document.body.append(dialog);dialog.showModal();});
      await page.waitForFunction(()=>_native.controls.visible===false);
      await page.evaluate(()=>document.getElementById('native-dialog-check').close());
      await page.waitForFunction(()=>_native.controls.visible===true);
      await page.evaluate(()=>document.getElementById('native-dialog-check').remove());
      await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='scroll-fixture';spacer.style.height='2400px';document.querySelector('main').append(spacer);});
      const dockBefore=await page.evaluate(()=>JSON.stringify(_native.controls));
      await page.evaluate(()=>window.scrollTo(0,1200));await page.waitForFunction(()=>window.scrollY>1000);
      assert.equal(await page.evaluate(()=>JSON.stringify(_native.controls)),dockBefore,'scrolling content never moves or changes the native footer');
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('watchlog:native-control',{detail:'settings'})));
      await page.waitForFunction(()=>_native.controls.tab==='settings'&&_native.controls.searchVisible===false);
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('watchlog:native-control',{detail:'library'})));
      await page.waitForFunction(()=>_native.controls.tab==='library'&&_native.controls.searchVisible===true);
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('watchlog:native-control',{detail:'search'})));
      await page.waitForFunction(()=>_native.controls.visible===true&&currentTab==='search'&&_native.controls.tab==='library'&&!document.getElementById('discovery-view').classList.contains('hidden'));
      const searchBounds=await page.locator('.search-sheet').boundingBox();
      assert.ok(searchBounds.x<=1&&searchBounds.width>=388,'Search fills the page width');
      assert.ok(searchBounds.height>=800,'Search fills the page height');
      assert.equal(await page.locator('#discovery-view').getAttribute('role'),'region');
      assert.equal(await page.locator('#library-view').evaluate(element=>getComputedStyle(element).visibility),'hidden','Library cannot show through the search page');
      await page.evaluate(()=>document.getElementById('discovery-view').style.setProperty('--search-viewport-height','810px'));
      const backgroundBounds=await page.locator('#discovery-view').boundingBox();assert.ok(backgroundBounds.height>=843,'Search background covers the home-indicator area even when visual viewport is shorter');
      await page.locator('#close-title-search').click();await page.waitForFunction(()=>_native.controls.tab==='library');
      await page.locator('#search-input').click();
      await page.waitForFunction(()=>currentTab==='search'&&_native.controls.tab==='library');
      await page.locator('#discovery-query').fill('Silo');
      assert.equal(await page.locator('#discovery-query').inputValue(),'Silo','Library search opens the same searchable page');
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('watchlog:native-control',{detail:'settings'})));
      await page.waitForFunction(()=>_native.controls.tab==='settings'&&document.getElementById('discovery-view').classList.contains('hidden'));
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('watchlog:native-control',{detail:'library'})));
      await page.waitForFunction(()=>_native.controls.tab==='library');
      await page.evaluate(()=>{document.getElementById('scroll-fixture').remove();window.scrollTo(0,0);});
      await page.evaluate(()=>{
        window.WatchLogRegionalReleases={...window.WatchLogRegionalReleases,resolve:item=>item,resolveEvent:(_item,event)=>event};
        mediaItems=[{id:'native-test',title:'A test show',type:'Series',status:'Watching',releaseSchedule:{},curSeason:1,scheduledEpisodeReleases:[{season:1,number:2,raw:new Date(Date.now()+3*86400000).toISOString()}]}];render();
      });
      await page.evaluate(()=>enableBackgroundReminders.click());
      await page.waitForFunction(()=>_native.requests.length===3);
      assert.ok(await page.evaluate(()=>_native.requests.every(request=>request.accountId==='ios-fixture')));
      assert.match(await page.locator('#offline-status').textContent(),/screens are included/);
      await page.evaluate(()=>document.getElementById('export-library-backup').click());
      await page.waitForFunction(()=>_native.backups.length===1);
      const backup=await page.evaluate(()=>_native.backups[0]);assert.equal(backup.format,'watchlog-library-backup');assert.equal(backup.items.length,1);assert.equal(downloads.length,0);
      await page.evaluate(()=>{mediaItems[0].hideFromWeeklyReleases=true;render();});
      await page.waitForFunction(()=>_native.requests.length===0);
      await page.evaluate(()=>{mediaItems[0].hideFromWeeklyReleases=false;render();});await page.waitForFunction(()=>_native.requests.length===3);
      await page.evaluate(()=>logoutBtn.click());await page.waitForFunction(()=>currentUser===null&&_native.requests.length===0);
      await page.waitForFunction(()=>_native.controls.visible===false);
      assert.deepEqual(errors,[]);
      console.log(`${engine.name()}: fixed native navigation, scroll isolation, search visibility, startup, reminders, backup and logout passed`);
      await context.close();
      if(engine===chromium){
        const icon=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
        const svg=fs.readFileSync(path.join(root,'assets/img/app-icon.svg'),'utf8');
        await icon.setContent(`<style>html,body{margin:0;width:1024px;height:1024px;background:#09090b}svg{display:block;width:1024px;height:1024px}</style>${svg}`);
        await icon.screenshot({path:path.join(root,'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')});await icon.close();
      }
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
