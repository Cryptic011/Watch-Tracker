import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
test('Closed-app reminders retain the app heading and two-line numbered release body',async()=>{
  const listeners={},shown=[];
  const self={addEventListener:(event,fn)=>listeners[event]=fn,registration:{showNotification:async(title,options)=>shown.push({title,...options})}};
  vm.runInNewContext(source,{self,URL});
  for(const [name,episode] of [['NCIS',3],['Reacher',4]]){
    let work;
    listeners.push({data:{json:()=>({title:'Watch Logger',body:`${name}\nNew episode out now (S1 E${episode})`,tag:name,data:{url:'./',episode}})},waitUntil:p=>work=p});
    await work;
  }
  assert.equal(shown[0].title,'Watch Logger');
  assert.equal(shown[0].body,'NCIS\nNew episode out now (S1 E3)');
  assert.equal(shown[1].title,'Watch Logger');
  assert.equal(shown[1].body,'Reacher\nNew episode out now (S1 E4)');
  assert.equal(shown[0].icon,'./assets/img/app-icon.png?v=4');
  assert.equal(shown[0].data.episode,3);
  assert.notEqual(shown[0].tag,shown[1].tag);
});

test('Only unread real reminders set a badge; tests and visible apps do not',async()=>{
 for(const [data,visible,expected] of [[{kind:'reminder'},false,1],[{eventKey:'release'},false,1],[{kind:'reminder',test:true},false,0],[{kind:'deployment'},false,0],[{kind:'reminder'},true,0]]){
  const listeners={};let badges=0,shown=0,work;
  const self={addEventListener:(event,fn)=>listeners[event]=fn,navigator:{setAppBadge:async()=>badges++},clients:{matchAll:async()=>visible?[{visibilityState:'visible'}]:[]},registration:{showNotification:async()=>shown++}};
  vm.runInNewContext(source,{self,URL});
  listeners.push({data:{json:()=>({body:'NCIS releases in 6 hours.',data})},waitUntil:p=>work=p});await work;
  assert.equal(badges,expected);assert.equal(shown,1);
 }
});
test('Badge failure cannot suppress a notification',async()=>{
 const listeners={};let shown=0,work;
 const self={addEventListener:(event,fn)=>listeners[event]=fn,navigator:{setAppBadge:async()=>{throw Error('Unsupported');}},clients:{matchAll:async()=>[]},registration:{showNotification:async()=>shown++}};
 vm.runInNewContext(source,{self,URL});listeners.push({data:{json:()=>({data:{kind:'reminder'}})},waitUntil:p=>work=p});await work;assert.equal(shown,1);
});

test('Navigation requests bypass the HTTP cache and refresh the offline fallback',async()=>{
  const listeners={},puts=[];
  const response={ok:true,clone:()=>response};
  const cache={put:async(request,value)=>puts.push({request,value}),match:async()=>null};
  const self={
    addEventListener:(event,fn)=>listeners[event]=fn,
    registration:{scope:'https://example.test/Watched-Tracker/',showNotification:async()=>{}},
    clients:{claim:async()=>{},matchAll:async()=>[]},
  };
  const Request=function(url){this.url=String(url);};
  let work;
  vm.runInNewContext(source,{self,URL,Request,AbortController,setTimeout,clearTimeout,fetch:async(_request,options)=>{
    assert.equal(options.cache,'no-store');return response;
  },caches:{open:async()=>cache},Response:{error:()=>({ok:false})}});
  listeners.fetch({request:{method:'GET',mode:'navigate'},respondWith:promise=>work=promise});
  assert.equal(await work,response);assert.equal(puts.length,1);
  assert.match(puts[0].request.url,/\/Watched-Tracker\/index\.html$/);
});
