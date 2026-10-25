import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/navigation.js',import.meta.url),'utf8');
function router(){const c=vm.createContext({window:{},URLSearchParams});vm.runInContext(source,c);return c;}
test('App URLs round-trip titles, collections, Library filters and sort order',()=>{
 const c=router(),page={tab:'library',category:'Series',scope:'list:My shows & films',query:'NCIS',filter:'Watching',sort:'title'};
 const hash=c.appPageHash(page),parsed=c.parseAppHash(hash);
 for(const [key,value] of Object.entries(page))assert.equal(parsed[key],value);
 const title=c.parseAppHash(c.appPageHash({...page,title:'a/b c'}));assert.equal(title.title,'a/b c');
});
test('Search and Settings have their own restorable URLs',()=>{
 const c=router();
 assert.equal(c.appPageHash({tab:'settings',settings:'account'}),'#/settings/account');
 const parsed=c.parseAppHash(c.appPageHash({tab:'search',searchText:'The Batman',searchFormat:'Film'}));
 assert.equal(parsed.tab,'search');assert.equal(parsed.searchText,'The Batman');assert.equal(parsed.searchFormat,'Film');
 assert.equal(c.parseAppHash('#/settings/unknown').settings,'');assert.equal(c.parseAppHash('#/title/%E0%A4').title,'');
});
test('Schedule views and calendar ranges have restorable Library URLs',()=>{
 const c=router();
 for(const schedule of ['recurring','calendar'])for(const calendarRange of ['week','today','upcoming']){
  const page={tab:'library',schedule,calendarRange},hash=c.appPageHash(page),parsed=c.parseAppHash(hash);
  assert.equal(parsed.tab,'library');assert.equal(parsed.schedule,schedule);assert.equal(parsed.category,'');
  assert.equal(parsed.calendarRange,schedule==='calendar'?calendarRange:'week');
 }
 assert.equal(c.parseAppHash('#/library/calendar?range=unknown').calendarRange,'week');
 assert.equal(c.parseAppHash('#/library/unknown').schedule,'');
});
test('Calendar range updates replace their history entry so Back still returns to Library',()=>{
 const c=router(),calls=[],home={tab:'library',schedule:''};
 c.currentUser={id:'account'};c.window.location={hash:'#/library/calendar'};
 c.history={state:{watchlog:true,owner:'account',depth:1,parent:home},replaceState:(state,unused,hash)=>calls.push({state,hash}),pushState:()=>assert.fail('changing the range must not add a back step')};
 c.currentAppPage=()=>({tab:'library',schedule:'calendar',calendarRange:'upcoming'});
 vm.runInContext('navigationReady=true;',c);c.recordAppNavigation(true);
 assert.equal(calls.length,1);assert.equal(calls[0].hash,'#/library/calendar?range=upcoming');
 assert.equal(calls[0].state.depth,1);assert.equal(calls[0].state.parent,home);
});
test('Each primary control returns to its own home with nested state cleared',()=>{
 const c=router(),applied=[];let resets=0,records=0;
 c.saveNavigationPosition=()=>{};c.resetTitleSearch=()=>resets++;c.applyAppPage=page=>applied.push(page);c.recordAppNavigation=()=>records++;
 for(const tab of ['library','search','settings'])c.goToTabHome(tab);
 assert.equal(resets,1);assert.equal(records,3);
 for(const [index,tab] of ['library','search','settings'].entries()){
  const page=applied[index];assert.equal(page.tab,tab);
  for(const key of ['category','schedule','settings','title','scope','query','searchText'])assert.equal(page[key],'');
  assert.equal(page.calendarRange,'week');
  assert.equal(page.filter,'All');assert.equal(page.scroll,0);
 }
});
