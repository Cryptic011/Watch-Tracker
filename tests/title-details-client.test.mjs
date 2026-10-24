import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/js/catalogue.js',import.meta.url),'utf8');
function harness(responses){
 let calls=0;
 const cache=source.slice(source.indexOf('  const METADATA_CACHE_TTL_MS='),source.indexOf('  function episodeAirTime('));
 const details=source.slice(source.indexOf('  const titleDetailsCache='),source.indexOf('  function tvMazeShowMatchesSelection('));
 const context=vm.createContext({URL,console,esc:String,pinApi:async()=>({details:responses[Math.min(calls++,responses.length-1)]})});
 vm.runInContext(cache+details,context);
 return {get:item=>context.fetchOfficialTitleDetails(item),links:info=>context.titleDetailsSourceLinks(info),calls:()=>calls};
}
const item={title:'NCIS',type:'Series',imdbId:'tt0364845'};
const url='https://www.paramountglobalcontent.com/title/ncis';
const valid={source:'Paramount Global Content',descriptionSource:'Paramount Global Content',description:'NCIS follows a team investigating crimes with Navy or Marine Corps ties.',sources:[{name:'Paramount Global Content',url}],synopsisVersion:3,synopsisScope:'series',state:'ready'};

test('Legacy season-promo responses are hidden and never cached as a successful overview',async()=>{
 const old={source:'CBS',description:'Michael Weatherly returns as Tony DiNozzo, joining the team as they tackle Navy crimes and personal challenges.',sources:[{name:'CBS',url:'https://www.cbs.com/shows/ncis/'}],state:'ready'};
 const api=harness([old,valid]);
 const first=await api.get(item);assert.equal(first.description,'');assert.equal(first.state,'partial');
 const next=await api.get(item);assert.equal(next.description,valid.description);assert.equal(api.calls(),2);
 await api.get(item);assert.equal(api.calls(),2,'validated whole-show details can be cached');
});
test('A film-scoped or obsolete synopsis cannot be shown as a whole-series description',async()=>{
 for(const invalid of [{...valid,synopsisScope:'film'},{...valid,synopsisVersion:1},{...valid,synopsisVersion:2}]){
  const api=harness([invalid]);assert.equal((await api.get(item)).description,'');
 }
});
test('The verified distributor synopsis and its attribution survive the client boundary',async()=>{
 const api=harness([valid]);assert.equal((await api.get(item)).description,valid.description);
 assert.match(api.links(valid),/https:\/\/www\.paramountglobalcontent\.com\/title\/ncis/);
 assert.equal(api.links({...valid,sources:[{name:'Fake',url:'https://paramountglobalcontent.com.evil.test/title/ncis'}]}),'');
});
test('TVMaze series descriptions and their labelled attribution reach the Details panel',async()=>{
 const details={...valid,source:'TVMaze',descriptionSource:'TVMaze',ratingSource:'TVMaze',rating:8.2,sources:[{name:'TVMaze',url:'https://www.tvmaze.com/shows/59'}]};
 const api=harness([details]);assert.equal((await api.get(item)).description,valid.description);
 assert.match(api.links(details),/https:\/\/www\.tvmaze\.com\/shows\/59/);
 assert.equal(api.links({sources:[{name:'Fake',url:'https://www.tvmaze.com.evil.test/shows/59'}]}),'');
});
