import test from 'node:test';
import assert from 'node:assert/strict';
import {getTitleDetails} from '../supabase/functions/watchlog-pin/title-details.mjs';
const film={title:'Carrie',type:'Film',imdbId:'tt1939659',year:'2013',platform:'Prime Video'};
const apple='https://tv.apple.com/gb/movie/carrie/umc.test';
const plot='A sheltered teenager discovers telekinetic powers while facing cruelty at school and at home.';
const ld=(name='Carrie',type='Movie',year='2013',description=plot)=>'<script type="application/ld+json">'+JSON.stringify({'@type':type,name,datePublished:year+'-01-01',startDate:year+'-01-01',description})+'</script>';
const json=data=>({ok:true,json:async()=>data}),html=data=>({ok:true,text:async()=>data}),failure=()=>({ok:false,status:503});
const options={useCache:false,providerTimeoutMs:300};
const listing=(offers=[],fields={})=>({data:{popularTitles:{edges:[{node:{objectType:'MOVIE',content:{title:'Carrie',originalReleaseYear:2013,externalIds:{imdbId:film.imdbId},fullPath:'/uk/movie/carrie-2013',shortDescription:'The aggregator synopsis should remain a fallback.'},offers,...fields}}]}}});
const offer=(url=apple,name='Apple TV Store')=>({standardWebURL:url,monetizationType:'RENT',package:{clearName:name}});
const imdbPage=()=>html('<script type="application/ld+json">'+JSON.stringify({'@type':'Movie',name:'Carrie',url:'https://www.imdb.com/title/'+film.imdbId+'/',datePublished:'2013-01-01',description:'The verified IMDb fallback description.',aggregateRating:{ratingValue:5.8}})+'</script>');

