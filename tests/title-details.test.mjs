import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getTitleDetails,parseIMDbDetails,parseFirstPartyDetails} from '../supabase/functions/watchlog-pin/title-details.mjs';
const imdb='tt1375666',film={title:'Inception',type:'Film',imdbId:imdb,year:'2010'};
const ld=(fields={})=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Movie',url:'https://www.imdb.com/title/'+imdb+'/',description:'An IMDb synopsis.',datePublished:'2010-07-16',genre:['Action','Sci-Fi'],duration:'PT2H28M',aggregateRating:{ratingValue:8.8},...fields})+'</script>';
const json=value=>({ok:true,json:async()=>value});
const html=value=>({ok:true,text:async()=>value});
const failure=()=>({ok:false,status:503});
const options={useCache:false};
const suggestion={id:imdb,l:'Inception',y:2010,qid:'movie'};
const fixture=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const apple={trackId:1,kind:'feature-movie',trackName:'Inception',releaseDate:'2010-07-16',longDescription:'Apple film synopsis.',trackViewUrl:'https://tv.apple.com/gb/movie/inception/umc.test',trackTimeMillis:8880000,primaryGenreName:'Sci-Fi'};
test('Non-Apple films can recover through an exact Apple title and year',async()=>{
 const data=await getTitleDetails(film,async url=>url.includes('itunes.apple')?json({results:[apple]}):failure(),options);
 assert.equal(data.description,'Apple film synopsis.');assert.equal(data.source,'Apple TV');assert.equal(data.year,'2010');
});
test('An Apple lookup ID alone cannot substitute a different movie or remake',async()=>{
 for(const row of [{...apple,trackName:'Another film'},{...apple,releaseDate:'1999-01-01'}]){
  const data=await getTitleDetails({...film,source:'apple',externalId:'1'},async url=>url.includes('itunes.apple')?json({results:[row]}):failure(),options);
  assert.ok(!data.description);
 }
});
test('An empty UK catalogue can recover through a uniquely matching US listing',async()=>{
 const data=await getTitleDetails(film,async url=>url.includes('itunes.apple')?json({results:url.includes('country=us')?[apple]:[]}):failure(),options);
 assert.equal(data.source,'Apple TV');assert.equal(data.year,'2010');
});
test('Film fallback distinguishes Carrie remakes and the TV series by IMDb ID, title, year and format',async()=>{
 const row=(type,id,year)=>({node:{objectType:type,content:{title:'Carrie',originalReleaseYear:year,externalIds:{imdbId:id},fullPath:'/uk/movie/carrie-'+year,shortDescription:'A shy teenager discovers telekinetic powers and confronts the cruelty around her.'}}});
 const data=await getTitleDetails({title:'Carrie',type:'Film',imdbId:'tt1939659',year:'2013'},async url=>url.includes('justwatch')?json({data:{popularTitles:{edges:[row('MOVIE','tt0074285',1976),row('MOVIE','tt1939659',2013),row('SHOW','tt11540908',2026)]}}}):failure(),options);
 assert.equal(data.source,'JustWatch');assert.equal(data.year,'2013');assert.equal(data.imdbId,'tt1939659');assert.match(data.sources[0].url,/carrie-2013$/);
 for(const wrong of [row('SHOW','tt1939659',2013),row('MOVIE','tt0074285',2013),row('MOVIE','tt1939659',1976)]){
  const rejected=await getTitleDetails({title:'Carrie',type:'Film',imdbId:'tt1939659',year:'2013'},async url=>url.includes('justwatch')?json({data:{popularTitles:{edges:[wrong]}}}):failure(),options);
  assert.ok(!rejected.description);
 }
});
test('A stalled catalogue does not hold up a verified independent fallback',{timeout:2000},async()=>{
 const data=await getTitleDetails(film,async url=>url.includes('itunes.apple')?new Promise(()=>{}):url.includes('justwatch')?json({data:{popularTitles:{edges:[{node:{objectType:'MOVIE',content:{title:'Inception',originalReleaseYear:2010,externalIds:{imdbId:imdb},fullPath:'/uk/movie/inception',shortDescription:'A skilled thief enters dreams to steal secrets and must plant an idea instead.'}}}]}}}):failure(),options);
 assert.equal(data.source,'JustWatch');assert.equal(data.state,'ready');
});
test('A stalled IMDb page cannot hold a ready, identity-checked film fallback',{timeout:1000},async()=>{
 const result=await getTitleDetails(film,async url=>url.includes('imdb.com/title/')?new Promise(()=>{}):url.includes('itunes.apple')?json({results:[apple]}):failure(),options);
 assert.equal(result.source,'Apple TV');assert.equal(result.year,'2010');
});
test('Remaining provider requests are cancelled once a usable description is returned',async()=>{
 const pending=[];
 const result=await getTitleDetails(film,async(url,init)=>{
  if(url.includes('itunes.apple'))return json({results:[apple]});
  if(url.includes('imdb.com/title/')){pending.push(init.signal);return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}
  return failure();
 },options);
 assert.equal(result.source,'Apple TV');assert.ok(pending.length);assert.ok(pending.every(signal=>signal.aborted));
});
test('One verified studio response does not wait for unrelated studio requests',{timeout:1000},async()=>{
 const page='<script type="application/ld+json">'+JSON.stringify({'@type':'Movie',name:'Inception',datePublished:'2010-07-16',description:'A skilled thief enters dreams to steal secrets and must plant an idea instead.'})+'</script>';
 const result=await getTitleDetails(film,async url=>url.includes('warnerbros.com')?html(page):url.includes('movies.disney.com')?new Promise(()=>{}):failure(),options);
 assert.equal(result.source,'Warner Bros.');assert.equal(result.state,'ready');
});
test('A known film title/year does not wait for IMDb suggestions before searching Apple',{timeout:1000},async()=>{
 const result=await getTitleDetails({...film,imdbId:''},async url=>url.includes('media-imdb')?new Promise(()=>{}):url.includes('itunes.apple')?json({results:[apple]}):failure(),options);
 assert.equal(result.source,'Apple TV');assert.equal(result.year,'2010');
});
test('A film without a stored IMDb ID can still recover via its unique title and year',async()=>{
 const result=await getTitleDetails({...film,imdbId:''},async url=>url.includes('media-imdb')?json({d:[suggestion]}):url.includes('imdb.com/title/')?html(ld()):failure(),options);
 assert.equal(result.source,'IMDb');assert.equal(result.imdbId,imdb);assert.equal(result.description,'An IMDb synopsis.');
});
test('A supplied official series page does not depend on TVMaze availability',{timeout:1000},async()=>{
 const site='https://www.cbs.com/shows/ncis/about/';
 const result=await getTitleDetails({title:'NCIS',type:'Series',tvmazeShowId:'60',officialUrl:site},async url=>url.includes('api.tvmaze.com')?new Promise(()=>{}):url===site?html('<h1>About NCIS</h1><p>NCIS follows an investigative team handling crimes involving the United States Navy and Marine Corps.</p>'):failure(),options);
 assert.equal(result.source,'CBS');assert.equal(result.state,'ready');
});
test('A missing stored film year can be recovered from the exact IMDb-linked film record',async()=>{
 const row={node:{objectType:'MOVIE',content:{title:'Carrie',originalReleaseYear:2013,externalIds:{imdbId:'tt1939659'},fullPath:'/uk/movie/carrie-2013',shortDescription:'A shy teenager discovers telekinetic powers and confronts the cruelty around her.'}}};
 const result=await getTitleDetails({title:'Carrie',type:'Film',imdbId:'tt1939659'},async url=>url.includes('justwatch')?json({data:{popularTitles:{edges:[row]}}}):failure(),options);
 assert.equal(result.source,'JustWatch');assert.equal(result.year,'2013');assert.equal(result.imdbId,'tt1939659');
});
test('A slow season-count source cannot hold a ready TVMaze synopsis',{timeout:1000},async()=>{
 const result=await getTitleDetails({title:'Show',type:'Series',tvmazeShowId:'12'},async url=>url.endsWith('/seasons')?new Promise(()=>{}):json({id:12,name:'Show',summary:'<p>The full programme follows a team investigating mysterious events.</p>'}),options);
 assert.equal(result.source,'TVMaze');assert.equal(result.seasons,null);assert.equal(result.state,'ready');
});
test('An IMDb series fallback can answer while TVMaze is stalled',{timeout:1000},async()=>{
 const result=await getTitleDetails({title:'Inception',type:'Series',imdbId:imdb,tvmazeShowId:'12'},async url=>url.includes('api.tvmaze.com')?new Promise(()=>{}):url.includes('imdb.com/title/')?html(ld({'@type':'TVSeries'})):failure(),options);
 assert.equal(result.source,'IMDb');assert.equal(result.description,'An IMDb synopsis.');
});
test('A stalled official homepage cannot hide a verified TMDb film record',{timeout:1000},async()=>{
 const result=await getTitleDetails(film,async url=>url.includes('/find/')?json({movie_results:[{id:27205,title:'Inception',release_date:'2010-07-16'}]}):url.endsWith('/movie/27205')?json({id:27205,imdb_id:imdb,title:'Inception',release_date:'2010-07-16',homepage:'https://www.paramountpictures.com/movies/inception',overview:'A skilled thief enters dreams to steal secrets and must plant an idea instead.'}):url.includes('paramountpictures')?new Promise(()=>{}):failure(),{...options,tmdbToken:'test-token'});
 assert.equal(result.source,'TMDb');assert.equal(result.year,'2010');
});
test('An empty film database synopsis keeps a slower verified studio source available',async()=>{
 const site='https://www.paramountpictures.com/movies/inception';
 const result=await getTitleDetails(film,async url=>url.includes('/find/')?json({movie_results:[{id:27205,title:'Inception',release_date:'2010-07-16'}]}):url.endsWith('/movie/27205')?json({id:27205,imdb_id:imdb,title:'Inception',release_date:'2010-07-16',homepage:site,overview:''}):url===site?await new Promise(resolve=>setTimeout(()=>resolve(html('<h1>Inception</h1><meta property="og:description" content="A skilled thief enters dreams to steal secrets and must plant an idea instead.">')),180)):failure(),{...options,tmdbToken:'test-token'});
 assert.equal(result.source,'Paramount Pictures');assert.equal(result.state,'ready');
});
test('Disney film pages prefer the full synopsis over truncated SEO and recognise the release date',()=>{
 const title='Star Wars: The Mandalorian and Grogu',plot='An experienced bounty hunter and his young companion accept a dangerous mission for the New Republic.';
 const page='<h1>'+title+'</h1><script type="application/ld+json">'+JSON.stringify({'@type':'Movie',name:title,dateCreated:'2026-05-22',description:'A truncated teaser...'})+'</script><p class="desc">'+plot+'</p>';
 const data=parseFirstPartyDetails(page,'https://movies.disney.com/star-wars-the-mandalorian-and-grogu',{title,type:'Film',year:'2026',requireYear:true});
 assert.equal(data.description,plot);assert.equal(data.year,'2026');assert.equal(data.source,'Disney');
 assert.equal(parseFirstPartyDetails(page,'https://movies.disney.com/star-wars-the-mandalorian-and-grogu',{title,type:'Film',year:'2025',requireYear:true}),null);
});
test('Official franchise film pages cannot supply book plots or a different film year',()=>{
 const title='Harry Potter and the Chamber of Secrets',plot='Young friends return to their magical school and investigate a dangerous mystery threatening its students.';
 const page='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{pageData:{world:{heroTitle:title,heroDescription:plot,heroFootnote:'Released 2002 · Directed by Chris Columbus'}}}}})+'</script>';
 const url='https://www.harrypotter.com/discover/films/harry-potter-and-the-chamber-of-secrets';
 assert.equal(parseFirstPartyDetails(page,url,{title,type:'Film',year:'2002',requireYear:true}).description,plot);
 assert.equal(parseFirstPartyDetails(page,url.replace('/films/','/books/'),{title,type:'Film',year:'2002'}),null);
 assert.equal(parseFirstPartyDetails(page,url,{title,type:'Film',year:'2026',requireYear:true}),null);
});
test('An IMDb ID does not override a conflicting film name or release year',()=>{
 assert.equal(parseIMDbDetails(ld({name:'Another film'}),imdb,'Film',film),null);
 assert.equal(parseIMDbDetails(ld(),imdb,'Film',{...film,year:'1999'}),null);
});
test('A trusted domain and matching title cannot turn a TV series or book into a film',()=>{
 for(const kind of ['TVSeries','TVEpisode','Book']){
  const page='<meta property="og:title" content="Carrie"><script type="application/ld+json">'+JSON.stringify({'@type':kind,name:'Carrie',description:'A supernatural story about a young woman discovering unusual powers.'})+'</script>';
  assert.equal(parseFirstPartyDetails(page,'https://www.paramountpictures.com/movies/carrie',{title:'Carrie',type:'Film'}),null);
 }
});
test('An IMDb-matched film database record rescues a studio outage with explicit attribution',async()=>{
 const data=await getTitleDetails(film,async url=>url.includes('/find/')?json({movie_results:[{id:27205,title:'Inception',release_date:'2010-07-16'}]}):url.endsWith('/movie/27205')?json({id:27205,imdb_id:imdb,title:'Inception',release_date:'2010-07-16',overview:'A skilled thief enters dreams to steal secrets and must plant an idea instead.',runtime:148}):failure(),{...options,tmdbToken:'test-token'});
 assert.equal(data.source,'TMDb');assert.equal(data.descriptionSource,'TMDb');assert.equal(data.year,'2010');assert.equal(data.runtime,148);
});
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
 assert.deepEqual(calls,['https://www.imdb.com/title/'+id+'/',url]);
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
 assert.ok(calls.includes(site)&&calls.includes('https://www.imdb.com/title/'+id+'/'),'studio discovery and IMDb are both attempted');
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
test('The live CBS NCIS cast-return promo is rejected even without a season number',()=>{
 const site='https://www.cbs.com/shows/ncis/about/',input={title:'NCIS',type:'Series'};
 assert.equal(parseFirstPartyDetails(fixture('ncis-cbs-about.html'),site,input),null);
 const variants=['Michael Weatherly returns as Tony DiNozzo, joining the team as they tackle Navy crimes and personal challenges.',
  'Michael Weatherly is back as Tony DiNozzo as the investigators tackle a dangerous assignment.',
  'A returning actor reprises his role in a thrilling adventure for the whole team.'];
 for(const description of variants)assert.equal(parseFirstPartyDetails('<title>NCIS | CBS</title><meta name="description" content="'+description+'">',site,input),null);
});
test('The dedicated CBS About div wins over generic structured and SEO descriptions',()=>{
 const description='NCIS follows a team of investigators solving crimes connected to the Navy and Marine Corps.';
 const page='<title>NCIS | CBS</title><script type="application/ld+json">'+JSON.stringify({'@type':'TVSeries',name:'NCIS',description:'Investigators handle difficult cases.'})+'</script>'+
  '<h1>About NCIS</h1><div class="about__copy" id="js-about-copy">'+description+'</div>';
 assert.equal(parseFirstPartyDetails(page,'https://www.cbs.com/shows/ncis/about/',{title:'NCIS',type:'Series'}).description,description);
});
test('A distributor fallback uses the full matching series synopsis, never its teaser or cast list',async()=>{
 const urls=[],id='tt0364845',site='https://www.paramountglobalcontent.com/title/ncis',page=fixture('ncis-distributor.html');
 const result=await getTitleDetails({title:'NCIS',type:'Series',imdbId:id,year:'2003'},async url=>{
  urls.push(url);
  if(url.includes('api.tvmaze.com'))return json({id:60,name:'NCIS',premiered:'2003-09-23',externals:{imdb:id},network:{name:'CBS'},officialSite:'https://www.cbs.com/shows/ncis/'});
  if(url.includes('cbs.com'))return html(fixture('ncis-cbs-about.html'));
  if(url===site)return html(page);
  return failure();
 },options);
 assert.equal(result.source,'Paramount Global Content');assert.equal(result.descriptionSource,result.source);
 assert.match(result.description,/NCIS \(Naval Criminal Investigative Service\) follows a team/);
 assert.match(result.description,/crimes with Navy or Marine Corps ties\.$/);
 assert.doesNotMatch(result.description,/returns as|Show More|Show Less|\.\.\./);
 assert.equal(result.synopsisScope,'series');assert.equal(result.synopsisVersion,4);
 assert.equal(result.sources[0].url,site);
 assert.equal(parseFirstPartyDetails(page.replace('>NCIS</h2>','>NCIS: Sydney</h2>'),site,{title:'NCIS',type:'Series'}),null);
 assert.ok(urls.includes(site));
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

test('An official series page never substitutes the current-season publication date for the original premiere',async()=>{
 const id='tt0364845',cbs='https://www.cbs.com/shows/ncis/about/';
 const details=await getTitleDetails({title:'NCIS',type:'Series',imdbId:id,officialUrl:cbs},async url=>{
   if(url===cbs)return html('<h1>About NCIS</h1><script type="application/ld+json">'+JSON.stringify({
     '@type':'TVSeries',name:'NCIS',datePublished:'2026-10-06',numberOfSeasons:24,
     description:'A team of Navy investigators examines criminal cases involving military personnel.'})+'</script>');
   if(url.includes('/title/'))return html('<script type="application/ld+json">'+JSON.stringify({
     '@type':'TVSeries',url:'https://www.imdb.com/title/'+id+'/',datePublished:'2003-09-23',
     description:'An IMDb alternative about the agents.'})+'</script>');
   return failure();
 },options);
 assert.equal(details.source,'CBS');
 assert.equal(details.description,'A team of Navy investigators examines criminal cases involving military personnel.');
 assert.equal(details.seasons,24);
 assert.equal(details.premiered,'2003-09-23');
 assert.equal(details.year,'2003');
 assert.deepEqual(details.sources.map(row=>row.name),['CBS','IMDb']);
});
test('An explicit first-series start date is valid independent of the current-season publication date',()=>{
 const site='https://www.cbs.com/shows/ncis/about/';
 const structured='<h1>About NCIS</h1><script type="application/ld+json">'+JSON.stringify({
   '@type':'TVSeries',name:'NCIS',startDate:'2003-09-23',datePublished:'2026-10-06',numberOfSeasons:{value:24},
   description:'Investigators work together to investigate crimes involving naval personnel.'})+'</script>';
 const result=parseFirstPartyDetails(structured,site,{title:'NCIS',type:'Series',year:'2003'});
 assert.equal(result.premiered,'2003-09-23');
 assert.equal(result.year,'2003');
 assert.equal(result.seasons,24);
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

test('A TVMaze outage leaves series details unavailable when all fallbacks fail',async()=>{
 const calls=[],result=await getTitleDetails({title:'Show',type:'Series',imdbId:'tt0903747',tvmazeShowId:'169'},async url=>{
  calls.push(url);if(url.includes('api.tvmaze.com'))throw Error('TVMaze temporarily unavailable');
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
test('Ambiguous or unavailable fallbacks never substitute an unverified description',async()=>{
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
 assert.ok(calls.every(url=>!/(tvmaze|wikipedia|wikimedia|wikidata)/i.test(url)));
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
test('A selected TVMaze show supplies its overview and labelled rating before IMDb',async()=>{
 const id='tt0903747',calls=[],input={title:'Show',type:'Series',tvmazeShowId:'169'};
 const result=await getTitleDetails(input,async url=>{
  calls.push(url);
  if(url.includes('media-imdb'))return failure();
  if(url.endsWith('/shows/169'))return json({id:169,name:'Show',premiered:'2020-01-01',externals:{imdb:id},
    summary:'The TVMaze whole-series programme synopsis.',rating:{average:9.1}});
  if(url.endsWith('/title/'+id+'/'))return html('<script type="application/ld+json">'+JSON.stringify({
    '@type':'TVSeries',url:'https://www.imdb.com/title/'+id+'/',description:'The IMDb programme synopsis.',
    datePublished:'2020-01-01',aggregateRating:{ratingValue:8.1}})+'</script>');
  return failure();
 },options);
 assert.equal(result.imdbId,id);assert.equal(result.description,'The TVMaze whole-series programme synopsis.');
 assert.equal(result.source,'TVMaze');assert.equal(result.rating,9.1);assert.equal(result.ratingSource,'TVMaze');
 assert.ok(calls.find(url=>url.includes('/shows/169')));
 assert.ok(!calls.some(url=>url.includes('imdb.com/title')),'a complete TVMaze overview does not wait for IMDb');
});
test('TVMaze whole-show details work across Origins, Chicago Fire and other series',async()=>{
 for(const [title,maze,imdb,premiered] of [
  ['NCIS: Origins',73811,'tt30796986','2024-10-14'],['Chicago Fire',59,'tt2261391','2012-10-10'],
  ['NCIS',60,'tt0364845','2003-09-23'],['Chicago P.D.',56,'tt2805096','2014-01-08'],['NCIS: Sydney',60547,'tt18258908','2023-11-10']
 ]){
  const calls=[],show={id:maze,name:title,externals:{imdb},premiered,
   summary:'<p>A whole-show premise about <b>'+title+'</b>.</p><p>The team faces difficult decisions together.</p>',
   genres:['Drama'],language:'English',status:'Running',runtime:42,rating:{average:8.2}};
  const result=await getTitleDetails({title,type:'Series',tvmazeShowId:String(maze),imdbId:imdb,year:'2026'},async url=>{
   calls.push(url);return json(url.endsWith('/seasons')?[{number:0},{number:1},{number:2}]:show);
  },options);
  assert.equal(result.source,'TVMaze');assert.equal(result.premiered,premiered,'stored current-season years do not override the original premiere');
  assert.equal(result.seasons,2);assert.equal(result.ratingSource,'TVMaze');assert.equal(result.runtime,42);
  assert.match(result.description,/\n\nThe team/);assert.doesNotMatch(result.description,/<[^>]*>/);
  assert.deepEqual(calls,['https://api.tvmaze.com/shows/'+maze,'https://api.tvmaze.com/shows/'+maze+'/seasons']);
 }
});
test('TVMaze title-only discovery requires a unique exact title and matches the original year',async()=>{
 const make=(id,year)=>({id,name:'Twin',premiered:year+'-01-01',summary:'<p>A complete series synopsis about two families and their intertwined lives.</p>'});
 const lookup=rows=>async url=>url.includes('/search/shows')?json(rows.map(show=>({show}))):failure();
 const ambiguous=await getTitleDetails({title:'Twin',type:'Series'},lookup([make(1,'1990'),make(2,'2020')]),options);
 assert.equal(ambiguous.description,undefined);
 const selected=await getTitleDetails({title:'Twin',type:'Series',year:'2020'},lookup([make(1,'1990'),make(2,'2020')]),options);
 assert.equal(selected.source,'TVMaze');assert.equal(selected.year,'2020');assert.equal(selected.sources[0].url,'https://www.tvmaze.com/shows/2');
});
test('A season-list outage does not discard a usable TVMaze show synopsis',async()=>{
 const result=await getTitleDetails({title:'Show',type:'Series',tvmazeShowId:'12'},async url=>url.endsWith('/seasons')?failure():json({id:12,name:'Show',summary:'<p>The full programme follows a team investigating mysterious events.</p>'}),options);
 assert.equal(result.source,'TVMaze');assert.equal(result.state,'ready');assert.equal(result.seasons,null);
});
test('Outages are not cached and a later retry can recover',async()=>{
 const input={...film,imdbId:'tt0000001'},failed=await getTitleDetails(input,async()=>failure());
 assert.equal(failed.state,'unavailable');
 const recovered=await getTitleDetails(input,async()=>html(ld({url:'https://www.imdb.com/title/tt0000001/'})));
 assert.equal(recovered.description,'An IMDb synopsis.');
 const cached=await getTitleDetails(input,async()=>{throw Error('Should use cache');});assert.equal(cached.source,'IMDb');
});
test('IMDb title IDs and types do not exempt season or episode synopses from whole-title validation',()=>{
 for(const description of [
  'Season 24 follows the team as a new case threatens their most important investigation.',
  'The third episode follows a witness whose evidence changes the entire investigation.',
  'Episode Three reveals a clue that brings the agents closer to the missing investigator.',
  'Watch the latest trailer for this exciting new adventure in cinemas everywhere.'
 ]){
  const result=parseIMDbDetails(ld({description}),imdb,'Film');
  assert.equal(result.description,'');
  assert.equal(result.descriptionSource,'');
  assert.equal(result.ratingSource,'IMDb','verified non-synopsis facts remain available');
 }
 const synopsis='A boy befriends an alien.';
 assert.equal(parseIMDbDetails(ld({description:synopsis}),imdb,'Film').description,synopsis,'short verified whole-film synopses remain valid');
});

test('A named season or episode page cannot supply a series overview through generic metadata',()=>{
 const info={title:'NCIS',type:'Series'};
 const description='A team of naval investigators works together to solve military crimes.';
 for(const heading of ['NCIS Season One','NCIS Episode Three','NCIS: The third episode']){
  assert.equal(parseFirstPartyDetails('<title>NCIS | CBS</title><h1>'+heading+'</h1><meta name="description" content="'+description+'">','https://www.cbs.com/shows/ncis/',info),null);
 }
 assert.equal(parseFirstPartyDetails('<title>NCIS | CBS</title><h1>NCIS</h1><meta name="description" content="'+description+'">','https://www.cbs.com/shows/ncis/season-one/',info),null);
});

test('Apple descriptions reject trailers and episode summaries rather than displaying them as film plots',async()=>{
 for(const description of [
  'Watch the latest trailer for an exciting mission across the galaxy.',
  'In episode three the hero discovers the missing passenger and changes course.'
 ]){
  const result=await getTitleDetails({...film,source:'apple',externalId:'1'},async url=>{
   if(url.includes('itunes.apple'))return json({results:[{...apple,longDescription:description}]});
   return failure();
  },options);
  assert.ok(!result.description);
  assert.ok(!result.descriptionSource);
 }
});

test('An explicitly supplied Wikipedia URL is rejected before any source request',async()=>{
 const calls=[];
 const result=await getTitleDetails({...film,officialUrl:'https://en.wikipedia.org/wiki/Inception'},async url=>{
  calls.push(url);return url.includes('www.imdb.com/title/')?html(ld()):failure();
 },options);
 assert.equal(result.description,'An IMDb synopsis.');
 assert.ok(calls.every(url=>!/(wikipedia|wikidata|wikimedia)/i.test(url)));
});

test('Unsupported types never cause provider requests',async()=>{
 const result=await getTitleDetails({type:'Game',imdbId:imdb},()=>{throw Error('Unexpected request');},options);assert.equal(result.state,'unmatched');
});
