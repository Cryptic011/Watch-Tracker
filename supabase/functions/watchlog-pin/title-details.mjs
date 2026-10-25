/* Public metadata only. A provider must match the selected identity before use. */
const cache=new Map(),inFlight=new Map(),TTL=6*60*60*1000;
const SYNOPSIS_VERSION=4;
const clean=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi,(all,decimal,hex,name)=>{
  if(name)return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[name.toLowerCase()];
  const n=parseInt(decimal||hex,decimal?10:16);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
}).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const nameKey=value=>clean(value).replace(/&/g,' and ').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const imdbID=value=>/^tt\d{5,12}$/.test(String(value||''))?String(value):'';
const numericID=value=>/^\d{1,10}$/.test(String(value||''))?String(value):'';
const yearOf=value=>/^\d{4}/.test(String(value||''))?String(value).slice(0,4):'';
const text=value=>clean(value).slice(0,8000);
const imdbURL=id=>'https://www.imdb.com/title/'+id+'/';
function record(fields,name,url){return {...fields,source:name,sourceUrl:url,sources:[{name,url}],descriptionSource:fields.description?name:'',ratingSource:fields.rating?name:''};}

/* Exact first-party platform domains. Metadata from third-party aggregators
   and arbitrary URLs must never be treated as official broadcaster content. */
