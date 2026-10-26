import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/js/catalogue.js',import.meta.url),'utf8');
function harness(responses,storage,region='GB'){
 let calls=0;
 const cache=source.slice(source.indexOf('  const METADATA_CACHE_TTL_MS='),source.indexOf('  function episodeAirTime('));
 const details=source.slice(source.indexOf('  const titleDetailsCache='),source.indexOf('  function tvMazeShowMatchesSelection('));
 const context=vm.createContext({URL,console,localStorage:storage,releaseViewingCountry:()=>region,esc:String,pinApi:async()=>({details:responses[Math.min(calls++,responses.length-1)]})});
 vm.runInContext(cache+details,context);
 return {get:item=>context.fetchOfficialTitleDetails(item),links:info=>context.titleDetailsSourceLinks(info),calls:()=>calls,region:value=>{region=value;}};
}
const item={title:'NCIS',type:'Series',imdbId:'tt0364845'};
const url='https://www.paramountglobalcontent.com/title/ncis';
const valid={source:'Paramount Global Content',descriptionSource:'Paramount Global Content',description:'NCIS follows a team investigating crimes with Navy or Marine Corps ties.',sources:[{name:'Paramount Global Content',url}],synopsisVersion:5,synopsisScope:'series',state:'ready'};
const deviceStorage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};

test('Verified details reopen immediately after an app restart without another network request',async()=>{
 const storage=deviceStorage(),first=harness([valid],storage);
 await first.get(item);assert.equal(first.calls(),1);
 const restarted=harness([],storage);
 assert.equal((await restarted.get(item)).description,valid.description);assert.equal(restarted.calls(),0);
});
test('Expired, obsolete and wrong-identity stored details are fetched again',async()=>{
 for(const mutate of [row=>{row.expiresAt=Date.now()-1;},row=>{row.details.synopsisVersion=1;},row=>{row.details.synopsisVersion=4;},row=>{row.details.imdbId='tt9999999';}]){
  const storage=deviceStorage();await harness([valid],storage).get(item);
  const key='watchlog_verified_title_details_v1',rows=JSON.parse(storage.getItem(key));mutate(rows[0]);storage.setItem(key,JSON.stringify(rows));
  const fresh=harness([valid],storage);assert.equal((await fresh.get(item)).description,valid.description);assert.equal(fresh.calls(),1);
 }
});
test('An unavailable result is never persisted and a retry can recover',async()=>{
 const storage=deviceStorage(),failed=harness([{state:'unavailable',sources:[]}],storage);
 await failed.get(item);assert.equal(storage.getItem('watchlog_verified_title_details_v1'),null);
 const retry=harness([valid],storage);assert.equal((await retry.get(item)).description,valid.description);assert.equal(retry.calls(),1);
});
test('A different title identity cannot reuse another film’s persisted details',async()=>{
 const storage=deviceStorage(),first={title:'Carrie',type:'Film',imdbId:'tt1939659',releaseYear:'2013'};
 await harness([{...valid,synopsisScope:'film',imdbId:first.imdbId,year:'2013'}],storage).get(first);
 const remake=harness([{...valid,synopsisScope:'film',imdbId:'tt0074285',year:'1976'}],storage);
 assert.equal((await remake.get({...first,imdbId:'tt0074285',releaseYear:'1976'})).year,'1976');assert.equal(remake.calls(),1);
});
test('Blocked device storage does not prevent a successful fetch',async()=>{
 const blocked={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('full');}};
 const api=harness([valid],blocked);assert.equal((await api.get(item)).description,valid.description);assert.equal(api.calls(),1);
});
test('A viewing-region change uses a separate service-description cache',async()=>{
 const api=harness([valid],deviceStorage());await api.get(item);api.region('US');await api.get(item);assert.equal(api.calls(),2);
});

test('Legacy season-promo responses are hidden and never cached as a successful overview',async()=>{
 const old={source:'CBS',description:'Michael Weatherly returns as Tony DiNozzo, joining the team as they tackle Navy crimes and personal challenges.',sources:[{name:'CBS',url:'https://www.cbs.com/shows/ncis/'}],state:'ready'};
 const api=harness([old,valid]);
 const first=await api.get(item);assert.equal(first.description,'');assert.equal(first.state,'partial');
 const next=await api.get(item);assert.equal(next.description,valid.description);assert.equal(api.calls(),2);
 await api.get(item);assert.equal(api.calls(),2,'validated whole-show details can be cached');
});
test('A film-scoped or obsolete synopsis cannot be shown as a whole-series description',async()=>{
 for(const invalid of [{...valid,synopsisScope:'film'},{...valid,synopsisVersion:1}]){
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
test('Conflicting film identities and remake years cannot reach the Details panel',async()=>{
 const film={title:'Carrie',type:'Film',imdbId:'tt1939659',releaseYear:'2013'};
 for(const conflict of [{imdbId:'tt0074285',year:'2013'},{imdbId:'tt1939659',year:'1976'}]){
  const api=harness([{...valid,...conflict,synopsisScope:'film'}]);
  assert.equal((await api.get(film)).state,'unmatched');
 }
});
test('Verified fallback sources remain labelled and malicious lookalike domains stay excluded',async()=>{
 for(const [name,url] of [['JustWatch','https://www.justwatch.com/uk/movie/carrie-2013'],['TMDb','https://www.themoviedb.org/movie/133805'],['Disney','https://movies.disney.com/star-wars-the-mandalorian-and-grogu'],['Harry Potter','https://www.harrypotter.com/discover/films/harry-potter-and-the-chamber-of-secrets'],['Paramount+','https://www.intl.paramountplus.com/gb/shows/ncis/'],['Rakuten TV','https://www.rakuten.tv/uk/movies/carrie-2013'],['Sky Store','https://www.skystore.com/product/carrie-2013/123']]){
  const details={...valid,source:name,descriptionSource:name,synopsisScope:'film',sources:[{name,url}]};
  const api=harness([details]);assert.equal((await api.get({title:'Film',type:'Film'})).description,valid.description);assert.ok(api.links(details).includes(url));
  const fake=new URL(url);fake.hostname+='.evil.test';assert.equal(api.links({sources:[{name,url:fake.href}]}),'');
 }
});
