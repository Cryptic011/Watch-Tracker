import test from 'node:test';
import assert from 'node:assert/strict';
import {getTitleDetails,parseIMDbDetails,parseFirstPartyDetails} from '../supabase/functions/watchlog-pin/title-details.mjs';
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

test('CBS NCIS official About page wins over IMDb and keeps the IMDb rating as a fallback',async()=>{
 const calls=[],id='tt0364845',page='<html><head><title>About NCIS | CBS</title><meta property="og:title" content="About NCIS"><meta name="description" content="CBS official NCIS programme description covering the Navy investigators and their cases."></head><body><h1>About NCIS</h1></body></html>';
 const data=await getTitleDetails({title:'NCIS',type:'Series',tvmazeShowId:'60',imdbId:id,year:'2003'},async url=>{
  calls.push(url);
  if(url.includes('api.tvmaze.com'))return json({id:60,name:'NCIS',premiered:'2003-09-23',externals:{imdb:id},network:{name:'CBS'},officialSite:'https://www.cbs.com/shows/ncis/'});
  if(url==='https://www.cbs.com/shows/ncis/about/')return html(page);
  if(url.includes('/title/'+id+'/'))return html('<script type="application/ld+json">'+JSON.stringify({'@type':'TVSeries',url:'https://www.imdb.com/title/'+id+'/',description:'IMDb alternate description.',aggregateRating:{ratingValue:7.8}})+'</script>');
  return failure();
 },options);
 assert.equal(data.source,'CBS');assert.equal(data.descriptionSource,'CBS');
 assert.equal(data.description,'CBS official NCIS programme description covering the Navy investigators and their cases.');
 assert.equal(data.ratingSource,'IMDb');assert.equal(data.rating,7.8);
 assert.deepEqual(data.sources.map(x=>x.name),['CBS','IMDb']);
 assert.ok(calls.indexOf('https://www.cbs.com/shows/ncis/about/')<calls.indexOf('https://www.imdb.com/title/'+id+'/'));
});
test('Official film pages win over IMDb when a verified studio URL is supplied',async()=>{
 const url='https://www.paramountpictures.com/movies/example',id='tt1234567',calls=[];
 const data=await getTitleDetails({title:'Example',type:'Film',imdbId:id,officialUrl:url},async endpoint=>{
  calls.push(endpoint);
  if(endpoint===url)return html('<meta property="og:title" content="Example - Paramount Pictures"><meta property="og:description" content="Paramount Pictures official synopsis of Example and the international mission.">');
  if(endpoint.includes('/title/'))return html('<script type="application/ld+json">'+JSON.stringify({'@type':'Movie',url:'https://www.imdb.com/title/'+id+'/',description:'IMDb fallback.',aggregateRating:{ratingValue:7.1}})+'</script>');
  return failure();
 },options);
 assert.equal(data.source,'Paramount Pictures');assert.equal(data.rating,7.1);
 assert.equal(data.description,'Paramount Pictures official synopsis of Example and the international mission.');
 assert.deepEqual(calls,[url,'https://www.imdb.com/title/'+id+'/']);
});