const FIRST_PARTY=new Map(Object.entries({
 "cbs.com":"CBS","paramountplus.com":"Paramount+","nbc.com":"NBC","abc.com":"ABC",
 "fox.com":"FOX","fxnetworks.com":"FX","hbo.com":"HBO","max.com":"Max",
 "disneyplus.com":"Disney+","disney.com":"Disney","hulu.com":"Hulu",
 "netflix.com":"Netflix","primevideo.com":"Prime Video","tv.apple.com":"Apple TV",
 "peacocktv.com":"Peacock","starz.com":"STARZ","showtime.com":"Showtime",
 "amc.com":"AMC","amcplus.com":"AMC+","thecw.com":"The CW","pbs.org":"PBS",
 "bbc.co.uk":"BBC","bbc.com":"BBC","itv.com":"ITV","itvx.com":"ITVX",
 "channel4.com":"Channel 4","sky.com":"Sky","nowtv.com":"NOW",
 "crunchyroll.com":"Crunchyroll","aetv.com":"A&E","freeform.com":"Freeform",
 "adultswim.com":"Adult Swim","usanetwork.com":"USA Network","bet.com":"BET",
 "warnerbros.com":"Warner Bros.","universalpictures.com":"Universal",
 "paramountpictures.com":"Paramount Pictures","sonypictures.com":"Sony Pictures",
 "20thcenturystudios.com":"20th Century Studios","marvel.com":"Marvel",
 "lionsgate.com":"Lionsgate","focusfeatures.com":"Focus Features",
 "discoveryplus.com":"Discovery+","tntdrama.com":"TNT","tbs.com":"TBS",
 "paramountglobalcontent.com":"Paramount Global Content",
 "paramountpressexpress.com":"Paramount Press Express",
 "media.netflix.com":"Netflix Media Center",
 "movies.disney.com":"Disney","starwars.com":"Star Wars","lucasfilm.com":"Lucasfilm",
 "mgm.com":"MGM","amazonmgmstudios.com":"Amazon MGM Studios","searchlightpictures.com":"Searchlight Pictures","harrypotter.com":"Harry Potter"
}));
function isIndividualReleasePath(path){
 const segments=String(path||"").toLowerCase().split("/").filter(Boolean);
 // A network's /shows/title/ homepage or /about/ page is series-level.
 // Episode/season pages, clips and trailers are not overview sources.
 return segments.some((segment,i)=>/^(?:episodes?|seasons?|clips?|videos?|trailers?|episode-guide|episodeguide|season-[0-9]+|season_[0-9]+|s[0-9]+e[0-9]+|s[0-9]+)$/.test(segment)
   ||(/^s[0-9]+$/.test(segment)&&/^e[0-9]+$/.test(segments[i+1]||""))
   ||/^(?:episode|season)[-_]?[0-9]+/.test(segment)
   ||/^(?:episode|season)[-_](?:one|two|three|four|five|six|seven|eight|nine|ten)(?:[-_]|$)/.test(segment));
}
function isReleaseSpecificText(value){
 return /\b(?:(?:season|episode)\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)|s\d+\s*e\d+)\b/i.test(value)
   ||/\b(?:this|new|current|upcoming|latest|next|final|previous|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/i.test(value)
   ||/\b(?:the|this|next|latest|new|previous|upcoming|final|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+episode\b/i.test(value)
   ||/\b(?:season|episode)\s+(?:premiere|finale|recap|guide|trailer)\b/i.test(value);
}
function isWholeTitleSynopsis(value,minimumLength=35){
 const description=text(value);
 if(description.length<minimumLength)return false;
 // Do not pass plot or press text about a specific season or episode
 // through the overall Show/Film Details panel.
 if(isReleaseSpecificText(description))return false;
 // Cast announcements and returning-character promos can describe the current
 // run without saying "season" anywhere (including CBS's NCIS SEO copy).
 if(/\b(?:returns?\s+as|(?:is\s+)?back\s+as|reprises?\s+(?:(?:his|her|their|the)\s+)?role|joins?\s+the\s+cast|guest[- ]stars?|guest[- ]starring)\b/i.test(description))return false;
 if(/^\s*(?:watch|stream|new episodes|all episodes|trailer|preview|recap)\b/i.test(description))return false;
 return true;
}
function aboutPageDescription(markup,title){
 const source=String(markup||""),expected="about "+nameKey(title);
 for(const heading of source.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)){
   if(nameKey(heading[2])!==expected)continue;
   const after=source.slice(heading.index+heading[0].length).split(/<(?:h[1-4]|footer|nav)\b/i)[0].slice(0,7000);
   // CBS renders its About copy in a div, not a paragraph. Only read the
   // dedicated copy container beneath this title's exact About heading.
   const copy=after.match(/<div\b[^>]*\bid\s*=\s*["']js-about-copy["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1];
   if(copy&&isWholeTitleSynopsis(copy))return text(copy);
   for(const p of after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)){
     const description=text(p[1]);
     if(isWholeTitleSynopsis(description))return description;
   }
 }
 return "";
}
function distributorDescription(markup,site,title){
 if(site.host!=="paramountglobalcontent.com")return "";
 const headings=[...markup.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]\s*>/gi)].map(row=>nameKey(row[1]));
 if(!headings.includes(nameKey(title)))return "";
 // The distributor has a truncated teaser and a separate full synopsis. Do
 // not import cast lists, footer text, or the "Show More" control.
 const body=markup.match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bfull-synopsis\b[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1];
 const paragraphs=[...(body||"").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(row=>text(row[1])).filter(Boolean);
 const description=paragraphs.join("\n\n");
 return isWholeTitleSynopsis(description)?description:"";
}
function firstPartyURL(value){
 try{
   const u=new URL(String(value||""));
   if(u.protocol!=="https:"||u.username||u.password||u.port)return null;
   const host=u.hostname.toLowerCase().replace(/^www\./,""),name=FIRST_PARTY.get(host);
   if(!name||/\/(?:books|games)(?:\/|$)/i.test(u.pathname)||isIndividualReleasePath(u.pathname)||/\/(?:login|sign-in|signin|account|register|search)(?:\/|$)/i.test(u.pathname))return null;
   u.hash="";return{url:u.href,name,host};
 }catch{return null;}
}
function matchesFirstPartyTitle(value,title){
 const expect=nameKey(title),actual=nameKey(value);
 if(!expect||!actual)return false;
 if(actual===expect)return true;
 const stripped=actual.replace(/^(?:watch now|official site|the series|watch|stream|about)\s+/,"");
 if(stripped===expect)return true;
 return [actual,stripped].some(a=>a.startsWith(expect)&&/^(?: on | official | watch | streaming | tv | series | show | movie | film | netflix | cbs | nbc | abc | disney | paramount | apple | bbc | hbo )/.test(a.slice(expect.length)));
}
export function parseFirstPartyDetails(markup,url,{title,type,year,requireYear=false}={}){
 const site=firstPartyURL(url);if(!site||!title||!["Film","Series"].includes(type))return null;
 const source=String(markup||"");if(source.length>2000000)return null;
 const tags=new Map();
 for(const tag of source.match(/<meta\b[^>]*>/gi)||[]){
   const attrs={};
   for(const match of tag.matchAll(/([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))attrs[match[1].toLowerCase()]=match[2]??match[3]??"";
   const key=String(attrs.property||attrs.name||"").toLowerCase();
   if(key&&attrs.content&&!tags.has(key))tags.set(key,clean(attrs.content));
 }
 const titleTag=clean(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
 const heading=clean(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
 const distributorTitle=site.host==="paramountglobalcontent.com"?clean(source.match(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i)?.[1]):"";
 const titles=[tags.get("og:title"),tags.get("twitter:title"),titleTag,heading,distributorTitle].filter(Boolean);
 const structured=[];
 for(const match of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
  try{const json=JSON.parse(match[1]);for(const row of Array.isArray(json)?json:[json]){
   structured.push(row);if(Array.isArray(row?.["@graph"]))structured.push(...row["@graph"]);
  }}catch{}
 }
 let filmHero=null;
 if(type==='Film'&&site.host==='harrypotter.com'&&new URL(site.url).pathname.startsWith('/discover/films/')){
   const next=source.match(/<script\b[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
   try{const hero=JSON.parse(next?.[1]||'null')?.props?.pageProps?.pageData?.world;
     if(hero&&nameKey(hero.heroTitle)===nameKey(title))filmHero=hero;
   }catch{}
 }
 // Require a programme-wide title match. A homepage's generic OG title
 // cannot validate an <h1> that actually names an individual season/episode.
 const pageHeadings=[...source.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)]
   .map(row=>clean(row[1])).filter(Boolean);
 if(pageHeadings.length===1&&isReleaseSpecificText(pageHeadings[0]))return null;
 const types=type==="Film"?["Movie"]:["TVSeries","TVMiniSeries","TVShow"];
 const candidates=structured.filter(row=>[row?.["@type"]].flat().some(kind=>types.includes(kind))&&matchesFirstPartyTitle(row.name,title));
 const identity=candidates.length===1?candidates[0]:null;
 const wrongFormats=structured.filter(row=>matchesFirstPartyTitle(row?.name,title)&&[row?.['@type']].flat().some(kind=>['Movie','TVSeries','TVMiniSeries','TVShow','TVEpisode','TVSeason','Book','VideoGame'].includes(kind)));
 if(!candidates.length&&wrongFormats.length)return null;
 if(!identity&&!filmHero&&!titles.some(name=>matchesFirstPartyTitle(name,title)))return null;
 // A series page's publication date can refer to its CURRENT SEASON.
 // Only an explicit programme startDate can establish the series premiere;
 // otherwise IMDb may fill the overall show's original premiere date.
 const published=String((type==="Series"?identity?.startDate:(identity?.datePublished||(site.host==='movies.disney.com'?identity?.dateCreated:'')))||""),publishedYear=yearOf(published)||String(filmHero?.heroFootnote||'').match(/Released\s+(\d{4})/)?.[1]||'';
 if(year&&publishedYear&&String(year)!==publishedYear)return null;
 if(requireYear&&year&&!publishedYear)return null;
 const count=Number(typeof identity?.numberOfSeasons==="object"?identity.numberOfSeasons?.value:identity?.numberOfSeasons);
 const seasons=type==="Series"&&Number.isInteger(count)&&count>0&&count<=300?count:null;
 const filmCopy=type==='Film'&&site.host==='movies.disney.com'?[...source.matchAll(/<p\b[^>]*class\s*=\s*["'][^"']*\bdesc\b[^"']*["'][^>]*>([\s\S]*?)<\/p\s*>/gi)].map(row=>text(row[1])):[];
 const descriptions=[
   filmHero?.heroDescription,
   filmCopy.length===1?filmCopy[0]:"",
   distributorDescription(source,site,title),
   aboutPageDescription(source,title),
   identity?.description,
   tags.get("og:description"),
   tags.get("description"),
   tags.get("twitter:description")
 ];
 const description=descriptions.map(value=>text(value)).find(value=>isWholeTitleSynopsis(value))||"";
 if(!description)return null;
 return record({description,year:publishedYear,seasons,
  premiered:/^\d{4}-\d{2}-\d{2}$/.test(published)?published:"",
  genres:[identity?.genre||[]].flat().filter(x=>typeof x==="string").map(clean).slice(0,15)
 },site.name,site.url);
}

export function parseIMDbDetails(html,id,type,selected={}){
  const rows=[];
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
    try{const data=JSON.parse(match[1]);for(const row of Array.isArray(data)?data:[data]){rows.push(row);if(Array.isArray(row?.['@graph']))rows.push(...row['@graph']);}}catch{}
  }
  const matches=rows.filter(row=>{
    const types=[row?.['@type']].flat();if(!types.includes(type==='Film'?'Movie':'TVSeries')&&! (type==='Series'&&types.includes('TVMiniSeries')))return false;
    try{const url=new URL(row.url||row['@id']);return /^(www\.)?imdb\.com$/.test(url.hostname)&&url.protocol==='https:'&&url.pathname.replace(/\/$/,'')==='/title/'+id;}catch{return false;}
  });
  if(matches.length!==1)return null;
  const row=matches[0],duration=String(row.duration||'').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/),rating=Number(row.aggregateRating?.ratingValue);
  if(selected.title&&row.name&&nameKey(row.name)!==nameKey(selected.title))return null;
  if(type==='Film'&&selected.year&&yearOf(row.datePublished)&&selected.year!==yearOf(row.datePublished))return null;
  return record({description:isWholeTitleSynopsis(row.description,1)?text(row.description):"",premiered:/^\d{4}-\d{2}-\d{2}$/.test(row.datePublished||'')?row.datePublished:'',year:yearOf(row.datePublished),genres:[row.genre||[]].flat().filter(v=>typeof v==='string').map(clean).slice(0,15),runtime:duration?Number(duration[1]||0)*60+Number(duration[2]||0)||null:null,rating:Number.isFinite(rating)&&rating>0&&rating<=10?rating:null},'IMDb',imdbURL(id));
}
export async function getTitleDetails(input,request=fetch,{useCache=true,tmdbToken=""}={}){
  const type=input.type==='Film'?'Film':input.type==='Series'?'Series':null;
  if(!type)return {state:'unmatched',sources:[]};
  const selected={type,title:clean(input.title).slice(0,160),year:yearOf(input.year||input.releaseYear),imdbId:imdbID(input.imdbId),tvmazeId:numericID(input.tvmazeShowId||input.tvmazeId),appleId:input.source==='apple'?numericID(input.externalId):'',platform:clean(input.platform).slice(0,80),officialUrl:firstPartyURL(input.officialUrl||input.officialSite)?.url||''};
  const key=JSON.stringify(selected),cached=cache.get(key);
  if(useCache&&cached?.expires>Date.now())return structuredClone(cached.value);
  if(useCache&&inFlight.has(key))return structuredClone(await inFlight.get(key));
  const task=resolveDetails(selected,request,tmdbToken);
  if(useCache)inFlight.set(key,task);
  try{
    const value=await task;
    if(useCache&&value.state==='ready'&&value.description){if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+TTL});}
    return structuredClone(value);
  }finally{if(inFlight.get(key)===task)inFlight.delete(key);}
}
async function resolveDetails(selected,request,tmdbToken=""){
  const deadline=Date.now()+16000;
  const get=async(url,asText=false,init={})=>{
    const remaining=deadline-Date.now();if(remaining<100)throw Error('Details deadline reached');
    const response=await request(url,{...init,signal:AbortSignal.timeout(Math.min(7000,remaining)),headers:{'User-Agent':'WatchedLogger/1.0 (title metadata)','Accept':asText?'text/html':'application/json',...(init.headers||{})}});
    if(!response.ok)throw Error('Metadata source unavailable');
    // Never follow a platform redirect to a third-party or unrelated host
    // and continue to attribute the HTML to the original broadcaster.
    if(asText&&firstPartyURL(url)&&response.url){
      const initial=firstPartyURL(url),final=firstPartyURL(response.url);
      if(!final||final.host!==initial.host)throw Error('Unofficial redirect rejected');
    }
    return asText?response.text():response.json();
  };
  const attempt=async task=>{try{return await task();}catch{return null;}};
  // Series use TVMaze's show-level record, never an episode or season summary.
  // Film overviews retain the existing studio/IMDb lookup.
  let id=selected.imdbId,canonical=null,identityTask=null;
  let imdbTask=null;
  const loadIMDb=()=>imdbTask||(imdbTask=attempt(async()=>parseIMDbDetails(await get(imdbURL(id),true),id,selected.type,selected)));
  // Start the preferred film source while independent studio discovery runs.
  if(selected.type==='Film'&&id)loadIMDb();
  const identity=()=>identityTask||(identityTask=attempt(async()=>{
    if(!selected.title&&!id)return null;
    const data=await get('https://v3.sg.media-imdb.com/suggestion/titles/x/'+encodeURIComponent(id||selected.title.toLowerCase())+'.json');
    const matches=(Array.isArray(data.d)?data.d:[]).filter(row=>{
      const series=/series|miniseries/i.test(String(row.qid||row.q||'')),film=/feature|movie|short|documentary/i.test(String(row.qid||row.q||''));
      if(!imdbID(row.id)||(selected.type==='Series'?!series:!film||series))return false;
      return id?row.id===id&&(!selected.title||nameKey(row.l)===nameKey(selected.title))&&(!selected.year||String(row.y)===selected.year):Boolean(selected.year)&&nameKey(row.l)===nameKey(selected.title)&&String(row.y)===selected.year;
    });
    if(matches.length!==1){if(id&&(data.d||[]).some(row=>row.id===id))id='';return null;}
    canonical={title:clean(matches[0].l),year:yearOf(matches[0].y)};id=matches[0].id;return canonical;
  }));
  let seriesDetails=null;
  const pages=[];
  if(selected.officialUrl)pages.push(selected.officialUrl);
  if(selected.type==='Series')await attempt(async()=>{
    const url=selected.tvmazeId?'https://api.tvmaze.com/shows/'+selected.tvmazeId:id?
      'https://api.tvmaze.com/lookup/shows?imdb='+encodeURIComponent(id):
      'https://api.tvmaze.com/search/shows?q='+encodeURIComponent(selected.title);
    const data=await get(url);
    const matches=Array.isArray(data)?data.map(row=>row.show).filter(show=>nameKey(show?.name)===nameKey(selected.title)&&(!selected.year||yearOf(show?.premiered)===selected.year)):[];
    const show=Array.isArray(data)?matches.length===1?matches[0]:null:data;
    if(!show?.id||(selected.tvmazeId&&String(show.id)!==selected.tvmazeId)||
      (id&&show.externals?.imdb&&show.externals.imdb!==id)||
      !matchesFirstPartyTitle(show.name,selected.title)||
      (!selected.tvmazeId&&!id&&selected.year&&yearOf(show.premiered)&&yearOf(show.premiered)!==selected.year))return null;
    if(!id)id=imdbID(show.externals?.imdb);
    const description=String(show.summary||'').split(/<\/p\s*>/i).map(text).filter(Boolean).join('\n\n');
    if(description&&isWholeTitleSynopsis(description,1)){
      const seasons=await attempt(()=>get('https://api.tvmaze.com/shows/'+show.id+'/seasons'));
      seriesDetails=record({description,premiered:/^\d{4}-\d{2}-\d{2}$/.test(show.premiered||'')?show.premiered:'',
        year:yearOf(show.premiered),genres:Array.isArray(show.genres)?show.genres.map(clean):[],
        status:clean(show.status),language:clean(show.language),runtime:Number(show.averageRuntime||show.runtime)||null,
        rating:typeof show.rating?.average==='number'?show.rating.average:null,
        seasons:Array.isArray(seasons)?seasons.filter(row=>Number(row.number)>0).length:null
      },'TVMaze','https://www.tvmaze.com/shows/'+show.id);
      return show;
    }
    if(firstPartyURL(show.officialSite))pages.push(show.officialSite);
    // CBS has a separate verified About page with its full programme synopsis.
    if(nameKey(show.network?.name)==='cbs'||nameKey(show.webChannel?.name)==='cbs'){
      const slug=clean(show.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if(slug){
        pages.unshift('https://www.cbs.com/shows/'+slug+'/about/');
        // The CBS page may contain only current-run promotional copy. The
        // programme distributor publishes a separate series-wide synopsis.
        pages.push('https://www.paramountglobalcontent.com/title/'+slug);
      }
    }
    return show;
  });
  if(seriesDetails)return {...seriesDetails,synopsisVersion:SYNOPSIS_VERSION,synopsisScope:'series',imdbId:id,imdbUrl:id?imdbURL(id):'',state:'ready'};
  // Cross-check the exact IMDb identity, film title and year. The studio
  // homepage takes priority; an attributed film record can rescue outages.
  let filmDatabaseDetails=null;
  const filmDatabaseTask=selected.type==='Film'&&tmdbToken?attempt(async()=>{
    if(!id)await identity();
    if(!id)return null;
      const authorization={headers:{Authorization:'Bearer '+tmdbToken}};
      const hits=await get('https://api.themoviedb.org/3/find/'+encodeURIComponent(id)+'?external_source=imdb_id',false,authorization);
      const found=(Array.isArray(hits.movie_results)?hits.movie_results:[]).filter(movie=>
        Number.isInteger(Number(movie?.id))&&Number(movie.id)>0&&
        nameKey(movie.title||movie.original_title)===nameKey(selected.title)&&
        (!selected.year||yearOf(movie.release_date)===selected.year));
      if(found.length!==1)return null;
      const movie=await get('https://api.themoviedb.org/3/movie/'+Number(found[0].id),false,authorization);
      if(imdbID(movie?.imdb_id)!==id||nameKey(movie.title||movie.original_title)!==nameKey(selected.title)||
        (selected.year&&yearOf(movie.release_date)!==selected.year))return null;
      filmDatabaseDetails=record({description:isWholeTitleSynopsis(movie.overview)?text(movie.overview):"",
        premiered:String(movie.release_date||''),year:yearOf(movie.release_date),
        genres:(Array.isArray(movie.genres)?movie.genres:[]).map(row=>clean(row.name)).filter(Boolean),
        runtime:Number(movie.runtime)||null,status:clean(movie.status),language:clean(movie.original_language)
      },'TMDb','https://www.themoviedb.org/movie/'+Number(movie.id));
      const homepage=firstPartyURL(movie.homepage);
      if(homepage){
        const studio=await attempt(async()=>parseFirstPartyDetails(await get(homepage.url,true),homepage.url,selected));
        if(studio)return studio;
      }
      return filmDatabaseDetails;
  }):null;
  let result=null;
  for(const candidate of [...new Set(pages)].slice(0,3)){
    const site=firstPartyURL(candidate);if(!site)continue;
    const firstParty=await attempt(async()=>{
      const contents=await get(site.url,true);
      return parseFirstPartyDetails(contents,site.url,selected);
    });
    if(firstParty){result=firstParty;break;}
  }
  const add=details=>{
    if(!details)return;
    if(!result){result=details;return;}
    let used=false;
    for(const field of ['description','premiered','year','genres','status','rating','runtime','language','seasons']){
      if((!result[field]||(Array.isArray(result[field])&&!result[field].length))&&details[field]){result[field]=details[field];used=true;if(field==='description')result.descriptionSource=details.descriptionSource||details.source;if(field==='rating')result.ratingSource=details.ratingSource||details.source;}
    }
    if(used)for(const source of details.sources||[])if(!result.sources.some(row=>row.url===source.url))result.sources.push(source);
  };
  // IMDb remains the preferred film source. A store listing is also a valid
  // fallback for non-Apple films, but only for the exact title and release year.
  if(!id)await attempt(identity);
  const preferredIMDb=id?loadIMDb():null;
  // Give a quick preferred response a brief head start before fanning out.
  if(!result?.description&&preferredIMDb){
    let timer;
    const quick=await Promise.race([preferredIMDb,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),120);})]);
    clearTimeout(timer);add(quick);
  }
  const fallbackTasks=filmDatabaseTask?[filmDatabaseTask]:[];
  if(!result?.description&&selected.type==='Film')fallbackTasks.push(attempt(async()=>{
    const match=await attempt(identity);
    const title=match?.title||selected.title,year=match?.year||selected.year;
    if(!title||!year)return null; // A title alone cannot distinguish remakes.
    for(const country of ['gb','us']){
      const url=selected.appleId?'https://itunes.apple.com/lookup?id='+selected.appleId+'&country='+country:
        'https://itunes.apple.com/search?term='+encodeURIComponent(title)+'&country='+country+'&media=movie&entity=movie&limit=40';
      const data=await attempt(()=>get(url));
      if(!Array.isArray(data?.results))continue;
      const matches=data.results.filter(row=>row.kind==='feature-movie'&&
        (!selected.appleId||String(row.trackId)===selected.appleId)&&
        nameKey(row.trackName)===nameKey(title)&&yearOf(row.releaseDate)===year);
      if(matches.length>1)return null;
      if(matches.length!==1)continue;
      const row=matches[0];let link;
      try{link=new URL(row.trackViewUrl);if(link.protocol!=='https:'||!['itunes.apple.com','tv.apple.com'].includes(link.hostname))continue;}catch{continue;}
      const description=[row.longDescription,row.shortDescription].find(value=>isWholeTitleSynopsis(value,1));
      if(!description)continue;
      return record({description:text(description),premiered:String(row.releaseDate||'').slice(0,10),year,
        genres:row.primaryGenreName?[clean(row.primaryGenreName)]:[],runtime:row.trackTimeMillis?Math.round(row.trackTimeMillis/60000):null},'Apple TV',link.href);
    }
    return null;
  }));
  if(!result?.description&&selected.type==='Film'&&id&&selected.title&&selected.year)fallbackTasks.push(attempt(async()=>{
    const query='query($title:String!){popularTitles(country:GB,first:20,filter:{searchQuery:$title}){edges{node{objectType content(country:GB,language:en){title originalReleaseYear externalIds{imdbId} fullPath shortDescription}}}}}';
    const data=await get('https://apis.justwatch.com/graphql',false,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{title:selected.title}})});
    if(data.errors?.length)return null;
    const matches=(data.data?.popularTitles?.edges||[]).map(row=>row.node).filter(row=>row?.objectType==='MOVIE'&&row.content?.externalIds?.imdbId===id&&nameKey(row.content.title)===nameKey(selected.title)&&String(row.content.originalReleaseYear)===selected.year);
    if(matches.length!==1)return null;
    const content=matches[0].content;
    if(!/^\/uk\/movie\/[a-zA-Z0-9_-]+$/.test(content.fullPath||'')||!isWholeTitleSynopsis(content.shortDescription))return null;
    return record({description:text(content.shortDescription),year:selected.year},'JustWatch','https://www.justwatch.com'+content.fullPath);
  }));
  // Last-resort studio discovery is generic, not a list of hand-written plots.
  // Unlike an IMDb-linked homepage, a guessed studio path must prove its year.
  if(!result?.description&&selected.type==='Film'&&selected.title&&selected.year){
    const slug=nameKey(selected.title).replace(/ /g,'-');
    const urls=[...(/^(?:harry potter|fantastic beasts)\b/.test(nameKey(selected.title))?['https://www.harrypotter.com/discover/films/'+slug]:[]),'https://movies.disney.com/'+slug,'https://www.warnerbros.com/movies/'+slug,
      'https://www.sonypictures.com/movies/'+slug.replace(/-/g,''),'https://www.mgm.com/movies/'+slug];
    fallbackTasks.unshift(Promise.all(urls.map(url=>attempt(async()=>parseFirstPartyDetails(await get(url,true),url,{...selected,requireYear:true})))).then(rows=>rows.find(Boolean)));
  }
  if(preferredIMDb)add(await preferredIMDb);
  if(!result?.description){
    const winner=await Promise.any(fallbackTasks.map(task=>task.then(details=>{if(!details?.description)throw Error('No matched synopsis');return details;}))).catch(()=>null);
    add(winner);
  }
  add(filmDatabaseDetails);
  return {...(result||{sources:[]}),synopsisVersion:SYNOPSIS_VERSION,synopsisScope:selected.type==='Series'?'series':'film',imdbId:id,imdbUrl:id?imdbURL(id):'',state:result?.description?'ready':result?'partial':id||selected.tvmazeId||selected.appleId?'unavailable':'unmatched'};
}
