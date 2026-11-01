/* Hash URLs work on GitHub Pages and in the installed offline app. */
let navigationApplying=false,navigationReady=false,navigationAccount='',navigationRestore=0;
function currentAppPage(){
  const dialog=document.querySelector('.gallery-detail[open]');
  const panel=[...document.querySelectorAll('#settings-view [data-settings-panel]')].find(node=>!node.classList.contains('hidden'));
  return {schedule:typeof selectedScheduleView==='string'?selectedScheduleView:'',calendarRange:typeof selectedCalendarRange==='string'?selectedCalendarRange:'week',searchText:typeof discoveryInput!=='undefined'?discoveryInput.value.trim():'',searchFormat:typeof discoveryFilter!=='undefined'?discoveryFilter:'All',tab:typeof libraryOnlyPage!=="undefined"&&libraryOnlyPage&&currentTab==="library"?"collection":currentTab,category:window.WatchLogGallery?.getCategory?.()||'',scope:typeof libraryScope==='string'?libraryScope:'',settings:panel?.dataset.settingsPanel||'',title:dialog?.dataset.item||'',query:searchQuery,filter:activeFilter,sort:activeSort,scroll:window.scrollY||0,dialogScroll:dialog?.scrollTop||0};
}
function appPageHash(page){
  let path=page.title?'title/'+encodeURIComponent(page.title):page.tab==='settings'?'settings'+(page.settings?'/'+page.settings:''):page.tab==='search'?'search':page.tab==='collection'?'collection'+(page.category?'/'+(page.category==='Film'?'movies':'series'):''):'library'+(page.schedule?'/'+page.schedule:page.category?'/'+(page.category==='Film'?'movies':'series'):'');
  const query=new URLSearchParams();
  if(page.scope)query.set('collection',page.scope);
  if(page.schedule==='calendar'&&page.calendarRange&&page.calendarRange!=='week')query.set('range',page.calendarRange);
  if(page.tab==='search'){if(page.searchText)query.set('q',page.searchText);if(page.searchFormat&&page.searchFormat!=='All')query.set('format',page.searchFormat);}else if(page.query)query.set('q',page.query);
  if(page.filter&&page.filter!=='All')query.set('filter',page.filter);
  if(page.sort&&page.sort!=='current')query.set('sort',page.sort);
  return '#/'+path+(query.size?'?'+query:'');
}
function parseAppHash(hash){
  const [path,query='']=String(hash||'#/library').replace(/^#\/?/,'').split('?'),parts=path.split('/'),params=new URLSearchParams(query);
  const page={tab:'library',category:'',schedule:'',calendarRange:['today','upcoming'].includes(params.get('range'))?params.get('range'):'week',settings:'',title:'',scope:params.get('collection')||'',query:params.get('q')||'',filter:['All','Planned','Watching','Watched'].includes(params.get('filter'))?params.get('filter'):'All',sort:['current','recent','release','title','platform','watched','shows'].includes(params.get('sort'))?params.get('sort'):'current',scroll:0,dialogScroll:0};
  if(parts[0]==='settings'){page.tab='settings';page.settings=['general','reminders','account','maintenance'].includes(parts[1])?parts[1]:'';}
  else if(parts[0]==='collection'){page.tab='collection';if(['movies','series'].includes(parts[1]))page.category=parts[1]==='movies'?'Film':'Series';}
  else if(parts[0]==='search'){page.tab='search';page.searchText=params.get('q')||'';page.query='';page.searchFormat=['Film','Series'].includes(params.get('format'))?params.get('format'):'All';}
  else if(parts[0]==='title'){try{page.title=decodeURIComponent(parts.slice(1).join('/'));}catch(_){}}
  else if(['recurring','calendar'].includes(parts[1]))page.schedule=parts[1];
  else if(parts[1]==='movies'||parts[1]==='series')page.category=parts[1]==='movies'?'Film':'Series';
  return page;
}
function saveNavigationPosition(){
  if(!navigationReady||navigationApplying||!currentUser)return;
  const state=history.state;
  if(state?.page?.title&&!document.querySelector('.gallery-detail[open]'))return;
  if(state?.watchlog&&state.owner===String(currentUser.id)){
    const page=currentAppPage();
    if(state.page?.scroll===page.scroll&&state.page?.dialogScroll===page.dialogScroll&&appPageHash(state.page)===appPageHash(page))return;
    history.replaceState({...state,page},'',window.location.href);
  }
}
function recordAppNavigation(replace=false){
  if(!navigationReady||navigationApplying||!currentUser)return;
  const page=currentAppPage(),hash=appPageHash(page),previous=history.state;
  if(replace||hash===window.location.hash){history.replaceState({...previous,watchlog:true,owner:String(currentUser.id),page},'',hash);return;}
  history.pushState({watchlog:true,owner:String(currentUser.id),depth:(previous?.depth||0)+1,page,parent:previous?.page||null},'',hash);
}
function applyAppPage(page){
  if(!currentUser)return;
  navigationApplying=true;const revision=++navigationRestore,previousSchedule=typeof selectedScheduleView==='string'?selectedScheduleView:'';
  try{
    document.querySelector('.gallery-detail[open]')?.close();
    libraryScope=page.scope||'';activeFilter=page.filter||'All';activeSort=page.sort||'current';searchQuery=page.query||'';searchInput.value=searchQuery;sortMode.value=activeSort;
    pillBtns.forEach(button=>button.classList.toggle('active',button.dataset.filter===activeFilter));
    selectedScheduleView=['recurring','calendar'].includes(page.schedule)?page.schedule:'';
    selectedCalendarRange=['today','upcoming'].includes(page.calendarRange)?page.calendarRange:'week';
    window.WatchLogGallery?.setCategory?.(page.category||'');
    if(page.tab==='search'){const text=page.searchText||'';if(discoveryQuery!==text){pauseTitleSearch();discoveryRows=[];discoveryQuery=text;}discoveryInput.value=text;discoveryFilter=page.searchFormat||'All';}
    switchTab(page.tab||'library');
    if(page.tab==='settings'){showSettingsMenu();if(page.settings)showSettingsCategory(page.settings);}
    if(page.title){
      if(!window.WatchLogGallery?.open?.(page.title)){showAppToast('This title is no longer in your Library.','warn');page.title='';}
    }
    requestAnimationFrame(()=>{
      if(revision!==navigationRestore)return;
      window.scrollTo?.({top:Number(page.scroll)||0,behavior:'auto'});
      const dialog=document.querySelector('.gallery-detail[open]');if(dialog)dialog.scrollTop=Number(page.dialogScroll)||0;
      if(previousSchedule&&!selectedScheduleView&&page.tab==='library'&&!page.category&&!page.title)document.querySelector('[data-schedule-open="'+previousSchedule+'"]')?.focus({preventScroll:true});
    });
  }finally{navigationApplying=false;}
}
function goToTabHome(tab){
  if(!['library','collection','search','settings'].includes(tab))tab='library';
  saveNavigationPosition();
  if(tab==='search'&&typeof resetTitleSearch==='function')resetTitleSearch();
  applyAppPage({tab,category:'',schedule:'',calendarRange:'week',settings:'',title:'',scope:'',query:'',filter:'All',sort:'current',searchText:'',searchFormat:'All',scroll:0,dialogScroll:0});
  recordAppNavigation();
}
function initAppNavigation(){
  if(!currentUser||!window.location||typeof history==='undefined')return;
  const account=String(currentUser.id);if(navigationReady&&navigationAccount===account)return;
  navigationAccount=account;navigationReady=true;
  const saved=history.state?.watchlog&&history.state.owner===account?history.state.page:null;
  const notificationUrl=new URL(window.location.href),notificationOwner=notificationUrl.searchParams.get('reminderAccount');
  const page=notificationOwner?parseAppHash(window.location.hash):saved||parseAppHash(window.location.hash);
  if(notificationOwner){
    if(notificationOwner!==account){page.title='';page.tab='library';showAppToast('This reminder belongs to another account. Sign in to that account to view it.','warn');}
    notificationUrl.searchParams.delete('reminderAccount');history.replaceState(history.state,'',notificationUrl.href);
  }
  applyAppPage(page);
  history.replaceState({watchlog:true,owner:account,depth:0,page:currentAppPage()},'',appPageHash(currentAppPage()));
}
function appNavigationBack(capture=true){
  if(!navigationReady||navigationApplying)return false;
  if(history.state?.watchlog&&history.state.depth>0){if(capture)saveNavigationPosition();history.back();return true;}
  return false;
}
function beginTitleNavigation(){saveNavigationPosition();const previous=navigationApplying;navigationApplying=true;return previous;}
function endTitleNavigation(previous){navigationApplying=previous;recordAppNavigation();}
window.WatchLogNavigation={
  back:appNavigationBack,beforeTitle:saveNavigationPosition,titleOpened:recordAppNavigation,
  titleClosed(){
    if(navigationApplying||!navigationReady||document.querySelector('.gallery-detail[open]')||!window.location.hash.startsWith('#/title/'))return;
    if(appNavigationBack(false))return;
    const page={...currentAppPage(),title:''};applyAppPage(page);
    history.replaceState({watchlog:true,owner:String(currentUser?.id||''),depth:0,page},'',appPageHash(page));
  }
};
if(typeof window.addEventListener==='function'){
  window.addEventListener('popstate',event=>{
    if(!navigationReady||!currentUser)return;
    if(event.state?.watchlog&&event.state.owner===String(currentUser.id))applyAppPage(event.state.page);
    else applyAppPage(parseAppHash(window.location.hash));
  });
  window.addEventListener('hashchange',()=>{if(navigationReady&&currentUser&&!history.state?.watchlog)applyAppPage(parseAppHash(window.location.hash));});
  let scrollPositionTimer=null;
  window.addEventListener('scroll',()=>{
    if(scrollPositionTimer!==null)return;
    scrollPositionTimer=setTimeout(()=>{scrollPositionTimer=null;saveNavigationPosition();},250);
  },{passive:true});
}
