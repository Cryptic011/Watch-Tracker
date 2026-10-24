import test from 'node:test';
import assert from 'node:assert/strict';
import {getTitleDetails,parseIMDbDetails} from '../supabase/functions/watchlog-pin/title-details.mjs';
const imdb='tt1375666',film={title:'Inception',type:'Film',imdbId:imdb,year:'2010'};
const ld=(fields={})=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Movie',url:'https://www.imdb.com/title/'+imdb+'/',description:'An IMDb synopsis.',datePublished:'2010-07-16',genre:['Action','Sci-Fi'],duration:'PT2H28M',aggregateRating:{ratingValue:8.8},...fields})+'</script>';
const json=value=>({ok:true,json:async()=>value});
const html=value=>({ok:true,text:async()=>value});
const failure=()=>({ok:false,status:503});
const options={useCache:false};
const suggestion={id:imdb,l:'Inception',y:2010,qid:'movie'};
const apple={trackId:1,kind:'feature-movie',trackName:'Inception',releaseDate:'2010-07-16',longDescription:'Apple film synopsis.',trackViewUrl:'https://tv.apple.com/gb/movie/inception/umc.test',trackTimeMillis:8880000,primaryGenreName:'Sci-Fi'};
test('IMDb is preferred and only structured data for the exact identity and format is accepted',async()=>{
 const calls=[],result=await getTitleDetails(film,async url=>{calls.push(url);return html(ld());},options);
 assert.equal(result.description,'An IMDb synopsis.');assert.equal(result.runtime,148);assert.equal(result.ratingSource,'IMDb');assert.equal(result.source,'IMDb');assert.equal(result.state,'ready');assert.deepEqual(calls,['https://www.imdb.com/title/'+imdb+'/']);
 assert.equal(parseIMDbDetails(ld({url:'https://www.imdb.com/title/tt9999999/'}),imdb,'Film'),null);
 assert.equal(parseIMDbDetails(ld({'@type':'TVSeries'}),imdb,'Film'),null);
 assert.equal(parseIMDbDetails(ld({url:'https://www.imdb.com.evil.example/title/'+imdb+'/'}),imdb,'Film'),null);
});
test('Series details never use TVMaze synopses or ratings when IMDb is unavailable',async()=>{
 const calls=[],result=await getTitleDetails({title:'Show',type:'Series',imdbId:'tt0903747',tvmazeShowId:'169'},async url=>{
  calls.push(url);if(url.includes('api.tvmaze.com'))throw Error('TVMaze must not be a details source');
  return failure();
 },options);
 assert.equal(result.description,undefined);assert.equal(result.rating,undefined);
 assert.equal(result.state,'unavailable');assert.deepEqual(result.sources,[]);
 assert.equal(result.imdbUrl,'https://www.imdb.com/title/tt0903747/');
 assert.equal(calls[0],'https://www.imdb.com/title/tt0903747/');
 assert.ok(!calls.some(url=>url.includes('tvmaze')));
});
test('A TVMaze response with the wrong IMDb ID cannot supply a same-name remake description',async()=>{
 const result=await getTitleDetails({title:'Twin',type:'Series',tvmazeShowId:'12',imdbId:'tt1111111'},async url=>url.includes('api.tvmaze.com')?json({id:12,name:'Twin',externals:{imdb:'tt2222222'},summary:'Wrong remake'}):failure(),options);
 assert.equal(result.description,undefined);assert.deepEqual(result.sources,[]);
});
test('Film fallback uses a unique Apple title/year checked against its exact IMDb identity',async()=>{
 const result=await getTitleDetails(film,async url=>url.includes('media-imdb')?json({d:[{...suggestion,id:'tt9999999',y:1999},suggestion]}):url.includes('itunes.apple')?json({results:[{...apple,trackId:2,releaseDate:'1999-01-01',longDescription:'Wrong year'},apple]}):failure(),options);
 assert.equal(result.description,'Apple film synopsis.');assert.equal(result.source,'Apple TV');assert.equal(result.year,'2010');assert.equal(result.runtime,148);assert.equal(result.imdbId,imdb);
});
function fallbackRequest({wrongIdentity=false,ambiguousApple=false}={}){
 return async raw=>{
  if(raw.includes('media-imdb'))return json({d:[suggestion]});
  if(raw.includes('itunes.apple'))return json({results:ambiguousApple?[apple,{...apple,trackId:2}]:[]});
  if(raw.includes('justwatch'))return json({data:{popularTitles:{edges:[{node:{objectType:'MOVIE',content:{title:'Inception',originalReleaseYear:2010,shortDescription:'JustWatch synopsis matched by IMDb ID.',externalIds:{imdbId:wrongIdentity?'tt9999999':imdb},fullPath:'/uk/movie/inception'}}}]}}});
  return failure();
 };
}
test('Ambiguous Apple matches are skipped and JustWatch requires the exact IMDb identity',async()=>{
 const result=await getTitleDetails(film,fallbackRequest({ambiguousApple:true}),options);
 assert.equal(result.description,'JustWatch synopsis matched by IMDb ID.');assert.equal(result.source,'JustWatch');assert.equal(result.sourceUrl,'https://www.justwatch.com/uk/movie/inception');assert.equal(result.imdbId,imdb);
});
test('An unrelated JustWatch title is rejected despite having the same name and year',async()=>{
 const result=await getTitleDetails(film,fallbackRequest({wrongIdentity:true}),options);
 assert.equal(result.description,undefined);assert.equal(result.state,'unavailable');assert.deepEqual(result.sources,[]);
});
test('Metadata never requests Wikimedia sources',async()=>{
 const calls=[];await getTitleDetails(film,async url=>{calls.push(url);return failure();},options);
 assert.ok(calls.length>0);assert.ok(calls.every(url=>!/(?:wikipedia|wikidata|wikimedia)\.org/i.test(url)));
});
test('Exact IMDb-linked fallback fills a missing series description without replacing IMDb ratings',async()=>{
 const calls=[],result=await getTitleDetails({title:'Series',type:'Series',imdbId:imdb,tvmazeShowId:'12'},async url=>{
  calls.push(url);
  if(url.includes('imdb.com/title'))return html(ld({'@type':'TVSeries',description:'',aggregateRating:{ratingValue:8.8}}));
  if(url.includes('justwatch'))return json({data:{popularTitles:{edges:[{node:{objectType:'SHOW',content:{
    title:'Series',originalReleaseYear:2010,shortDescription:'Exact-identity series synopsis.',
    externalIds:{imdbId:imdb},fullPath:'/uk/tv-series/series'}}}]}}});
  return failure();
 },options);
 assert.equal(result.description,'Exact-identity series synopsis.');
 assert.equal(result.descriptionSource,'JustWatch');assert.equal(result.rating,8.8);
 assert.equal(result.ratingSource,'IMDb');assert.deepEqual(result.sources.map(row=>row.name),['IMDb','JustWatch']);
 assert.ok(!calls.some(url=>url.includes('tvmaze')),'TVMaze must not be requested for an existing IMDb ID');
});
test('A selected TVMaze ID only resolves a matching IMDb identity, never its description',async()=>{
 const id='tt0903747',calls=[],input={title:'Show',type:'Series',tvmazeShowId:'169'};
 const result=await getTitleDetails(input,async url=>{
  calls.push(url);
  if(url.includes('media-imdb'))return failure();
  if(url.endsWith('/shows/169'))return json({id:169,name:'Show',premiered:'2020-01-01',externals:{imdb:id},
    summary:'TVMaze editorial text that must never appear',rating:{average:9.1}});
  if(url.endsWith('/title/'+id+'/'))return html('<script type="application/ld+json">'+JSON.stringify({
    '@type':'TVSeries',url:'https://www.imdb.com/title/'+id+'/',description:'The IMDb programme synopsis.',
    datePublished:'2020-01-01',aggregateRating:{ratingValue:8.1}})+'</script>');
  return failure();
 },options);
 assert.equal(result.imdbId,id);assert.equal(result.description,'The IMDb programme synopsis.');
 assert.equal(result.source,'IMDb');assert.equal(result.rating,8.1);
 assert.ok(calls.find(url=>url.includes('/shows/169')));
 assert.ok(!JSON.stringify(result).includes('TVMaze editorial'));
});
test('Outages are not cached and a later retry can recover',async()=>{
 const input={...film,imdbId:'tt0000001'},failed=await getTitleDetails(input,async()=>failure());
 assert.equal(failed.state,'unavailable');
 const recovered=await getTitleDetails(input,async()=>html(ld({url:'https://www.imdb.com/title/tt0000001/'})));
 assert.equal(recovered.description,'An IMDb synopsis.');
 const cached=await getTitleDetails(input,async()=>{throw Error('Should use cache');});assert.equal(cached.source,'IMDb');
});
test('Unsupported types never cause provider requests',async()=>{
 const result=await getTitleDetails({type:'Game',imdbId:imdb},()=>{throw Error('Unexpected request');},options);assert.equal(result.state,'unmatched');
});