test('An available service’s own film About text takes priority over IMDb and aggregator text',async()=>{
 const calls=[];
 const result=await getTitleDetails(film,async(url,init)=>{
  calls.push(url);
  if(url.includes('justwatch')){assert.match(JSON.parse(init.body).query,/offers\(country:GB,platform:WEB\).*standardWebURL/);return json(listing([offer()]));}
  if(url===apple)return html(ld());
  if(url.includes('imdb.com/title/'))return imdbPage();
  return failure();
 },options);
 assert.equal(result.description,plot);assert.equal(result.descriptionSource,'Apple TV');assert.equal(result.descriptionMethod,'watch-service');
 assert.equal(result.rating,5.8);assert.equal(result.ratingSource,'IMDb');assert.equal(result.sources[0].url,apple);
 assert.equal(calls.filter(url=>url.includes('justwatch')).length,1,'discovery and fallback share one availability lookup');
});
test('Service availability discovery follows the selected viewing region',async()=>{
 const us=apple.replace('/gb/','/us/');
 const result=await getTitleDetails({...film,country:'US'},async(url,init)=>{
  if(url.includes('justwatch')){assert.match(JSON.parse(init.body).query,/offers\(country:US,platform:WEB\)/);return json(listing([offer(us)]));}
  return url===us?html(ld()):url.includes('imdb.com/title/')?imdbPage():failure();
 },options);
 assert.equal(result.source,'Apple TV');assert.equal(result.sources[0].url,us);
});
test('An available streaming series About page is preferred to a complete TVMaze overview',async()=>{
 const input={title:'NCIS: Origins',type:'Series',imdbId:'tt30796986',tvmazeShowId:'73811',year:'2026'};
 const url='https://www.intl.paramountplus.com/gb/shows/ncis-origins/';
 const result=await getTitleDetails(input,async endpoint=>{
  if(endpoint.includes('justwatch'))return json(listing([offer(url,'Paramount Plus')],{objectType:'SHOW',content:{title:input.title,originalReleaseYear:2024,externalIds:{imdbId:input.imdbId}}}));
  if(endpoint===url)return html(ld(input.title,'TVSeries','2024'));
  if(endpoint.endsWith('/seasons'))return json([{number:1},{number:2}]);
  if(endpoint.includes('tvmaze'))return json({id:73811,name:input.title,premiered:'2024-10-14',externals:{imdb:input.imdbId},summary:'A valid TVMaze whole-show fallback description.',rating:{average:8.2}});
  return failure();
 },options);
 assert.equal(result.source,'Paramount+');assert.equal(result.description,plot);assert.equal(result.year,'2024');assert.equal(result.seasons,2);
});
test('Mismatched availability identities, years and formats never lead to provider fetches',async()=>{
 for(const fields of [{objectType:'SHOW'},{content:{title:'Carrie',originalReleaseYear:1976,externalIds:{imdbId:film.imdbId}}},{content:{title:'Carrie',originalReleaseYear:2013,externalIds:{imdbId:'tt0074285'}}},{content:{title:'Another film',originalReleaseYear:2013,externalIds:{imdbId:film.imdbId}}}]){
  const calls=[];
  const result=await getTitleDetails(film,async url=>{calls.push(url);return url.includes('justwatch')?json(listing([offer()],fields)):url.includes('imdb.com/title/')?imdbPage():failure();},options);
  assert.equal(result.source,'IMDb');assert.ok(!calls.includes(apple));
 }
});
test('A service page about the wrong remake cannot override the verified fallback',async()=>{
 const result=await getTitleDetails(film,async url=>url.includes('justwatch')?json(listing([offer()])):url===apple?html(ld('Carrie','Movie','1976')):url.includes('imdb.com/title/')?imdbPage():failure(),options);
 assert.equal(result.source,'IMDb');assert.equal(result.descriptionMethod,'catalogue');
});
test('Episode links, unapproved domains and retail product pages are not fetched as service descriptions',async()=>{
 const urls=['https://tv.apple.com/gb/episode/carrie/s1e1','https://www.netflix.com.evil.test/title/123','https://www.amazon.co.uk/gp/product/not-a-video','https://en.wikipedia.org/wiki/Carrie'];
 const calls=[];
 const result=await getTitleDetails(film,async url=>{calls.push(url);return url.includes('justwatch')?json(listing(urls.map(url=>offer(url)))):url.includes('imdb.com/title/')?imdbPage():failure();},options);
 assert.equal(result.source,'IMDb');assert.ok(urls.every(url=>!calls.includes(url)));
});
test('A blocked service page falls back to IMDb without replacing its identity',async()=>{
 const result=await getTitleDetails(film,async url=>url.includes('justwatch')?json(listing([offer()])):url.includes('imdb.com/title/')?imdbPage():failure(),options);
 assert.equal(result.source,'IMDb');assert.equal(result.imdbId,film.imdbId);assert.equal(result.year,'2013');
});
test('An opaque service URL containing an episode cannot masquerade as a whole series',async()=>{
 const url='https://www.primevideo.com/detail/opaque-id';
 const result=await getTitleDetails({title:'NCIS',type:'Series',imdbId:'tt0364845',officialUrl:url},async endpoint=>endpoint===url?html('<meta property="og:title" content="NCIS"><script type="application/ld+json">'+JSON.stringify({'@type':'TVEpisode',name:'A Family Matter',description:'An investigator discovers a dangerous conspiracy during a mysterious disappearance.'})+'</script>'):failure(),options);
 assert.ok(!result.description);
});
test('Sign-in and trial marketing are not used as a film synopsis',async()=>{
 const result=await getTitleDetails(film,async url=>url.includes('justwatch')?json(listing([offer()])):url===apple?html(ld('Carrie','Movie','2013','Sign up to watch Carrie and thousands of movies with your free trial today.')):url.includes('imdb.com/title/')?imdbPage():failure(),options);
 assert.equal(result.source,'IMDb');assert.equal(result.descriptionMethod,'catalogue');
});
test('One stalled service cannot block another service’s verified About page',{timeout:1000},async()=>{
 const blocked='https://www.netflix.com/gb/title/123';
 const result=await getTitleDetails(film,async url=>url.includes('justwatch')?json(listing([offer(blocked,'Netflix'),offer()])):url===blocked?new Promise(()=>{}):url===apple?html(ld()):url.includes('imdb.com/title/')?imdbPage():failure(),options);
 assert.equal(result.source,'Apple TV');assert.equal(result.descriptionMethod,'watch-service');
});
test('A service timeout keeps the existing fallback usable',{timeout:1000},async()=>{
 const result=await getTitleDetails(film,async url=>url.includes('justwatch')?json(listing([offer()])):url===apple?new Promise(()=>{}):url.includes('imdb.com/title/')?imdbPage():failure(),options);
 assert.equal(result.source,'IMDb');assert.equal(result.state,'ready');
});
test('Approved Paramount regional redirects are accepted while cross-service redirects are rejected',async()=>{
 const url='https://www.paramountplus.com/gb/shows/ncis/',input={title:'NCIS',type:'Series',imdbId:'tt0364845',officialUrl:url};
 for(const [target,expected] of [['https://www.intl.paramountplus.com/gb/shows/ncis/',true],['https://www.netflix.com/title/123',false]]){
  const result=await getTitleDetails(input,async endpoint=>endpoint===url?{...html(ld('NCIS','TVSeries','2003')),url:target}:failure(),options);
  assert.equal(result.descriptionMethod==='watch-service',expected);
 }
});