test('An IMDb-matched film finds its real studio page without copying TMDb editorial text',async()=>{
 const id='tt1234567',site='https://www.paramountpictures.com/movies/example',calls=[];
 const data=await getTitleDetails({title:'Example',type:'Film',imdbId:id,year:'2025'},async(url,init)=>{
  calls.push(url);
  if(url.includes('api.themoviedb.org/3/find/')){
    assert.equal(init.headers.Authorization,'Bearer example-token');
    return json({movie_results:[{id:42,title:'Example',release_date:'2025-06-15',overview:'Not an official synopsis'}]});
  }
  if(url.endsWith('/movie/42'))return json({id:42,imdb_id:id,title:'Example',release_date:'2025-06-15',homepage:site,overview:'Not an official synopsis'});
  if(url===site)return html('<h1>Example</h1><meta property="og:description" content="This is the verified studio homepage summary for the film Example.">');
  return failure();
 },{useCache:false,tmdbToken:'example-token'});
 assert.equal(data.description,'This is the verified studio homepage summary for the film Example.');
 assert.equal(data.source,'Paramount Pictures');
 assert.ok(!JSON.stringify(data).includes('Not an official synopsis'));
 assert.ok(calls.indexOf(site)<calls.indexOf('https://www.imdb.com/title/'+id+'/'));
});
test('A homepage from the wrong movie or untrusted host cannot supply title details',async()=>{
 const called=[],id='tt1234567';
 const result=await getTitleDetails({title:'Example',type:'Film',imdbId:id,year:'2025'},async url=>{
  called.push(url);
  if(url.includes('api.themoviedb.org/3/find/'))return json({movie_results:[{id:42,title:'Example',release_date:'2025-06-15'}]});
  if(url.endsWith('/movie/42'))return json({id:42,imdb_id:'tt9999999',title:'Example',release_date:'2025-06-15',homepage:'https://www.paramountpictures.com/movies/example'});
  return failure();
 },{useCache:false,tmdbToken:'example-token'});
 assert.equal(result.description,undefined);
 assert.ok(!called.some(url=>url.includes('paramountpictures.com')),'a mismatched IMDb film never reaches the studio URL');
});

test('Official page content must match the exact title and be from a trusted broadcaster',async()=>{
 const page='<title>NCIS: Sydney on CBS</title><meta name="description" content="An unrelated official description about another NCIS show entirely.">';
 const info={title:'NCIS',type:'Series',year:'2003'};
 assert.equal(parseFirstPartyDetails(page,'https://www.cbs.com/shows/ncis-sydney/',info),null);
 assert.equal(parseFirstPartyDetails('<title>NCIS</title><meta name="description" content="A very detailed but untrusted synopsis from an aggregator.">','https://www.justwatch.com/tv/ncis',info),null);
 assert.equal(parseFirstPartyDetails('<title>NCIS</title><meta name="description" content="A very detailed but untrusted synopsis from an aggregator.">','http://www.cbs.com/shows/ncis/',info),null);
});



