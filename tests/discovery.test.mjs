import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../assets/js/discovery.js',import.meta.url),'utf8');
function harness(){
  const nodes=new Map(),calls=[];
  const element=()=>({value:'',textContent:'',innerHTML:'',dataset:{},attributes:{},open:false,
    classList:{hidden:false,add(){this.hidden=true;},toggle(_name,value){this.hidden=value;}},
    listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},
    querySelectorAll:()=>[],replaceChildren(){this.innerHTML='';},focus(){this.focused=true;},blur(){this.focused=false;},showModal(){this.open=true;},close(){this.open=false;}});
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const filters=['All','Film','Series'].map(type=>Object.assign(element(),{dataset:{discoveryFilter:type}}));
  const c=vm.createContext({URL,AbortController,setTimeout,clearTimeout,console,$,currentUser:{id:'a'},currentTab:'search',mediaItems:[],
    document:{querySelectorAll:()=>filters},esc:value=>String(value).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
    findTrackedDuplicate:()=>null,searchAllTitles:async()=>[],openAdd:()=>calls.push('new'),selectSuggestion:item=>calls.push(item.title),openEdit:id=>calls.push('edit:'+id),openMediaRow:id=>calls.push('details:'+id),
    switchTab:tab=>calls.push(tab),titleInput:element()});
  vm.runInContext(source,c);c.activateTitleSearch();
  return {c,$,calls,filters};
}
test('Newer queries win even when the cancelled provider replies late',async()=>{
  const {c,$}=harness(),requests=[];
  c.searchAllTitles=(query,options)=>new Promise(resolve=>requests.push({query,options,resolve}));
  $('discovery-query').value='Old';const old=c.runTitleSearch();
  $('discovery-query').value='New';const next=c.runTitleSearch();
  assert.equal(requests[0].options.signal.aborted,true);
  requests[1].resolve([{title:'New result',format:'Series'}]);await next;
  requests[0].resolve([{title:'Old result',format:'Series'}]);await old;
  assert.match($('discovery-results').innerHTML,/New result/);assert.doesNotMatch($('discovery-results').innerHTML,/Old result/);
});
test('Filters retain the query and full descriptions expand using native details',async()=>{
  const {c,$,filters}=harness();$('discovery-query').value='Title';
  c.searchAllTitles=async()=>[{title:'Series title',format:'Series',description:'Full description &amp; more.'},{title:'Film title',format:'Film'}];
  await c.runTitleSearch();assert.match($('discovery-results').innerHTML,/<details/);
  filters[1].onclick();assert.match($('discovery-results').innerHTML,/Film title/);assert.doesNotMatch($('discovery-results').innerHTML,/Series title/);
  assert.equal($('discovery-query').value,'Title');assert.equal(c.discoveryDescription({description:'A &amp; B'}),'A & B');
});
test('Unchanged results do not rebuild posters or focused controls',async()=>{
  const {c,$}=harness(),results=$('discovery-results');let writes=0,markup=results.innerHTML;
  Object.defineProperty(results,'innerHTML',{get:()=>markup,set:value=>{writes++;markup=value;}});
  $('discovery-query').value='Title';c.searchAllTitles=async()=>[{title:'Title',format:'Series',description:'A story.'}];
  await c.runTitleSearch();await c.runTitleSearch();assert.equal(writes,1);
});
test('Global result loading does not prefetch title descriptions',async()=>{
  const {c,$}=harness();let details=0;
  c.fetchOfficialTitleDetails=async()=>{details++;return {description:'A synopsis'};};
  c.searchAllTitles=async()=>[{title:'Film',format:'Film',imdbId:'tt1234567'}];$('discovery-query').value='Film';
  await c.runTitleSearch();assert.equal(details,0);assert.match($('discovery-results').innerHTML,/Film/);
});
test('Provider text is escaped and only allowed HTTPS artwork is rendered',()=>{
  const {c}=harness();const html=c.discoveryCard({title:'<img onerror=evil()>',format:'Film',description:'&lt;script&gt;evil()&lt;/script&gt;',posterUrl:'javascript:evil()'},0);
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
  assert.equal(c.discoveryImage('https://static.tvmaze.com.evil.test/poster.jpg'),'');
  assert.equal(c.discoveryImage('https://is1-ssl.mzstatic.com/poster.jpg'),'https://is1-ssl.mzstatic.com/poster.jpg');
});
test('Adding opens the editor; saved titles close the search preview and open their title page instead',()=>{
  const {c,calls,$}=harness();c.addDiscoveryTitle({title:'Reacher',format:'Series'});assert.deepEqual(calls,['new','Reacher']);
  calls.length=0;$('discovery-detail').open=true;c.findTrackedDuplicate=()=>({id:'existing'});c.addDiscoveryTitle({title:'Reacher',format:'Series'});assert.deepEqual(calls,['details:existing']);
  assert.equal($('discovery-detail').open,false);
  assert.match(c.discoveryCard({title:'Reacher',format:'Series'},0),/Already added/);
});
test('Leaving search cancels pending results and changing account clears the previous query',async()=>{
  const {c,$}=harness();let resolve;
  c.searchAllTitles=()=>new Promise(r=>resolve=r);$('discovery-query').value='Reacher';const request=c.runTitleSearch();
  c.pauseTitleSearch();resolve([{title:'Late result',format:'Series'}]);await request;
  assert.doesNotMatch($('discovery-results').innerHTML,/Late result/);
  c.currentUser={id:'other'};c.refreshTitleSearchBadges();assert.equal($('discovery-query').value,'');assert.equal($('discovery-results').innerHTML,'');
});
test('Search errors expose a retry and clearing input removes results',async()=>{
  const {c,$}=harness();$('discovery-query').value='Reacher';c.searchAllTitles=async()=>{throw Error('Offline');};
  await c.runTitleSearch();assert.equal($('discovery-retry').classList.hidden,false);assert.match($('discovery-status').textContent,/unavailable/);
  $('discovery-query').value='';await c.runTitleSearch();assert.equal($('discovery-retry').classList.hidden,true);assert.equal($('discovery-results').innerHTML,'');
});
test('Search is immediately after Library and artwork/update connections are allowed by CSP',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.deepEqual([...html.matchAll(/class="tab-btn[^"]*" data-tab="([^"]+)"/g)].map(m=>m[1]),['library','search','settings']);
  assert.match(html,/connect-src[^;]*wss:\/\/okkwteywtgfsnlrjdyhv\.supabase\.co/);
  assert.match(html,/img-src[^;]*https:\/\/\*\.mzstatic\.com/);
  assert.doesNotMatch(html.match(/connect-src[^;]*/)[0],/(?:wikipedia|wikidata|wikimedia)/i);
});
test('Film description enrichment uses the verified gateway and never makes direct Wikipedia requests',async()=>{
  const {c}=harness(),calls=[];
  c.fetch=()=>{throw Error('No direct external description requests');};
  c.fetchOfficialTitleDetails=async item=>{calls.push(item);return {description:'A verified film synopsis.',source:'IMDb',sources:[{name:'IMDb',url:'https://www.imdb.com/title/tt1234567/'}]};};
  const item={title:'Example',format:'Film',imdbId:'tt1234567'};
  assert.equal(await c.fetchDiscoveryDescription(item,new AbortController().signal),'A verified film synopsis.');
  assert.equal(calls[0].imdbId,'tt1234567');assert.equal(calls[0].type,'Film');assert.equal(item.verifiedDetails.source,'IMDb');
  const controller=new AbortController();controller.abort();assert.equal(await c.fetchDiscoveryDescription(item,controller.signal),'');assert.equal(calls.length,1);
});
test('Catalogue gateway excludes TVMaze series summaries but retains official film descriptions',async()=>{
  const backend=fs.readFileSync(new URL('../supabase/functions/watchlog-pin/index.ts',import.meta.url),'utf8');
  const part=stripTypeScriptTypes(backend.slice(backend.indexOf('function catalogText('),backend.indexOf('async function readMaintenance(')));
  const c=vm.createContext({URL,AbortController,setTimeout,clearTimeout,catalogCache:new Map(),CATALOG_TIMEOUT_MS:1000,CATALOG_CACHE_MS:60000,MAX_CATALOG_RESULTS_PER_SOURCE:30,
    fetch:async url=>({ok:true,json:async()=>url.includes('tvmaze')?[{show:{id:1,name:'Reacher',summary:'<p>Jack <b>Reacher</b> investigates.</p>',image:{medium:'https://static.tvmaze.com/poster.jpg'}}}]:url.includes('itunes')?{results:[{trackName:'Film',longDescription:'Full film plot',artworkUrl100:'https://is1-ssl.mzstatic.com/image/100x100bb.jpg'}]}:{d:[]}})});
  vm.runInContext(part,c);const rows=await c.searchCatalog('Reacher','gb');
  assert.equal(rows.find(r=>r.format==='Series').description,undefined,'TVMaze synopsis cannot masquerade as official title details');
  assert.equal(rows.find(r=>r.format==='Film').description,'Full film plot');
  assert.match(rows.find(r=>r.format==='Film').posterUrl,/400x600bb.jpg$/);
});

