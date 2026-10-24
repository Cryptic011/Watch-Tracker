/* Public metadata only. A provider must match the selected identity before use. */
const cache=new Map(),inFlight=new Map(),TTL=6*60*60*1000;
const clean=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi,(all,decimal,hex,name)=>{
  if(name)return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[name.toLowerCase()];
  const n=parseInt(decimal||hex,decimal?10:16);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
}).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const nameKey=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
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
 "media.netflix.com":"Netflix Media Center"
}));
function isIndividualReleasePath(path){
 const segments=String(path||"").toLowerCase().split("/").filter(Boolean);
 // A network's /shows/title/ homepage or /about/ page is series-level.
 // Episode/season pages, clips and trailers are not overview sources.
 return segments.some((segment,i)=>/^(?:episodes?|seasons?|clips?|videos?|trailers?|episode-guide|episodeguide|season-[0-9]+|season_[0-9]+|s[0-9]+e[0-9]+|s[0-9]+)$/.test(segment)
   ||(/^s[0-9]+$/.test(segment)&&/^e[0-9]+$/.test(segments[i+1]||""))
   ||/^(?:episode|season)[-_]?[0-9]+/.test(segment));
}
function isWholeTitleSynopsis(value){
 const description=text(value);
 if(description.length<35)return false;
 // Do not pass plot or press text about a specific season or episode
 // through the overall Show/Film Details panel.
 if(/\b(?:season\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)|s\d+\s*e\d+|episode\s*\d+)\b/i.test(description))return false;
 if(/\b(?:this|new|current|upcoming|latest|next|final|previous|first|second|third|fourth)\s+season\b/i.test(description))return false;
 if(/\b(?:the|this|next|latest|new|previous|upcoming|final)\s+episode\b/i.test(description))return false;
 if(/^\s*(?:watch|stream|new episodes|all episodes|trailer|preview|recap)\b/i.test(description))return false;
 if(/\b(?:season|episode)\s+(?:premiere|finale|recap|guide|trailer)\b/i.test(description))return false;
 return true;
}
function aboutPageDescription(markup,title){
 const source=String(markup||""),expected="about "+nameKey(title);
 for(const heading of source.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)){
   if(nameKey(heading[2])!==expected)continue;
   const after=source.slice(heading.index+heading[0].length).split(/<(?:h[1-4]|footer|nav)\b/i)[0].slice(0,7000);
   for(const p of after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)){
     const description=text(p[1]);
     if(isWholeTitleSynopsis(description))return description;
   }
 }
 return "";
}
function firstPartyURL(value){
 try{
   const u=new URL(String(value||""));
   if(u.protocol!=="https:"||u.username||u.password||u.port)return null;
   const host=u.hostname.toLowerCase().replace(/^www\./,""),name=FIRST_PARTY.get(host);
   if(!name||isIndividualReleasePath(u.pathname)||/\/(?:login|sign-in|signin|account|register|search)(?:\/|$)/i.test(u.pathname))return null;
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
export function parseFirstPartyDetails(markup,url,{title,type,year}={}){
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
 const titles=[tags.get("og:title"),tags.get("twitter:title"),titleTag,heading].filter(Boolean);
 const structured=[];
 for(const match of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
  try{const json=JSON.parse(match[1]);for(const row of Array.isArray(json)?json:[json]){
   structured.push(row);if(Array.isArray(row?.["@graph"]))structured.push(...row["@graph"]);
  }}catch{}
 }
 // Require a programme-wide title match. A homepage's generic OG title
 // cannot validate an <h1> that actually names an individual season/episode.
 const pageHeadings=[...source.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)]
   .map(row=>clean(row[1])).filter(Boolean);
 if(pageHeadings.length===1&&/\b(?:season\s*\d+|episode\s*\d+|s\d+\s*e\d+)\b/i.test(pageHeadings[0]))return null;
 const types=type==="Film"?["Movie"]:["TVSeries","TVMiniSeries","TVShow"];
 const candidates=structured.filter(row=>[row?.["@type"]].flat().some(kind=>types.includes(kind))&&matchesFirstPartyTitle(row.name,title));
 const identity=candidates.length===1?candidates[0]:null;
 if(!identity&&!titles.some(name=>matchesFirstPartyTitle(name,title)))return null;
 // A series page's publication date can refer to its CURRENT SEASON.
 // Only an explicit programme startDate can establish the series premiere;
 // otherwise IMDb may fill the overall show's original premiere date.
 const published=String((type==="Series"?identity?.startDate:identity?.datePublished)||""),publishedYear=yearOf(published);
 if(year&&publishedYear&&String(year)!==publishedYear)return null;
 const count=Number(typeof identity?.numberOfSeasons==="object"?identity.numberOfSeasons?.value:identity?.numberOfSeasons);
 const seasons=type==="Series"&&Number.isInteger(count)&&count>0&&count<=300?count:null;
 const descriptions=[
   identity?.description,
   aboutPageDescription(source,title),
   tags.get("og:description"),
   tags.get("description"),
   tags.get("twitter:description")
 ];
 const description=descriptions.map(value=>text(value)).find(isWholeTitleSynopsis)||"";
 if(!description)return null;
 return record({description,year:publishedYear,seasons,
  premiered:/^\d{4}-\d{2}-\d{2}$/.test(published)?published:"",
  genres:[identity?.genre||[]].flat().filter(x=>typeof x==="string").map(clean).slice(0,15)
 },site.name,site.url);
}

export function parseIMDbDetails(html,id,type){
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
  return record({description:text(row.description),premiered:/^\d{4}-\d{2}-\d{2}$/.test(row.datePublished||'')?row.datePublished:'',year:yearOf(row.datePublished),genres:[row.genre||[]].flat().filter(v=>typeof v==='string').map(clean).slice(0,15),runtime:duration?Number(duration[1]||0)*60+Number(duration[2]||0)||null:null,rating:Number.isFinite(rating)&&rating>0&&rating<=10?rating:null},'IMDb',imdbURL(id));
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
    const response=await request(url,{...init,signal:AbortSignal.timeout(Math.min(3000,remaining)),headers:{'User-Agent':'WatchedLogger/1.0 (title metadata)','Accept':asText?'text/html':'application/json',...(init.headers||{})}});
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
  // Official series/film overview pages are resolved before the IMDb fallback.
  // TVMaze only locates verified programme identity and publisher URLs.
  let id=selected.imdbId,canonical=null;
  const identity=async()=>{
    if(canonical)return canonical;
    if(!selected.title&&!id)return null;
    const data=await get('https://v3.sg.media-imdb.com/suggestion/titles/x/'+encodeURIComponent(id||selected.title.toLowerCase())+'.json');
    const matches=(Array.isArray(data.d)?data.d:[]).filter(row=>{
      const series=/series|miniseries/i.test(String(row.qid||row.q||'')),film=/feature|movie|short|documentary/i.test(String(row.qid||row.q||''));
      if(!imdbID(row.id)||(selected.type==='Series'?!series:!film||series))return false;
      return id?row.id===id:Boolean(selected.year)&&nameKey(row.l)===nameKey(selected.title)&&String(row.y)===selected.year;
    });
    if(matches.length!==1)return null;
    canonical={title:clean(matches[0].l),year:yearOf(matches[0].y)};id=matches[0].id;return canonical;
  };
  // A TVMaze identity record can point to the broadcaster's actual web page,
  // but its synopsis and rating are never used as editorial title details.
  const pages=[];
  if(selected.officialUrl)pages.push(selected.officialUrl);
  if(selected.type==='Series'&&(selected.tvmazeId||id))await attempt(async()=>{
    const url=selected.tvmazeId?'https://api.tvmaze.com/shows/'+selected.tvmazeId:
      'https://api.tvmaze.com/lookup/shows?imdb='+encodeURIComponent(id);
    const show=await get(url);
    if(!show?.id||(selected.tvmazeId&&String(show.id)!==selected.tvmazeId)||
      (id&&show.externals?.imdb&&show.externals.imdb!==id)||
      !matchesFirstPartyTitle(show.name,selected.title)||
      (selected.year&&yearOf(show.premiered)&&yearOf(show.premiered)!==selected.year))return null;
    if(!id)id=imdbID(show.externals?.imdb);
    if(firstPartyURL(show.officialSite))pages.push(show.officialSite);
    // CBS has a separate verified About page with its full programme synopsis.
    if(nameKey(show.network?.name)==='cbs'||nameKey(show.webChannel?.name)==='cbs'){
      const slug=clean(show.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if(slug)pages.unshift('https://www.cbs.com/shows/'+slug+'/about/');
    }
    return show;
  });
  // TMDb is used only to locate the studio's first-party film homepage.
  // Its editorial synopsis, ratings and release claims are never imported.
  // Require an exact IMDb identity and film title/year before trusting a link.
  if(selected.type==='Film'&&tmdbToken){
    if(!id)await attempt(identity);
    if(id)await attempt(async()=>{
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
      const homepage=firstPartyURL(movie.homepage);
      if(homepage)pages.push(homepage.url);
      return homepage;
    });
  }
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
  // On Apple TV originals, its own listing is a first-party source. Do not
  // treat an Apple retail listing as the original distributor of other films.
  if(!result?.description&&selected.type==='Film'&&
    (selected.appleId||/^(?:apple tv|apple tv\+)$/i.test(selected.platform)))add(await attempt(async()=>{
    const match=await attempt(identity);
    if(!selected.appleId&&(!match?.title||!match.year))return null;
    const url=selected.appleId?'https://itunes.apple.com/lookup?id='+selected.appleId+'&country=gb':'https://itunes.apple.com/search?term='+encodeURIComponent(match.title)+'&country=gb&media=movie&entity=movie&limit=40';
    const data=await get(url),matches=(data.results||[]).filter(row=>row.kind==='feature-movie'&&(selected.appleId?String(row.trackId)===selected.appleId:nameKey(row.trackName)===nameKey(match.title)&&yearOf(row.releaseDate)===match.year));
    if(matches.length!==1)return null;
    const row=matches[0];let link;
    try{link=new URL(row.trackViewUrl);if(link.protocol!=='https:'||!['itunes.apple.com','tv.apple.com'].includes(link.hostname))return null;}catch{return null;}
    return record({description:text(row.longDescription||row.shortDescription),premiered:String(row.releaseDate||'').slice(0,10),year:yearOf(row.releaseDate),genres:row.primaryGenreName?[clean(row.primaryGenreName)]:[],runtime:row.trackTimeMillis?Math.round(row.trackTimeMillis/60000):null},'Apple TV',link.href);
  }));
  // IMDb is the fallback. Existing first-party descriptions remain untouched;
  // fields IMDb can uniquely supply (such as its rating) may fill gaps.
  if(!id)await attempt(identity);
  if(id)add(await attempt(async()=>parseIMDbDetails(await get(imdbURL(id),true),id,selected.type)));
  return {...(result||{sources:[]}),imdbId:id,imdbUrl:id?imdbURL(id):'',state:result?.description?'ready':result?'partial':id||selected.tvmazeId||selected.appleId?'unavailable':'unmatched'};
}