test('Season-specific official descriptions cannot populate whole-show details',async()=>{
 const season='<html><head><meta property="og:title" content="NCIS | CBS">'+
   '<meta name="description" content="In season 24, the team investigates a new mystery while Tony returns."></head>'+
   '<body><h1>NCIS</h1></body></html>';
 assert.equal(parseFirstPartyDetails(season,'https://www.cbs.com/shows/ncis/about/',{title:'NCIS',type:'Series',year:'2003'}),null);
 const episode='<meta property="og:title" content="NCIS | CBS">'+
   '<meta property="og:description" content="When Torres finds a mysterious clue, he follows an assassin in episode 3.">';
 assert.equal(parseFirstPartyDetails(episode,'https://www.cbs.com/shows/ncis/',{title:'NCIS',type:'Series'}),null);
 assert.equal(parseFirstPartyDetails('<h1>NCIS Season 24</h1><meta property="og:title" content="NCIS">'+
   '<meta name="description" content="A general-looking description meant for a specific season.">',
   'https://www.cbs.com/shows/ncis/',{title:'NCIS',type:'Series'}),null);
});
test('Season and episode URLs can never masquerade as programme or film overviews',()=>{
 const generic='<meta property="og:title" content="NCIS | CBS"><meta name="description" content="NCIS follows Naval Criminal Investigative Service agents worldwide.">';
 for(const url of [
   'https://www.cbs.com/shows/ncis/episodes/',
   'https://www.cbs.com/shows/ncis/season-24/',
   'https://www.cbs.com/shows/ncis/season/24/',
   'https://www.cbs.com/shows/ncis/episode-4/',
   'https://www.netflix.com/title/123/episodes/'
 ])assert.equal(parseFirstPartyDetails(generic,url,{title:'NCIS',type:'Series'}),null,url);
 const film='<meta property="og:title" content="Example - Paramount Pictures"><meta name="description" content="Example follows a fictional expedition through space and time.">';
 assert.equal(parseFirstPartyDetails(film,'https://www.paramountpictures.com/movies/example/trailers/',{title:'Example',type:'Film'}),null);
});
test('A show-level About paragraph takes priority over seasonal promotional metadata',()=>{
 const html='<title>NCIS | CBS</title><meta property="og:title" content="NCIS | CBS">'+
   '<meta property="og:description" content="Season 24 of NCIS features an action-packed special premiere.">'+
   '<h1>About NCIS</h1><p>NCIS follows an investigative team handling crimes involving the United States Navy and Marine Corps.</p>'+
   '<h2>Season 24</h2><p>Season 24 begins with a surprising new case.</p>';
 const details=parseFirstPartyDetails(html,'https://www.cbs.com/shows/ncis/about/',{title:'NCIS',type:'Series'});
 assert.equal(details?.description,'NCIS follows an investigative team handling crimes involving the United States Navy and Marine Corps.');
 assert.equal(details?.source,'CBS');
});
test('An overall release synopsis is retained when a season synopsis is rejected, with IMDb fallback',async()=>{
 const id='tt0364845',urls=[];
 const result=await getTitleDetails({title:'NCIS',type:'Series',imdbId:id,
  officialUrl:'https://www.cbs.com/shows/ncis/about/'},async url=>{
  urls.push(url);
  if(url.includes('cbs.com'))return html('<title>NCIS | CBS</title><meta name="description" content="Season 24 tells the story of an exciting new assignment.">');
  if(url.includes('/title/'+id+'/'))return html('<script type="application/ld+json">'+JSON.stringify({
   '@type':'TVSeries',url:'https://www.imdb.com/title/'+id+'/',
   description:'A team of special agents investigates criminal cases connected to Navy and Marine personnel.',
   aggregateRating:{ratingValue:7.9}})+'</script>');
  return failure();
 },options);
 assert.equal(result.source,'IMDb');
 assert.match(result.description,/team of special agents/);
 assert.ok(urls.indexOf('https://www.cbs.com/shows/ncis/about/')<urls.indexOf('https://www.imdb.com/title/'+id+'/'));
});
test('Official studio film metadata cannot use a trailer or sequel-specific plot',()=>{
 const site='https://www.paramountpictures.com/movies/example';
 const title={title:'Example',type:'Film'};
 assert.equal(parseFirstPartyDetails('<title>Example - Paramount Pictures</title>'+
 '<meta name="description" content="In the next episode, the hero returns to save his crew.">',site,title),null);
 assert.equal(parseFirstPartyDetails('<title>Example Part Two - Paramount Pictures</title>'+
 '<meta name="description" content="The second film follows a new expedition on another world.">',site,title),null);
});

test('Official page redirects to a third-party host are rejected before parsing',async()=>{
 const result=await getTitleDetails({title:'NCIS',type:'Series',imdbId:'tt0364845',
  officialUrl:'https://www.cbs.com/shows/ncis/about/'},async url=>{
  if(url.includes('cbs.com'))return{ok:true,url:'https://www.justwatch.com/tv/ncis',
    text:async()=>'<h1>NCIS</h1><meta name="description" content="A false source description on a redirected aggregator website.">'};
  return failure();
 },options);
 assert.equal(result.description,undefined);assert.deepEqual(result.sources,[]);
});