test('Retired History and Watchlist tabs are removed and cannot be activated',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const library=fs.readFileSync(new URL('../assets/js/library.js',import.meta.url),'utf8');
  assert.deepEqual([...html.matchAll(/class="tab-btn[^"]*" data-tab="([^"]+)"/g)].map(m=>m[1]),['library','search','settings']);
  assert.match(library,/const ALLOWED_BOTTOM_TABS=new Set\(\["library","search","settings"\]\)/);
  assert.match(library,/if\(!ALLOWED_BOTTOM_TABS\.has\(tab\)\)tab="library"/);
  assert.match(library,/label==="history"\|\|label==="watchlist"/);
});

test('Library matches render immediately on input without any global search',async()=>{
 const {c,$}=harness();let remote=0;c.searchAllTitles=async()=>{remote++;return [];};
 c.mediaItems=[{id:'s',title:'Reacher',type:'Series',status:'Watching',platform:'Prime Video',curSeason:2,curEp:3}];
 $('discovery-query').value='Reach';$('discovery-query').listeners.input();
 assert.match($('discovery-library-results').innerHTML,/Reacher/);assert.match($('discovery-library-results').innerHTML,/S2 E3/);assert.equal(remote,0);
 await c.runTitleSearch();assert.equal(remote,0);assert.equal($('discovery-search-global').classList.hidden,false);
});
test('Local matching ranks exact titles first and finds accents, platform names and archives',()=>{
 const {c}=harness();c.mediaItems=[{id:'a',title:'Reacher: Extras',type:'Film'},{id:'b',title:'Reacher',type:'Series'},{id:'c',title:'Amélie',type:'Film',platform:'Cinema',archived:true}];
 assert.deepEqual(Array.from(c.discoveryLibraryMatches('Reacher'),row=>row.id),['b','a']);
 assert.equal(c.discoveryLibraryMatches('amelie')[0].id,'c');assert.equal(c.discoveryLibraryMatches('cinema')[0].id,'c');
});
test('Global search is optional with local matches, and local cards survive streamed results and failures',async()=>{
 const {c,$}=harness();c.mediaItems=[{id:'s',title:'Reacher',type:'Series',imdbId:'tt1234567'}];let remote=0,resolve;
 c.findTrackedDuplicate=row=>row.imdbId==='tt1234567'?c.mediaItems[0]:null;
 c.searchAllTitles=(_query,{onProgress})=>{remote++;onProgress([{title:'Reacher',format:'Series',imdbId:'tt1234567'}]);return new Promise(r=>resolve=r);};
 $('discovery-query').value='Reacher';await c.runTitleSearch();assert.equal(remote,0);
 const pending=c.runTitleSearch({global:true});assert.equal(remote,1);assert.match($('discovery-library-results').innerHTML,/Reacher/);assert.equal($('discovery-results').innerHTML,'');
 resolve([{title:'Reacher',format:'Series',imdbId:'tt1234567'},{title:'Reacher bonus',format:'Series'}]);await pending;
 assert.match($('discovery-results').innerHTML,/Reacher bonus/);assert.doesNotMatch($('discovery-results').innerHTML,/tt1234567/);
 c.searchAllTitles=async()=>{throw Error('Offline');};await c.runTitleSearch({global:true});
 assert.match($('discovery-library-results').innerHTML,/Reacher/);assert.equal($('discovery-retry').classList.hidden,false);
});
test('A missing local match runs global search, while a one-character local query stays offline',async()=>{
 const {c,$}=harness();let remote=0;c.mediaItems=[{id:'s',title:'Reacher',type:'Series'}];c.searchAllTitles=async()=>{remote++;return [];};
 $('discovery-query').value='R';await c.runTitleSearch();assert.equal(remote,0);assert.match($('discovery-library-results').innerHTML,/Reacher/);
 $('discovery-query').value='Unknown';await c.runTitleSearch();assert.equal(remote,1);assert.equal($('discovery-library').classList.hidden,true);
});
test('Format filters search globally when that format has no local match',async()=>{
 const {c,$,filters}=harness();let remote=0;c.mediaItems=[{id:'s',title:'Reacher',type:'Series'}];c.searchAllTitles=async()=>{remote++;return [{title:'Reacher film',format:'Film'}];};
 $('discovery-query').value='Reacher';await c.runTitleSearch();filters[1].onclick();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(remote,1);assert.equal($('discovery-library').classList.hidden,true);assert.match($('discovery-results').innerHTML,/Reacher film/);
});
test('Opening a local result uses the saved record directly',()=>{
 const {c,$,calls}=harness();c.mediaItems=[{id:'saved',title:'Reacher',type:'Series'}];
 $('discovery-library-results').listeners.click({target:{closest:()=>({dataset:{libraryOpen:'saved'}})}});
 assert.deepEqual(calls,['details:saved']);
});
test('A synced library edit updates local matches without starting global requests',async()=>{
 const {c,$}=harness();let remote=0;c.searchAllTitles=async()=>{remote++;return [];};c.mediaItems=[{id:'s',title:'Reacher',type:'Series'}];
 $('discovery-query').value='Reacher';await c.runTitleSearch();c.mediaItems[0].title='Reacher updated';c.refreshTitleSearchBadges();
 assert.match($('discovery-library-results').innerHTML,/Reacher updated/);assert.equal(remote,0);
});

test('Typing a Library match cancels the old global lookup and ignores its late response',async()=>{
 const {c,$}=harness();let remote=0,resolve,signal;
 c.mediaItems=[{id:'s',title:'Reacher',type:'Series'}];c.searchAllTitles=(_query,options)=>{remote++;signal=options.signal;return new Promise(r=>resolve=r);};
 $('discovery-query').value='Other title';const pending=c.runTitleSearch();
 $('discovery-query').value='Reach';$('discovery-query').listeners.input();assert.equal(signal.aborted,true);
 resolve([{title:'Other title',format:'Series'}]);await pending;
 assert.equal(remote,1);assert.match($('discovery-library-results').innerHTML,/Reacher/);assert.equal($('discovery-results').innerHTML,'');
});

test('Submitting search dismisses text entry while automatic results keep typing focused',async()=>{
 const {c,$}=harness(),input=$('discovery-query');let prevented=false,blurred=0;
 c.document.activeElement=input;input.blur=()=>{blurred++;c.document.activeElement=null;};input.value='NCIS';
 c.mediaItems=[{id:'ncis',title:'NCIS',type:'Series'}];
 input.listeners.input();assert.equal(blurred,0,'typing and local results retain focus');
 c.refreshTitleSearchBadges();assert.equal(blurred,0,'background sync does not dismiss typing');
 $('discovery-form').listeners.submit({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(blurred,1);assert.equal(input.value,'NCIS');
 assert.match($('discovery-library-results').innerHTML,/NCIS/);
});

test('A vertical results swipe dismisses the keyboard without cancelling native scrolling',()=>{
 const {c,$}=harness(),input=$('discovery-query'),view=$('discovery-view');let blurred=0;
 c.document.activeElement=input;input.blur=()=>{blurred++;c.document.activeElement=null;};
 const touch=(x,y)=>({touches:[{clientX:x,clientY:y}],target:{closest:()=>null},preventDefault(){throw Error('Native scrolling must remain available');}});
 view.listeners.touchstart(touch(100,300));view.listeners.touchmove(touch(103,294));assert.equal(blurred,0,'small movements remain taps');
 view.listeners.touchmove(touch(104,270));assert.equal(blurred,1);
 view.listeners.touchmove(touch(104,240));assert.equal(blurred,1,'dismiss once per gesture');
});

test('Input selection, horizontal gestures, pinch zoom and cancelled touches keep typing focused',()=>{
 const {c,$}=harness(),input=$('discovery-query'),view=$('discovery-view');let blurred=0;
 c.document.activeElement=input;input.blur=()=>blurred++;
 const touch=(x,y,editable=false)=>({touches:[{clientX:x,clientY:y}],target:{closest:()=>editable?input:null}});
 view.listeners.touchstart(touch(100,300,true));view.listeners.touchmove(touch(100,200));
 view.listeners.touchstart(touch(100,300));view.listeners.touchmove(touch(140,298));view.listeners.touchend();
 view.listeners.touchstart(touch(100,300));view.listeners.touchmove({touches:[{},{}]});view.listeners.touchmove(touch(100,200));
 view.listeners.touchstart(touch(100,300));view.listeners.touchcancel();view.listeners.touchmove(touch(100,200));
 assert.equal(blurred,0);
});

test('Leaving search and opening saved results dismiss the keyboard without clearing the query',()=>{
 const {c,$,calls}=harness(),input=$('discovery-query');let blurred=0;
 input.value='NCIS';input.blur=()=>{blurred++;c.document.activeElement=null;};c.document.activeElement=input;
 c.pauseTitleSearch();assert.equal(blurred,1);assert.equal(input.value,'NCIS');
 c.document.activeElement=input;c.mediaItems=[{id:'ncis',title:'NCIS',type:'Series'}];
 $('discovery-library-results').listeners.click({target:{closest:()=>({dataset:{libraryOpen:'ncis'}})}});
 assert.equal(blurred,2);assert.deepEqual(calls,['details:ncis']);
});