test('Series details never use TVMaze synopses or ratings when IMDb is unavailable',async()=>{
 const calls=[],result=await getTitleDetails({title:'Show',type:'Series',imdbId:'tt0903747',tvmazeShowId:'169'},async url=>{
  calls.push(url);if(url.includes('api.tvmaze.com'))throw Error('TVMaze must not be a details source');
  return failure();
 },options);
 assert.equal(result.description,undefined);assert.equal(result.rating,undefined);
 assert.equal(result.state,'unavailable');assert.deepEqual(result.sources,[]);
 assert.equal(result.imdbUrl,'https://www.imdb.com/title/tt0903747/');
 assert.deepEqual(calls,[
   'https://api.tvmaze.com/shows/169',
   'https://www.imdb.com/title/tt0903747/'
 ],'the series locator is tried first, then IMDb if no official page is available');
 assert.ok(calls.every(url=>!url.includes('justwatch')));
});
test('A TVMaze response with the wrong IMDb ID cannot supply a same-name remake description',async()=>{
 const result=await getTitleDetails({title:'Twin',type:'Series',tvmazeShowId:'12',imdbId:'tt1111111'},async url=>url.includes('api.tvmaze.com')?json({id:12,name:'Twin',externals:{imdb:'tt2222222'},summary:'Wrong remake'}):failure(),options);
 assert.equal(result.description,undefined);assert.deepEqual(result.sources,[]);
});
test('Film fallback uses a unique Apple title/year checked against its exact IMDb identity',async()=>{
 const result=await getTitleDetails({...film,platform:'Apple TV'},async url=>url.includes('media-imdb')?json({d:[{...suggestion,id:'tt9999999',y:1999},suggestion]}):url.includes('itunes.apple')?json({results:[{...apple,trackId:2,releaseDate:'1999-01-01',longDescription:'Wrong year'},apple]}):failure(),options);
 assert.equal(result.description,'Apple film synopsis.');assert.equal(result.source,'Apple TV');assert.equal(result.year,'2010');assert.equal(result.runtime,148);assert.equal(result.imdbId,imdb);
});
test('IMDb failure and ambiguous Apple listings never trigger aggregator descriptions',async()=>{
 const calls=[],request=async url=>{
  calls.push(url);
  if(url.includes('media-imdb'))return json({d:[suggestion]});
  if(url.includes('itunes.apple'))return json({results:[apple,{...apple,trackId:2}]});
  return failure();
 };
 const result=await getTitleDetails({...film,platform:'Apple TV'},request,options);
 assert.equal(result.description,undefined);
 assert.equal(result.state,'unavailable');
 assert.deepEqual(result.sources,[]);
 assert.equal(result.imdbId,imdb);
 assert.ok(calls.some(url=>url.includes('imdb.com/title')));
 assert.ok(calls.some(url=>url.includes('itunes.apple')));
 assert.ok(calls.every(url=>!/(justwatch|tvmaze|wikipedia|wikimedia|wikidata)/i.test(url)));
});
test('Series with an IMDb rating but no synopsis never borrow another provider description',async()=>{
 const calls=[],result=await getTitleDetails({title:'Series',type:'Series',imdbId:imdb,tvmazeShowId:'12'},async url=>{
  calls.push(url);
  if(url.includes('imdb.com/title'))return html(ld({'@type':'TVSeries',description:'',aggregateRating:{ratingValue:8.8}}));
  return failure();
 },options);
 assert.equal(result.description,'');
 assert.equal(result.state,'partial');
 assert.equal(result.source,'IMDb');
 assert.equal(result.rating,8.8);
 assert.equal(result.ratingSource,'IMDb');
 assert.deepEqual(result.sources.map(row=>row.name),['IMDb']);
 assert.ok(calls.includes('https://www.imdb.com/title/'+imdb+'/'));
 assert.ok(calls.every(url=>!url.includes('justwatch')));
});
test('Metadata never requests Wikimedia sources',async()=>{
 const calls=[];await getTitleDetails(film,async url=>{calls.push(url);return failure();},options);
 assert.ok(calls.length>0);assert.ok(calls.every(url=>!/(?:wikipedia|wikidata|wikimedia)\.org/i.test(url)));
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
